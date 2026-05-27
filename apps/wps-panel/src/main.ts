import {
  cancelBridgeRun,
  createIllustration,
  getBridgeConfig,
  getCodexModels,
  openDiffPopupExternal,
  runByBridgeStream,
  saveBridgeConfig,
  uploadFileAsset,
  uploadImageAsset,
} from "./api-client";
import { getCapabilityProfile, type CapabilityProfileId } from "./capability-profiles";
import { buildCharDiff, buildUnifiedCharDiff, buildUnifiedDiff, hasCharDiff, hasMeaningfulDiff, type UnifiedDiffSegment } from "./diff";
import { createMessageElement, renderMessageText, type MessageActionContext } from "./message-actions";
import { buildPrompt, getPromptPreset, type ContextScope, type PromptPresetId } from "./prompt-presets";
import { detectStructuredContent } from "./structured-content";
import {
  buildSessionMarkdown,
  ChatSessionRecord,
  createId,
  findPreferredSessionId,
  INITIAL_SESSION_TITLE,
  loadSessionsFromStorage,
  makeSession,
  persistSessions,
  shortenTitle,
  touchSession,
  type ChatMessageRecord,
  type UploadedImage,
} from "./session-store";
import {
  applyNaturalLanguageStyleSet,
  applyPunctuationFontByPageRange,
  applyStyleByPageRange,
  describeSelectionStyle,
  getCurrentParagraphText,
  getDocumentIdentity,
  getDocumentText,
  getHeadingSectionText,
  getSelectionOrParagraphText,
  getSelectionText,
  insertAfterSelection,
  insertImageAfterSelection,
  insertTableAfterSelection,
  listAvailableStyles,
  replaceSelection,
  replaceSelectionWithTable,
  splitDocumentByHeadingRange,
  type PunctuationTargetType,
  type SplitDocumentProgress,
  type StyleTargetType,
} from "./wps-adapter";
import type { SelectionStyleDescriptionResult } from "./style-inspector-types";
import type { ChatFileAttachment, ChatImageAttachment, CodexChatMode, CodexReasoningEffort, CodexRunRequest } from "../../../shared/types";
import "./style.css";

declare global {
  interface Window {
    instance?: any;
    Application?: any;
    wps?: any;
    et?: any;
  }
}

const TASKPANE_KEY = "codex_taskpane_id";
const STYLE_PROMPT_LIBRARY_STORAGE_KEY = "codex_style_prompt_library_v1";

interface StylePromptTemplateRecord {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
}

let busy = false;
let sessions: ChatSessionRecord[] = [];
let activeSessionId = "";
let activeStreamAbortController: AbortController | null = null;
let activeStreamRunId = "";
let currentDocumentKey = "";
let currentDocumentLabel = "";
let cachedStyleNames: string[] = [];
let multiSelectMode = false;
let selectedSessionIds = new Set<string>();
let contextMenuSessionId = "";
let renameDialogSessionId = "";
let settingsAutoSave = true;
let settingsDirty = false;
let settingsSaveTimer: number | null = null;
let lastSavedAt = 0;
let loadedConfigSnapshot = { cliPath: "", workingDir: "" };
let stylePromptTemplates: StylePromptTemplateRecord[] = [];
let activeStylePromptTemplateId = "";
let stylePromptEditorMode: "create" | "update" = "create";
let stylePromptEditorTargetTemplateId = "";

const statusEl = document.querySelector<HTMLDivElement>("#status");
const modeEl = document.querySelector<HTMLSelectElement>("#mode");
const modelEl = document.querySelector<HTMLSelectElement>("#model");
const reasoningEl = document.querySelector<HTMLSelectElement>("#reasoning-effort");
const cliPathEl = document.querySelector<HTMLInputElement>("#cli-path");
const workingDirEl = document.querySelector<HTMLInputElement>("#working-dir");
const detectCliBtn = document.querySelector<HTMLButtonElement>("#detect-cli");
const saveConfigBtn = document.querySelector<HTMLButtonElement>("#save-config");
const refreshModelsBtn = document.querySelector<HTMLButtonElement>("#refresh-models");
const closePanelBtn = document.querySelector<HTMLButtonElement>("#close-panel");
const settingsToggleBtn = document.querySelector<HTMLButtonElement>("#settings-toggle");
const settingsPanelEl = document.querySelector<HTMLElement>("#settings-panel");
const settingsCloseBtn = document.querySelector<HTMLButtonElement>("#settings-close");
const settingsResetBtn = document.querySelector<HTMLButtonElement>("#settings-reset");
const settingsAutoSaveEl = document.querySelector<HTMLInputElement>("#settings-autosave");
const settingsDirtyEl = document.querySelector<HTMLSpanElement>("#settings-dirty");
const settingsLastSavedEl = document.querySelector<HTMLSpanElement>("#settings-last-saved");
const chatLogEl = document.querySelector<HTMLDivElement>("#chat-log");
const chatInputEl = document.querySelector<HTMLTextAreaElement>("#chat-input");
const chatSendBtn = document.querySelector<HTMLButtonElement>("#chat-send");
const chatStopBtn = document.querySelector<HTMLButtonElement>("#chat-stop");
const chatApplySelectionBtn = document.querySelector<HTMLButtonElement>("#chat-apply-selection");
const chatInsertTextBtn = document.querySelector<HTMLButtonElement>("#chat-insert-text");
const chatInsertImageBtn = document.querySelector<HTMLButtonElement>("#chat-insert-image");
const chatUploadImageBtn = document.querySelector<HTMLButtonElement>("#chat-upload-image");
const chatImageFileEl = document.querySelector<HTMLInputElement>("#chat-image-file");
const attachmentTrayEl = document.querySelector<HTMLDivElement>("#attachment-tray");
const chatPageEl = document.querySelector<HTMLElement>("#chat-page");
const sessionManagerPageEl = document.querySelector<HTMLElement>("#session-manager-page");
const styleToolPageEl = document.querySelector<HTMLElement>("#style-tool-page");
const sessionListEl = document.querySelector<HTMLDivElement>("#session-list");
const sessionCountSummaryEl = document.querySelector<HTMLDivElement>("#session-count-summary");
const newChatSessionBtn = document.querySelector<HTMLButtonElement>("#new-chat-session");
const openStyleToolBtn = document.querySelector<HTMLButtonElement>("#open-style-tool");
const manageChatSessionsBtn = document.querySelector<HTMLButtonElement>("#manage-chat-sessions");
const backToChatFromStyleBtn = document.querySelector<HTMLButtonElement>("#back-to-chat-from-style");
const sessionManageModeToggleBtn = document.querySelector<HTMLButtonElement>("#session-manage-mode-toggle");
const sessionSelectAllBtn = document.querySelector<HTMLButtonElement>("#session-select-all");
const sessionDeleteSelectedBtn = document.querySelector<HTMLButtonElement>("#session-delete-selected");
const sessionOpenSelectedBtn = document.querySelector<HTMLButtonElement>("#session-open-selected");
const sessionBackChatBtn = document.querySelector<HTMLButtonElement>("#session-back-chat");
const sessionSearchEl = document.querySelector<HTMLInputElement>("#session-search");
const sessionDocumentLabelEl = document.querySelector<HTMLDivElement>("#session-document-label");
const sessionContextMenuEl = document.querySelector<HTMLDivElement>("#session-context-menu");
const sessionRenameDialogEl = document.querySelector<HTMLElement>("#session-rename-dialog");
const sessionRenameInputEl = document.querySelector<HTMLInputElement>("#session-rename-input");
const sessionRenameCancelBtn = document.querySelector<HTMLButtonElement>("#session-rename-cancel");
const sessionRenameConfirmBtn = document.querySelector<HTMLButtonElement>("#session-rename-confirm");
const contextScopeEl = document.querySelector<HTMLSelectElement>("#context-scope");
const promptPresetEl = document.querySelector<HTMLSelectElement>("#prompt-preset");
const capabilityProfileEl = document.querySelector<HTMLSelectElement>("#capability-profile");
const refreshStyleOptionsBtn = document.querySelector<HTMLButtonElement>("#refresh-style-options");
const stylePageFromEl = document.querySelector<HTMLInputElement>("#style-page-from");
const stylePageToEl = document.querySelector<HTMLInputElement>("#style-page-to");
const styleApplyModeEl = document.querySelector<HTMLSelectElement>("#style-apply-mode");
const styleApplyParagraphPanelEl = document.querySelector<HTMLDivElement>("#style-apply-paragraph-panel");
const styleApplyPunctuationPanelEl = document.querySelector<HTMLDivElement>("#style-apply-punctuation-panel");
const styleTargetTypeEl = document.querySelector<HTMLSelectElement>("#style-target-type");
const styleNameEl = document.querySelector<HTMLInputElement>("#style-name");
const stylePunctuationFontEl = document.querySelector<HTMLInputElement>("#style-punctuation-font");
const punctuationMultiselectEl = document.querySelector<HTMLDivElement>("#punctuation-multiselect");
const punctuationMultiselectToggleBtn = document.querySelector<HTMLButtonElement>("#punctuation-multiselect-toggle");
const punctuationMultiselectMenuEl = document.querySelector<HTMLDivElement>("#punctuation-multiselect-menu");
const punctuationMultiselectLabelEl = document.querySelector<HTMLSpanElement>("#punctuation-multiselect-label");
const punctuationQuoteEl = document.querySelector<HTMLInputElement>("#punctuation-quote");
const punctuationCommaEl = document.querySelector<HTMLInputElement>("#punctuation-comma");
const punctuationColonEl = document.querySelector<HTMLInputElement>("#punctuation-colon");
const styleNameOptionsEl = document.querySelector<HTMLDivElement>("#style-name-options");
const showAllStylesEl = document.querySelector<HTMLInputElement>("#show-all-styles");
const applyStyleRangeBtn = document.querySelector<HTMLButtonElement>("#apply-style-range");
const applyPunctuationFontRangeBtn = document.querySelector<HTMLButtonElement>("#apply-punctuation-font-range");
const splitPageFromEl = document.querySelector<HTMLInputElement>("#split-page-from");
const splitPageToEl = document.querySelector<HTMLInputElement>("#split-page-to");
const splitHeadingLevelEl = document.querySelector<HTMLSelectElement>("#split-heading-level");
const splitOutputDirEl = document.querySelector<HTMLInputElement>("#split-output-dir");
const splitDocxByHeadingBtn = document.querySelector<HTMLButtonElement>("#split-docx-by-heading");
const splitProgressEl = document.querySelector<HTMLDivElement>("#split-progress");
const splitProgressBarEl = document.querySelector<HTMLDivElement>("#split-progress-bar");
const splitProgressTextEl = document.querySelector<HTMLDivElement>("#split-progress-text");
const styleNlInputEl = document.querySelector<HTMLTextAreaElement>("#style-nl-input");
const applyStyleNlBtn = document.querySelector<HTMLButtonElement>("#apply-style-nl");
const inspectStyleSelectionBtn = document.querySelector<HTMLButtonElement>("#inspect-style-selection");
const styleInspectNlOutputEl = document.querySelector<HTMLTextAreaElement>("#style-inspect-nl-output");
const stylePromptTemplateSelectEl = document.querySelector<HTMLSelectElement>("#style-prompt-template-select");
const stylePromptCreateBtn = document.querySelector<HTMLButtonElement>("#style-prompt-create");
const stylePromptUpdateBtn = document.querySelector<HTMLButtonElement>("#style-prompt-update");
const stylePromptDeleteBtn = document.querySelector<HTMLButtonElement>("#style-prompt-delete");
const stylePromptUseBtn = document.querySelector<HTMLButtonElement>("#style-prompt-use");
const stylePromptEditorDialogEl = document.querySelector<HTMLElement>("#style-prompt-editor-dialog");
const stylePromptEditorTitleEl = document.querySelector<HTMLHeadingElement>("#style-prompt-editor-title");
const stylePromptEditorNameEl = document.querySelector<HTMLInputElement>("#style-prompt-editor-name");
const stylePromptEditorContentEl = document.querySelector<HTMLTextAreaElement>("#style-prompt-editor-content");
const stylePromptEditorCancelBtn = document.querySelector<HTMLButtonElement>("#style-prompt-editor-cancel");
const stylePromptEditorConfirmBtn = document.querySelector<HTMLButtonElement>("#style-prompt-editor-confirm");
const diffModalEl = document.querySelector<HTMLDivElement>("#diff-modal");
const diffContentEl = document.querySelector<HTMLDivElement>("#diff-content");
const diffDescriptionEl = document.querySelector<HTMLParagraphElement>("#diff-description");
const diffCopyBtn = document.querySelector<HTMLButtonElement>("#diff-copy");
const diffCancelBtn = document.querySelector<HTMLButtonElement>("#diff-cancel");
const diffConfirmBtn = document.querySelector<HTMLButtonElement>("#diff-confirm");

// ---- Paragraph Diff (005) ----
const cwDiffText1El = document.querySelector<HTMLTextAreaElement>("#cw-diff-text1");
const cwDiffText2El = document.querySelector<HTMLTextAreaElement>("#cw-diff-text2");
const cwDiffCompareBtn = document.querySelector<HTMLButtonElement>("#cw-diff-compare");
const cwDiffCompareMergedBtn = document.querySelector<HTMLButtonElement>("#cw-diff-compare-merged");
const cwDiffResultDialogEl = document.querySelector<HTMLDivElement>("#cw-diff-result-dialog");
const cwDiffResultContentEl = document.querySelector<HTMLDivElement>("#cw-diff-result-content");
const cwDiffResultCloseBtn = document.querySelector<HTMLButtonElement>("#cw-diff-result-close");
const cwDiffResultCopyBtn = document.querySelector<HTMLButtonElement>("#cw-diff-result-copy");
const cwDiffResultMergedEl = document.querySelector<HTMLDivElement>("#cw-diff-result-merged");
let cwDiffCurrentView: "side" | "merged" = "side";
let splitProgressSignature = "";
let activeHelpPopoverEl: HTMLElement | null = null;
let helpTooltipEl: HTMLDivElement | null = null;

function setStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.error = isError ? "1" : "0";
}

function ensureHelpTooltip(): HTMLDivElement {
  if (helpTooltipEl) return helpTooltipEl;
  helpTooltipEl = document.createElement("div");
  helpTooltipEl.className = "help-tooltip-portal";
  helpTooltipEl.hidden = true;
  document.body.appendChild(helpTooltipEl);
  return helpTooltipEl;
}

function positionHelpTooltip(source: HTMLElement): void {
  if (!helpTooltipEl || helpTooltipEl.hidden) return;
  const rect = source.getBoundingClientRect();
  const gap = 10;
  const margin = 8;
  helpTooltipEl.style.maxWidth = `${Math.min(280, Math.max(180, window.innerWidth - margin * 2))}px`;
  const tooltipRect = helpTooltipEl.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  left = Math.max(margin, Math.min(window.innerWidth - tooltipRect.width - margin, left));
  let top = rect.bottom + gap;
  if (top + tooltipRect.height > window.innerHeight - margin) {
    top = rect.top - tooltipRect.height - gap;
  }
  top = Math.max(margin, Math.min(window.innerHeight - tooltipRect.height - margin, top));
  helpTooltipEl.style.left = `${left}px`;
  helpTooltipEl.style.top = `${top}px`;
}

function showHelpTooltip(source: HTMLElement): void {
  const bubble = source.querySelector<HTMLElement>(".help-popover__bubble");
  const text = bubble?.textContent?.trim() || source.getAttribute("aria-label") || "";
  if (!text) return;
  activeHelpPopoverEl = source;
  const tooltip = ensureHelpTooltip();
  tooltip.textContent = text;
  tooltip.hidden = false;
  positionHelpTooltip(source);
}

function hideHelpTooltip(source?: HTMLElement): void {
  if (source && activeHelpPopoverEl !== source) return;
  activeHelpPopoverEl = null;
  if (helpTooltipEl) helpTooltipEl.hidden = true;
}

function setSplitProgress(percent: number, text: string, isError = false): void {
  if (!splitProgressEl || !splitProgressBarEl || !splitProgressTextEl) return;
  const clamped = Math.max(0, Math.min(100, percent));
  const signature = `${clamped}|${isError ? 1 : 0}|${text}`;
  if (splitProgressSignature === signature) return;
  splitProgressSignature = signature;
  splitProgressEl.hidden = false;
  splitProgressEl.classList.toggle("is-error", isError);
  splitProgressBarEl.style.width = `${clamped}%`;
  splitProgressTextEl.textContent = text;
}

function resetSplitProgress(): void {
  splitProgressSignature = "";
  if (!splitProgressEl || !splitProgressBarEl || !splitProgressTextEl) return;
  splitProgressEl.hidden = true;
  splitProgressEl.classList.remove("is-error");
  splitProgressBarEl.style.width = "0%";
  splitProgressTextEl.textContent = "等待开始";
}

function trimSplitTitle(input: string, limit = 24): string {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function renderSplitProgress(progress: SplitDocumentProgress): void {
  if (progress.phase === "scan") {
    const ratio = progress.scanTotal > 0 ? progress.scanned / progress.scanTotal : 0;
    const percent = Math.floor(ratio * 35);
    setSplitProgress(percent, `正在扫描文档结构：${progress.scanned}/${progress.scanTotal}`);
    return;
  }
  if (progress.phase === "export") {
    const ratio = progress.total > 0 ? progress.current / progress.total : 0;
    const percent = 35 + Math.floor(ratio * 65);
    const heading = trimSplitTitle(progress.currentTitle);
    const suffix = heading ? `，当前：${heading}` : "";
    setSplitProgress(percent, `正在导出：${progress.current}/${progress.total}，成功 ${progress.exported}，跳过 ${progress.skipped}${suffix}`);
    return;
  }
  setSplitProgress(100, `导出完成：成功 ${progress.exported}，跳过 ${progress.skipped}`);
}

function waitForUiPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

function sortSessionsForDisplay(items: ChatSessionRecord[]): ChatSessionRecord[] {
  return items
    .slice()
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
}

function formatClock(value: number): string {
  if (!value) return "尚未保存";
  const date = new Date(value);
  return `上次保存 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(
    date.getSeconds()
  ).padStart(2, "0")}`;
}

function renderSettingsStatus(): void {
  if (settingsDirtyEl) settingsDirtyEl.textContent = settingsDirty ? "存在未保存修改" : "无未保存修改";
  if (settingsLastSavedEl) settingsLastSavedEl.textContent = formatClock(lastSavedAt);
}

function isSameConfigDraft(): boolean {
  const nextCliPath = String(cliPathEl?.value || "").trim();
  const nextWorkingDir = String(workingDirEl?.value || "").trim();
  return nextCliPath === loadedConfigSnapshot.cliPath && nextWorkingDir === loadedConfigSnapshot.workingDir;
}

function updateSettingsDirtyState(): void {
  settingsDirty = !isSameConfigDraft();
  renderSettingsStatus();
}

function scheduleSettingsAutoSave(): void {
  if (!settingsAutoSave || !settingsDirty) return;
  if (settingsSaveTimer) {
    window.clearTimeout(settingsSaveTimer);
  }
  settingsSaveTimer = window.setTimeout(() => {
    settingsSaveTimer = null;
    void (async () => {
      try {
        await saveConfig("配置已自动保存。");
      } catch (error) {
        setStatus((error as Error).message, true);
      }
    })();
  }, 500);
}

function revertConfigDraft(): void {
  if (settingsSaveTimer) {
    window.clearTimeout(settingsSaveTimer);
    settingsSaveTimer = null;
  }
  if (cliPathEl) cliPathEl.value = loadedConfigSnapshot.cliPath;
  if (workingDirEl) workingDirEl.value = loadedConfigSnapshot.workingDir;
  updateSettingsDirtyState();
}

function openSettingsPanel(): void {
  if (settingsPanelEl) settingsPanelEl.hidden = false;
}

function closeSettingsPanel(): void {
  if (settingsPanelEl) settingsPanelEl.hidden = true;
}

function selectedMode(): CodexChatMode {
  return modeEl?.value === "agent" ? "agent" : "ask";
}

function selectedReasoningEffort(): CodexReasoningEffort {
  const value = String(reasoningEl?.value || "");
  return ["low", "medium", "high", "xhigh"].includes(value) ? (value as CodexReasoningEffort) : "";
}

function selectedModel(): string {
  return String(modelEl?.value || "").trim();
}

function selectedContextScope(): ContextScope {
  const value = String(contextScopeEl?.value || "selection");
  return ["selection", "paragraph", "heading", "document"].includes(value) ? (value as ContextScope) : "selection";
}

function selectedPromptPreset(): PromptPresetId {
  const value = String(promptPresetEl?.value || "custom");
  return [
    "custom",
    "polish",
    "formal",
    "compress",
    "expand",
    "summary",
    "translate",
    "typo",
    "punctuation-fragments",
    "contract-review",
    "meeting-minutes",
  ].includes(value)
    ? (value as PromptPresetId)
    : "custom";
}

function selectedCapabilityProfile(): CapabilityProfileId {
  const value = String(capabilityProfileEl?.value || "word-rewrite");
  return ["word-rewrite", "word-review", "chat-markdown"].includes(value) ? (value as CapabilityProfileId) : "word-rewrite";
}

function selectedStyleTargetType(): StyleTargetType {
  const value = String(styleTargetTypeEl?.value || "other-text");
  return ["image-paragraph", "image-caption", "table-text", "other-text"].includes(value)
    ? (value as StyleTargetType)
    : "other-text";
}

function selectedPunctuationTypes(): PunctuationTargetType[] {
  const types: PunctuationTargetType[] = [];
  if (punctuationQuoteEl?.checked) types.push("quote");
  if (punctuationCommaEl?.checked) types.push("comma");
  if (punctuationColonEl?.checked) types.push("colon");
  return types;
}

function renderPunctuationMultiselect(): void {
  const selectedLabels: string[] = [];
  if (punctuationQuoteEl?.checked) selectedLabels.push("引号");
  if (punctuationCommaEl?.checked) selectedLabels.push("逗号");
  if (punctuationColonEl?.checked) selectedLabels.push("冒号");
  if (punctuationMultiselectLabelEl) punctuationMultiselectLabelEl.textContent = selectedLabels.length ? selectedLabels.join("、") : "请选择标点";
  punctuationMultiselectMenuEl?.querySelectorAll<HTMLLabelElement>(".multi-select__option").forEach((option) => {
    const checkbox = option.querySelector<HTMLInputElement>('input[type="checkbox"]');
    option.setAttribute("aria-selected", checkbox?.checked ? "true" : "false");
  });
}

function setPunctuationMultiselectOpen(open: boolean): void {
  if (punctuationMultiselectMenuEl) punctuationMultiselectMenuEl.hidden = !open;
  if (punctuationMultiselectToggleBtn) punctuationMultiselectToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function setStyleApplyMode(mode: "paragraph" | "punctuation"): void {
  const isParagraph = mode === "paragraph";
  if (styleApplyModeEl && styleApplyModeEl.value !== mode) styleApplyModeEl.value = mode;
  if (styleApplyParagraphPanelEl) styleApplyParagraphPanelEl.hidden = !isParagraph;
  if (styleApplyPunctuationPanelEl) styleApplyPunctuationPanelEl.hidden = isParagraph;
  if (isParagraph) setPunctuationMultiselectOpen(false);
}

async function getApplication(): Promise<any> {
  const localApp = window.Application || window.wps?.Application || window.et?.Application;
  if (localApp) return localApp;

  const inst = window.instance;
  if (inst) {
    if (typeof inst.ready === "function") await inst.ready();
    if (!inst.Application) throw new Error("WebOffice instance 已注入，但缺少 Application。");
    return inst.Application;
  }

  throw new Error("未检测到 WPS 文档上下文。请在 WPS 本地加载项内打开本面板。");
}

async function closeCurrentPanel(): Promise<void> {
  const app = await getApplication();
  const paneId = app?.PluginStorage?.getItem?.(TASKPANE_KEY);
  if (!paneId) return;
  const pane = app?.GetTaskPane?.(paneId);
  if (pane) pane.Visible = false;
}

function basePayload(
  content: string,
  instruction: string,
  imageAttachments: ChatImageAttachment[],
  fileAttachments: ChatFileAttachment[] = []
): CodexRunRequest {
  return {
    task: "chat",
    content,
    instruction,
    model: selectedModel() || undefined,
    mode: selectedMode(),
    reasoningEffort: selectedReasoningEffort() || undefined,
    imageAttachments: imageAttachments.length ? imageAttachments : undefined,
    fileAttachments: fileAttachments.length ? fileAttachments : undefined,
  };
}

function getActiveSession(): ChatSessionRecord {
  let current = sessions.find((item) => item.id === activeSessionId);
  if (!current) {
    current = sessions[0] || makeSession(INITIAL_SESSION_TITLE, currentDocumentKey, currentDocumentLabel);
    if (!sessions.length) sessions.push(current);
    activeSessionId = current.id;
  }
  return current;
}

function sessionSearchQuery(): string {
  return String(sessionSearchEl?.value || "").trim().toLowerCase();
}

function formatSessionMeta(session: ChatSessionRecord): string {
  const label = session.documentLabel || "未绑定文档";
  const count = session.messages.filter((message) => message.role !== "assistant" || message.text.trim()).length;
  return `${label} · ${count} 条消息`;
}

function compactDateTime(value: number): string {
  const date = new Date(value);
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function compactDocumentName(label: string): string {
  const clean = label.replace(/\.[^.\\/]+$/, "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 18 ? `${clean.slice(0, 18)}...` : clean;
}

function generatedSessionTitle(session: ChatSessionRecord): string {
  const doc = compactDocumentName(session.documentLabel || currentDocumentLabel);
  return doc ? `${doc} ${compactDateTime(session.createdAt)}` : `会话 ${compactDateTime(session.createdAt)}`;
}

function sessionDisplayTitle(session: ChatSessionRecord): string {
  const title = session.title && session.title !== INITIAL_SESSION_TITLE ? session.title : generatedSessionTitle(session);
  const time = compactDateTime(session.createdAt).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title.replace(new RegExp(`\\s+${time}$`), "").trim() || title;
}

function sessionTitleTime(session: ChatSessionRecord): string {
  return compactDateTime(session.updatedAt);
}

function ensureSessionTitle(session: ChatSessionRecord): void {
  if (session.title && session.title !== INITIAL_SESSION_TITLE) return;
  session.title = generatedSessionTitle(session);
}

function renderCurrentDocumentLabel(): void {
  if (!sessionDocumentLabelEl) return;
  sessionDocumentLabelEl.textContent = `当前文档：${currentDocumentLabel || "未绑定"}`;
}

function updateSessionSummary(filtered: number, total: number): void {
  if (!sessionCountSummaryEl) return;
  sessionCountSummaryEl.textContent = filtered === total ? `${total} 个会话` : `${filtered}/${total} 个会话`;
}

function showChatPage(): void {
  closeSessionContextMenu();
  closeStylePromptEditor();
  if (chatPageEl) chatPageEl.hidden = false;
  if (sessionManagerPageEl) sessionManagerPageEl.hidden = true;
  if (styleToolPageEl) styleToolPageEl.hidden = true;
  if (manageChatSessionsBtn) manageChatSessionsBtn.classList.remove("is-active");
  if (openStyleToolBtn) openStyleToolBtn.classList.remove("is-active");
}

function showSessionManagerPage(): void {
  renderCurrentDocumentLabel();
  closeSessionContextMenu();
  closeStylePromptEditor();
  renderSessionList();
  if (chatPageEl) chatPageEl.hidden = true;
  if (sessionManagerPageEl) sessionManagerPageEl.hidden = false;
  if (styleToolPageEl) styleToolPageEl.hidden = true;
  if (manageChatSessionsBtn) manageChatSessionsBtn.classList.add("is-active");
  if (openStyleToolBtn) openStyleToolBtn.classList.remove("is-active");
}

function showStyleToolPage(): void {
  closeSessionContextMenu();
  renderCurrentDocumentLabel();
  renderStylePromptLibrary();
  if (chatPageEl) chatPageEl.hidden = true;
  if (sessionManagerPageEl) sessionManagerPageEl.hidden = true;
  if (styleToolPageEl) styleToolPageEl.hidden = false;
  if (manageChatSessionsBtn) manageChatSessionsBtn.classList.remove("is-active");
  if (openStyleToolBtn) openStyleToolBtn.classList.add("is-active");
}

function setMultiSelectMode(next: boolean): void {
  multiSelectMode = next;
  if (!multiSelectMode) {
    selectedSessionIds.clear();
  }
  if (sessionManageModeToggleBtn) sessionManageModeToggleBtn.textContent = multiSelectMode ? "退出多选" : "多选删除";
  if (sessionSelectAllBtn) sessionSelectAllBtn.hidden = !multiSelectMode;
  if (sessionDeleteSelectedBtn) sessionDeleteSelectedBtn.hidden = !multiSelectMode;
  renderSessionList();
}

function updateMultiSelectActions(total: number): void {
  if (!sessionDeleteSelectedBtn || !sessionSelectAllBtn) return;
  const selectedCount = selectedSessionIds.size;
  sessionDeleteSelectedBtn.disabled = selectedCount === 0;
  sessionDeleteSelectedBtn.textContent = `删除(${selectedCount})`;
  sessionSelectAllBtn.textContent = selectedCount > 0 && selectedCount === total ? "取消全选" : "全选";
}

function toggleSessionSelection(sessionId: string): void {
  if (selectedSessionIds.has(sessionId)) {
    selectedSessionIds.delete(sessionId);
  } else {
    selectedSessionIds.add(sessionId);
  }
  renderSessionList();
}

function selectAllFilteredSessions(): void {
  const query = sessionSearchQuery();
  const filteredIds = sortSessionsForDisplay(sessions)
    .filter((session) => {
      if (!query) return true;
      const haystack = [session.title, session.documentLabel, ...session.messages.map((message) => message.text)].join("\n").toLowerCase();
      return haystack.includes(query);
    })
    .map((session) => session.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedSessionIds.has(id));
  if (allSelected) {
    filteredIds.forEach((id) => selectedSessionIds.delete(id));
  } else {
    filteredIds.forEach((id) => selectedSessionIds.add(id));
  }
  renderSessionList();
}

function closeSessionContextMenu(): void {
  if (!sessionContextMenuEl) return;
  sessionContextMenuEl.hidden = true;
  contextMenuSessionId = "";
}

function openSessionContextMenu(sessionId: string, clientX: number, clientY: number): void {
  if (!sessionContextMenuEl) return;
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;
  contextMenuSessionId = sessionId;
  const pinButton = sessionContextMenuEl.querySelector<HTMLButtonElement>('button[data-action=\"pin\"]');
  if (pinButton) pinButton.textContent = session.pinned ? "取消置顶" : "置顶会话";
  sessionContextMenuEl.style.left = `${Math.max(8, clientX)}px`;
  sessionContextMenuEl.style.top = `${Math.max(8, clientY)}px`;
  sessionContextMenuEl.hidden = false;
}

function openSessionRenameDialog(sessionId: string): void {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session || !sessionRenameDialogEl || !sessionRenameInputEl) return;
  renameDialogSessionId = sessionId;
  sessionRenameInputEl.value = sessionDisplayTitle(session);
  sessionRenameDialogEl.hidden = false;
  queueMicrotask(() => {
    sessionRenameInputEl.focus();
    sessionRenameInputEl.select();
  });
}

function closeSessionRenameDialog(): void {
  renameDialogSessionId = "";
  if (sessionRenameDialogEl) sessionRenameDialogEl.hidden = true;
}

function deleteSessionsByIds(sessionIds: string[]): void {
  const unique = Array.from(new Set(sessionIds.filter(Boolean)));
  if (!unique.length) return;
  sessions = sessions.filter((session) => !unique.includes(session.id));
  if (!sessions.length) {
    sessions = [makeSession(INITIAL_SESSION_TITLE, currentDocumentKey, currentDocumentLabel)];
  }
  if (!sessions.some((session) => session.id === activeSessionId)) {
    activeSessionId = findPreferredSessionId(sessions, currentDocumentKey);
  }
  selectedSessionIds.clear();
  persistAllSessions();
  redrawActiveSession();
}

function commitRenameSession(): void {
  const session = sessions.find((item) => item.id === renameDialogSessionId);
  const nextTitle = String(sessionRenameInputEl?.value || "").trim();
  if (!session || !nextTitle) {
    closeSessionRenameDialog();
    return;
  }
  session.title = shortenTitle(nextTitle);
  persistActiveSession(session);
  closeSessionRenameDialog();
  setStatus(`已重命名会话：${session.title}`);
}

function openSessionFromManager(sessionId: string): void {
  activeSessionId = sessionId;
  redrawActiveSession();
  showChatPage();
  setStatus(`已进入会话：${sessionDisplayTitle(getActiveSession())}`);
}

function openCurrentSelectedSession(): void {
  const target = sessions.find((session) => session.id === activeSessionId);
  if (!target) return;
  openSessionFromManager(target.id);
}

function isSessionActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("button, input, a"));
}

function renderSessionList(): void {
  if (!sessionListEl) return;
  sessionListEl.innerHTML = "";
  const query = sessionSearchQuery();
  const filteredSessions = sortSessionsForDisplay(sessions)
    .filter((session) => {
      if (!query) return true;
      const haystack = [session.title, session.documentLabel, ...session.messages.map((message) => message.text)].join("\n").toLowerCase();
      return haystack.includes(query);
    });
  updateSessionSummary(filteredSessions.length, sessions.length);
  updateMultiSelectActions(filteredSessions.length);
  if (!filteredSessions.length) {
    const empty = document.createElement("div");
    empty.className = "session-item__meta";
    empty.textContent = "没有匹配的会话。";
    sessionListEl.appendChild(empty);
    return;
  }

  filteredSessions.forEach((session) => {
    const item = document.createElement("div");
    item.role = "button";
    item.tabIndex = 0;
    item.className = `session-item${multiSelectMode ? " is-multiselect" : ""}${session.id === activeSessionId ? " is-active" : ""}${session.pinned ? " is-pinned" : ""}${
      selectedSessionIds.has(session.id) ? " is-selected" : ""
    }`;
    item.title = `${sessionDisplayTitle(session)}\n${formatSessionMeta(session)}`;

    if (multiSelectMode) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "session-item__check";
      checkbox.checked = selectedSessionIds.has(session.id);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => toggleSessionSelection(session.id));
      item.appendChild(checkbox);
    }

    const body = document.createElement("div");
    body.className = "session-item__body";

    const title = document.createElement("span");
    title.className = "session-item__title";
    const titleText = document.createElement("span");
    titleText.className = "session-item__title-text";
    titleText.textContent = sessionDisplayTitle(session);
    const titleTime = document.createElement("span");
    titleTime.className = "session-item__title-time";
    titleTime.textContent = sessionTitleTime(session);
    title.append(titleText, titleTime);

    const meta = document.createElement("span");
    meta.className = "session-item__meta";
    meta.textContent = formatSessionMeta(session);
    body.append(title, meta);
    item.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "session-item__actions";

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = `session-item__action${session.pinned ? " is-pinned" : ""}`;
    pinBtn.textContent = session.pinned ? "★" : "☆";
    pinBtn.title = session.pinned ? "取消置顶" : "置顶";
    pinBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      session.pinned = !session.pinned;
      persistActiveSession(session);
      setStatus(session.pinned ? "已置顶会话。" : "已取消置顶。");
    });
    actions.appendChild(pinBtn);

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "session-item__action";
    menuBtn.textContent = "⋯";
    menuBtn.title = "更多";
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      openSessionContextMenu(session.id, rect.left + 2, rect.bottom + 2);
    });
    actions.appendChild(menuBtn);
    item.appendChild(actions);

    item.addEventListener("click", (event) => {
      if (isSessionActionTarget(event.target)) return;
      closeSessionContextMenu();
      if (multiSelectMode) {
        toggleSessionSelection(session.id);
        return;
      }
      activeSessionId = session.id;
      renderSessionList();
      updateChatActionButtons();
      setStatus(`已选中会话：${sessionDisplayTitle(session)}`);
    });
    item.addEventListener("dblclick", () => {
      openSessionFromManager(session.id);
    });
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openSessionContextMenu(session.id, event.clientX, event.clientY);
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (multiSelectMode) {
          toggleSessionSelection(session.id);
          return;
        }
        openSessionFromManager(session.id);
      }
    });
    sessionListEl.appendChild(item);
  });
}

function appendChat(message: ChatMessageRecord, index: number): HTMLDivElement | null {
  if (!chatLogEl) return null;
  const rendered = createMessageElement(
    { message, index },
    {
      copy: ({ message: current }) => {
        void (async () => {
          try {
            await copyTextToClipboard(current.text);
            setStatus("已复制该条回复。");
          } catch (error) {
            setStatus((error as Error).message, true);
          }
        })();
      },
      delete: ({ index: currentIndex }) => {
        deleteMessageTurnAt(currentIndex);
      },
      rewrite: ({ index: currentIndex }) => {
        rewriteMessageTurnAt(currentIndex);
      },
    }
  );
  chatLogEl.appendChild(rendered.root);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
  return rendered.text;
}

function updateChatMessageText(messageEl: HTMLDivElement | null, text: string): void {
  if (!messageEl) return;
  renderMessageText(messageEl, text);
  if (chatLogEl) chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function redrawActiveSession(): void {
  const active = getActiveSession();
  if (chatLogEl) chatLogEl.innerHTML = "";
  active.messages.forEach((message, index) => {
    appendChat(message, index);
  });
  renderCurrentDocumentLabel();
  renderSessionList();
  renderAttachmentTray();
  updateChatActionButtons();
}

function updateChatActionButtons(): void {
  const active = getActiveSession();
  const disabled = busy || !active.lastAssistantOutput.trim();
  [chatApplySelectionBtn, chatInsertTextBtn, chatInsertImageBtn].forEach((btn) => {
    if (btn) btn.disabled = disabled;
  });
  if (chatUploadImageBtn) chatUploadImageBtn.disabled = busy;
}

function updateRunToggleButton(): void {
  if (!chatSendBtn) return;
  chatSendBtn.disabled = false;
  chatSendBtn.classList.toggle("is-stop", busy);
  chatSendBtn.title = busy ? "停止生成" : "发送消息";
  chatSendBtn.setAttribute("aria-label", busy ? "停止生成" : "发送消息");
  chatSendBtn.textContent = busy ? "■" : "➤";
}

function setBusy(isBusy: boolean): void {
  busy = isBusy;
  [
    saveConfigBtn,
    detectCliBtn,
    refreshModelsBtn,
    settingsToggleBtn,
    settingsResetBtn,
    newChatSessionBtn,
    openStyleToolBtn,
    manageChatSessionsBtn,
    sessionManageModeToggleBtn,
    sessionSelectAllBtn,
    sessionDeleteSelectedBtn,
    sessionOpenSelectedBtn,
    sessionBackChatBtn,
    refreshStyleOptionsBtn,
    applyStyleRangeBtn,
    applyPunctuationFontRangeBtn,
    splitDocxByHeadingBtn,
    applyStyleNlBtn,
    inspectStyleSelectionBtn,
  ].forEach((btn) => {
    if (btn) btn.disabled = isBusy;
  });
  [
    sessionSearchEl,
    stylePageFromEl,
    stylePageToEl,
    styleApplyModeEl,
    styleTargetTypeEl,
    styleNameEl,
    stylePunctuationFontEl,
    punctuationMultiselectToggleBtn,
    punctuationQuoteEl,
    punctuationCommaEl,
    punctuationColonEl,
    showAllStylesEl,
    splitPageFromEl,
    splitPageToEl,
    splitHeadingLevelEl,
    splitOutputDirEl,
    styleNlInputEl,
  ].forEach((el) => {
    if (el) el.disabled = isBusy;
  });
  if (styleInspectNlOutputEl) styleInspectNlOutputEl.readOnly = true;
  if (chatStopBtn) chatStopBtn.disabled = !isBusy || !activeStreamAbortController;
  updateRunToggleButton();
  updateChatActionButtons();
  renderStylePromptTemplateControls();
}

function sortStylePromptTemplates(items: StylePromptTemplateRecord[]): StylePromptTemplateRecord[] {
  return items
    .slice()
    .sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
      return a.name.localeCompare(b.name, "zh-CN");
    });
}

function loadStylePromptTemplates(): void {
  try {
    const raw = window.localStorage.getItem(STYLE_PROMPT_LIBRARY_STORAGE_KEY);
    if (!raw) {
      stylePromptTemplates = [];
      activeStylePromptTemplateId = "";
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      stylePromptTemplates = [];
      activeStylePromptTemplateId = "";
      return;
    }
    const now = Date.now();
    const normalized: StylePromptTemplateRecord[] = parsed
      .map((item) => {
        const name = String(item?.name || "").trim();
        const prompt = String(item?.prompt || "").trim();
        if (!name || !prompt) return null;
        return {
          id: String(item?.id || createId("style-prompt")),
          name,
          prompt,
          createdAt: Number.isFinite(Number(item?.createdAt)) ? Number(item.createdAt) : now,
          updatedAt: Number.isFinite(Number(item?.updatedAt)) ? Number(item.updatedAt) : now,
        } as StylePromptTemplateRecord;
      })
      .filter((item): item is StylePromptTemplateRecord => Boolean(item));
    stylePromptTemplates = sortStylePromptTemplates(normalized);
    activeStylePromptTemplateId = stylePromptTemplates[0]?.id || "";
  } catch {
    stylePromptTemplates = [];
    activeStylePromptTemplateId = "";
  }
}

function persistStylePromptTemplates(): void {
  window.localStorage.setItem(STYLE_PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify(stylePromptTemplates));
}

function getStylePromptTemplateById(id: string): StylePromptTemplateRecord | null {
  if (!id) return null;
  return stylePromptTemplates.find((item) => item.id === id) || null;
}

function selectedStylePromptTemplate(): StylePromptTemplateRecord | null {
  const selectedId = String(stylePromptTemplateSelectEl?.value || activeStylePromptTemplateId || "").trim();
  return getStylePromptTemplateById(selectedId);
}

function renderStylePromptTemplateOptions(): void {
  if (!stylePromptTemplateSelectEl) return;

  const previous = String(stylePromptTemplateSelectEl.value || activeStylePromptTemplateId || "");
  stylePromptTemplateSelectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "请选择模板";
  stylePromptTemplateSelectEl.appendChild(placeholder);

  stylePromptTemplates.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    stylePromptTemplateSelectEl.appendChild(option);
  });

  const fallbackId = stylePromptTemplates[0]?.id || "";
  const resolvedId = getStylePromptTemplateById(previous)?.id || getStylePromptTemplateById(activeStylePromptTemplateId)?.id || fallbackId;
  activeStylePromptTemplateId = resolvedId;
  stylePromptTemplateSelectEl.value = resolvedId || "";
}

function renderStylePromptTemplateControls(): void {
  const selected = selectedStylePromptTemplate();
  const hasSelection = Boolean(selected);
  const disabledByBusy = busy;
  if (stylePromptTemplateSelectEl) stylePromptTemplateSelectEl.disabled = disabledByBusy;
  if (stylePromptCreateBtn) stylePromptCreateBtn.disabled = disabledByBusy;
  if (stylePromptUpdateBtn) stylePromptUpdateBtn.disabled = disabledByBusy || !hasSelection;
  if (stylePromptDeleteBtn) stylePromptDeleteBtn.disabled = disabledByBusy || !hasSelection;
  if (stylePromptUseBtn) stylePromptUseBtn.disabled = disabledByBusy || !hasSelection;
  if (stylePromptEditorNameEl) stylePromptEditorNameEl.disabled = disabledByBusy;
  if (stylePromptEditorContentEl) stylePromptEditorContentEl.disabled = disabledByBusy;
  if (stylePromptEditorCancelBtn) stylePromptEditorCancelBtn.disabled = disabledByBusy;
  if (stylePromptEditorConfirmBtn) stylePromptEditorConfirmBtn.disabled = disabledByBusy;
}

function renderStylePromptLibrary(): void {
  renderStylePromptTemplateOptions();
  renderStylePromptTemplateControls();
}

function openStylePromptEditor(mode: "create" | "update"): void {
  if (!stylePromptEditorDialogEl || !stylePromptEditorNameEl || !stylePromptEditorContentEl || !stylePromptEditorTitleEl || !stylePromptEditorConfirmBtn) {
    throw new Error("样式模板编辑窗口未初始化。");
  }

  if (mode === "update") {
    const selected = selectedStylePromptTemplate();
    if (!selected) throw new Error("请先选择模板。");
    stylePromptEditorMode = "update";
    stylePromptEditorTargetTemplateId = selected.id;
    stylePromptEditorTitleEl.textContent = "修改样式模板";
    stylePromptEditorConfirmBtn.textContent = "保存修改";
    stylePromptEditorNameEl.value = selected.name;
    stylePromptEditorContentEl.value = selected.prompt;
  } else {
    stylePromptEditorMode = "create";
    stylePromptEditorTargetTemplateId = "";
    stylePromptEditorTitleEl.textContent = "新建样式模板";
    stylePromptEditorConfirmBtn.textContent = "新建模板";
    stylePromptEditorNameEl.value = "";
    stylePromptEditorContentEl.value = String(styleNlInputEl?.value || "").trim();
  }

  stylePromptEditorDialogEl.hidden = false;
  window.setTimeout(() => stylePromptEditorNameEl.focus(), 0);
  renderStylePromptTemplateControls();
}

function closeStylePromptEditor(): void {
  if (!stylePromptEditorDialogEl) return;
  stylePromptEditorDialogEl.hidden = true;
  stylePromptEditorMode = "create";
  stylePromptEditorTargetTemplateId = "";
  renderStylePromptTemplateControls();
}

function submitStylePromptEditor(): void {
  const name = String(stylePromptEditorNameEl?.value || "").trim();
  const prompt = String(stylePromptEditorContentEl?.value || "").trim();
  if (!name) throw new Error("请输入模板名称。");
  if (!prompt) throw new Error("请输入模板样式要求。");

  if (stylePromptEditorMode === "update") {
    if (!stylePromptEditorTargetTemplateId) throw new Error("未找到待修改模板。");
    updateStylePromptTemplate(stylePromptEditorTargetTemplateId, name, prompt);
  } else {
    createStylePromptTemplate(name, prompt);
  }
  closeStylePromptEditor();
}

function createStylePromptTemplate(name: string, prompt: string): void {
  const duplicated = stylePromptTemplates.find((item) => item.name === name);
  if (duplicated) {
    throw new Error("已存在同名模板，请改名后新建，或使用“修改”。");
  }

  const now = Date.now();
  const next: StylePromptTemplateRecord = {
    id: createId("style-prompt"),
    name,
    prompt,
    createdAt: now,
    updatedAt: now,
  };
  stylePromptTemplates = sortStylePromptTemplates([next, ...stylePromptTemplates]);
  activeStylePromptTemplateId = next.id;
  persistStylePromptTemplates();
  renderStylePromptLibrary();
  setStatus(`已新建样式集提示词模板：${next.name}`);
}

function useStylePromptTemplateToRequirement(): void {
  const selected = selectedStylePromptTemplate();
  if (!selected) throw new Error("请先选择模板。");
  if (styleNlInputEl) styleNlInputEl.value = selected.prompt;
  setStatus(`已将模板“${selected.name}”引用到样式要求。`);
}

function updateStylePromptTemplate(templateId: string, name: string, prompt: string): void {
  const selected = getStylePromptTemplateById(templateId);
  if (!selected) throw new Error("未找到待修改模板。");

  const duplicated = stylePromptTemplates.find((item) => item.id !== templateId && item.name === name);
  if (duplicated) {
    throw new Error("模板名称已被占用，请使用其他名称。");
  }

  const now = Date.now();
  stylePromptTemplates = sortStylePromptTemplates(
    stylePromptTemplates.map((item) =>
      item.id === templateId
        ? {
            ...item,
            name,
            prompt,
            updatedAt: now,
          }
        : item
    )
  );
  activeStylePromptTemplateId = templateId;
  persistStylePromptTemplates();
  renderStylePromptLibrary();
  setStatus(`已修改模板：${name}`);
}

function deleteStylePromptTemplate(): void {
  const selected = selectedStylePromptTemplate();
  if (!selected) throw new Error("请先选择模板。");
  const confirmed = window.confirm(`确认删除模板“${selected.name}”吗？`);
  if (!confirmed) return;

  stylePromptTemplates = stylePromptTemplates.filter((item) => item.id !== selected.id);
  activeStylePromptTemplateId = stylePromptTemplates[0]?.id || "";
  persistStylePromptTemplates();
  renderStylePromptLibrary();
  setStatus(`已删除模板：${selected.name}`);
}

function isPrimaryStyleName(name: string): boolean {
  return !/charprop/i.test(name) && !/[（(]字符[）)]/.test(name);
}

function visibleStyleNames(query = ""): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  const includeAll = Boolean(showAllStylesEl?.checked);
  return cachedStyleNames.filter((name) => {
    if (!includeAll && !isPrimaryStyleName(name)) return false;
    if (!normalizedQuery) return true;
    return name.toLowerCase().includes(normalizedQuery);
  });
}

function populateStyleOptions(styleNames: string[]): void {
  if (!styleNameEl || !styleNameOptionsEl) return;
  styleNameOptionsEl.innerHTML = "";
  if (!styleNames.length) {
    styleNameOptionsEl.hidden = true;
    return;
  }
  styleNames.forEach((name) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "style-suggestions__item";
    option.textContent = name;
    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
      styleNameEl.value = name;
      styleNameOptionsEl.hidden = true;
    });
    styleNameOptionsEl.appendChild(option);
  });
  styleNameOptionsEl.hidden = true;
}

function renderStyleOptions(query = styleNameEl?.value || ""): void {
  populateStyleOptions(visibleStyleNames(query));
}

function openStyleSuggestions(query = styleNameEl?.value || ""): void {
  if (!styleNameOptionsEl) return;
  renderStyleOptions(query);
  styleNameOptionsEl.hidden = styleNameOptionsEl.childElementCount === 0;
}

function closeStyleSuggestions(): void {
  if (styleNameOptionsEl) styleNameOptionsEl.hidden = true;
}

function ensureStyleInputValue(): void {
  if (!styleNameEl || styleNameEl.value.trim()) return;
  const available = visibleStyleNames();
  if (available.length) {
    styleNameEl.value = available[0];
  }
}

async function refreshStyleOptions(): Promise<void> {
  const app = await getApplication();
  const styles = await listAvailableStyles(app);
  cachedStyleNames = styles.map((item) => item.name);
  renderStyleOptions();
  ensureStyleInputValue();
  const visibleCount = visibleStyleNames().length;
  setStatus(styles.length ? `已加载 ${styles.length} 个样式，当前显示 ${visibleCount} 个。` : "未读取到可用样式。", !styles.length);
}

async function applyStyleRange(): Promise<void> {
  const pageFrom = Number(stylePageFromEl?.value || 0);
  const pageTo = Number(stylePageToEl?.value || 0);
  const styleName = String(styleNameEl?.value || "").trim();
  if (!Number.isFinite(pageFrom) || pageFrom <= 0 || !Number.isFinite(pageTo) || pageTo <= 0) {
    throw new Error("请填写有效的页码范围。");
  }
  if (pageTo < pageFrom) {
    throw new Error("结束页码不能小于起始页码。");
  }
  if (!styleName) {
    throw new Error("请先选择样式名称。");
  }

  setStatus("正在按页码与对象类型处理样式，请稍候...");
  const app = await getApplication();
  const result = await applyStyleByPageRange(app, {
    pageFrom,
    pageTo,
    styleName,
    targetType: selectedStyleTargetType(),
  });
  setStatus(`样式处理完成：命中 ${result.matched} 项，成功 ${result.updated} 项，跳过 ${result.skipped} 项。`, result.updated === 0);
}

async function applyPunctuationFontRange(): Promise<void> {
  const pageFrom = Number(stylePageFromEl?.value || 0);
  const pageTo = Number(stylePageToEl?.value || 0);
  if (!Number.isFinite(pageFrom) || pageFrom <= 0 || !Number.isFinite(pageTo) || pageTo <= 0) {
    throw new Error("请填写有效的页码范围。");
  }
  if (pageTo < pageFrom) {
    throw new Error("结束页码不能小于起始页码。");
  }

  const punctuationTypes = selectedPunctuationTypes();
  if (!punctuationTypes.length) {
    throw new Error("请至少选择一种标点。");
  }

  const fontName = String(stylePunctuationFontEl?.value || "").trim();
  if (!fontName) {
    throw new Error("请先输入字体名称。");
  }

  setStatus("正在按页码处理标点字体，请稍候...");
  const app = await getApplication();
  const result = await applyPunctuationFontByPageRange(app, {
    pageFrom,
    pageTo,
    fontName,
    punctuationTypes,
  });
  setStatus(`标点字体处理完成：命中 ${result.matched} 个标点，成功 ${result.updated} 个，跳过 ${result.skipped} 个。`, result.updated === 0);
}

async function splitDocxByHeading(): Promise<void> {
  resetSplitProgress();
  const pageFrom = Number(splitPageFromEl?.value || 0);
  const pageTo = Number(splitPageToEl?.value || 0);
  if (!Number.isFinite(pageFrom) || pageFrom <= 0 || !Number.isFinite(pageTo) || pageTo <= 0) {
    throw new Error("请填写有效的拆分页码范围。");
  }
  if (pageTo < pageFrom) {
    throw new Error("拆分结束页码不能小于起始页码。");
  }

  const headingLevel = Number(splitHeadingLevelEl?.value || 0);
  if (!Number.isFinite(headingLevel) || headingLevel < 1 || headingLevel > 9) {
    throw new Error("请先选择有效的拆分粒度（标题1-标题9）。");
  }

  const outputDirectory = String(splitOutputDirEl?.value || "").trim();
  if (!outputDirectory) {
    throw new Error("请先填写导出保存目录。");
  }

  setSplitProgress(0, "准备开始拆分...");
  setStatus("正在按页码和标题级别拆分导出 DOCX，请稍候...");
  await waitForUiPaint();
  const app = await getApplication();
  setSplitProgress(1, "正在读取当前文档...");
  await waitForUiPaint();
  const result = await splitDocumentByHeadingRange(app, {
    pageFrom,
    pageTo,
    headingLevel,
    outputDirectory,
    onProgress: async (progress) => {
      renderSplitProgress(progress);
      await waitForUiPaint();
    },
  });

  const preview = result.files.slice(0, 3).map((item) => item.split(/[/\\]/).pop() || item).join("、");
  const suffix = result.files.length > 3 ? ` 等 ${result.files.length} 个文件。` : result.files.length ? ` 文件：${preview}。` : "";
  setSplitProgress(100, `导出完成：成功 ${result.exported}，跳过 ${result.skipped}`);
  setStatus(`拆分完成：识别 ${result.totalSections} 个章节，导出 ${result.exported} 个，跳过 ${result.skipped} 个。${suffix}`, result.exported === 0);
}

async function applyStyleSetByNaturalLanguage(): Promise<void> {
  const instruction = String(styleNlInputEl?.value || "").trim();
  if (!instruction) {
    throw new Error("请先输入样式要求。");
  }

  const app = await getApplication();
  const result = await applyNaturalLanguageStyleSet(app, instruction);
  const createdCount = result.details.filter((item) => item.created).length;
  const updatedCount = result.details.length - createdCount;
  const appliedNames = result.details
    .map((item) => (item.level > 0 ? `${item.appliedName}(级别${item.level})` : item.appliedName))
    .join("、");

  await refreshStyleOptions();
  if (styleNameEl && result.details.length) {
    styleNameEl.value = result.details[0].appliedName;
  }

  const modeLabel = result.mode === "named-style" ? "命名样式" : "标题样式";
  setStatus(`样式集处理完成：共 ${result.details.length} 个${modeLabel}，新增 ${createdCount} 个，更新 ${updatedCount} 个。${appliedNames ? ` 已处理：${appliedNames}。` : ""}`);
}

function renderStyleInspectionResult(result: SelectionStyleDescriptionResult): void {
  if (styleInspectNlOutputEl) {
    styleInspectNlOutputEl.value = result.naturalLanguage || "";
  }
}

async function inspectSelectionStyleResult(): Promise<void> {
  const app = await getApplication();
  const result = await describeSelectionStyle(app);
  renderStyleInspectionResult(result);
  const differenceText = result.styleConsistent ? "样式一致" : `存在差异：${result.differenceLabels.slice(0, 4).join("、") || "多项字段"}`;
  setStatus(`样式读取完成：共 ${result.paragraphCount} 个段落，${differenceText}。`);
}

function persistAllSessions(): void {
  sessions = sortSessionsForDisplay(sessions);
  persistSessions(sessions);
  renderSessionList();
}

function bindSessionToCurrentDocument(session: ChatSessionRecord): void {
  if (!currentDocumentKey) return;
  if (session.documentKey && session.documentKey !== currentDocumentKey && session.messages.length > 0) return;
  session.documentKey = currentDocumentKey;
  session.documentLabel = currentDocumentLabel;
}

async function syncCurrentDocumentContext(preferMatchingSession = false): Promise<void> {
  try {
    const app = await getApplication();
    const identity = await getDocumentIdentity(app);
    currentDocumentKey = identity.documentKey;
    currentDocumentLabel = identity.documentLabel;
    renderCurrentDocumentLabel();

    if (preferMatchingSession && sessions.length) {
      const preferredId = findPreferredSessionId(sessions, currentDocumentKey);
      if (preferredId) activeSessionId = preferredId;
    }

    const active = getActiveSession();
    if (!active.documentKey) {
      bindSessionToCurrentDocument(active);
      persistAllSessions();
    }
  } catch {
    currentDocumentKey = "";
    currentDocumentLabel = "";
    renderCurrentDocumentLabel();
  }
}

function renderDiffContent(original: string, updated: string): void {
  if (!diffContentEl) return;
  diffContentEl.innerHTML = "";
  const lines = buildUnifiedDiff(original, updated);
  lines.forEach((line) => {
    const row = document.createElement("div");
    row.className = `diff-line diff-line--${line.op}`;

    const marker = document.createElement("span");
    marker.className = "diff-line__marker";
    marker.textContent = line.op === "add" ? "+" : line.op === "remove" ? "-" : " ";

    const text = document.createElement("span");
    text.className = "diff-line__text";
    text.textContent = line.text || " ";

    row.append(marker, text);
    diffContentEl.appendChild(row);
  });
}

function openDiffModal(original: string, updated: string): Promise<"confirm" | "cancel" | "copy"> {
  return new Promise((resolve) => {
    if (!diffModalEl || !diffContentEl || !diffConfirmBtn || !diffCancelBtn || !diffCopyBtn) {
      resolve("confirm");
      return;
    }

    renderDiffContent(original, updated);
    diffModalEl.hidden = false;
    diffModalEl.setAttribute("aria-hidden", "false");
    if (diffDescriptionEl) {
      diffDescriptionEl.textContent = "请先确认差异，再决定是否写回当前选区。";
    }

    const cleanup = () => {
      diffModalEl.hidden = true;
      diffModalEl.setAttribute("aria-hidden", "true");
      diffConfirmBtn.removeEventListener("click", onConfirm);
      diffCancelBtn.removeEventListener("click", onCancel);
      diffCopyBtn.removeEventListener("click", onCopy);
    };

    const onConfirm = () => {
      cleanup();
      resolve("confirm");
    };
    const onCancel = () => {
      cleanup();
      resolve("cancel");
    };
    const onCopy = () => {
      cleanup();
      resolve("copy");
    };

    diffConfirmBtn.addEventListener("click", onConfirm, { once: true });
    diffCancelBtn.addEventListener("click", onCancel, { once: true });
    diffCopyBtn.addEventListener("click", onCopy, { once: true });
  });
}

// ---- Paragraph Diff (005) ----

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildSideBySideHtml(original: string, updated: string): string {
  if (original === updated) {
    return '<div class="cw-diff-nochange-message">未发现差异，两段文字完全相同。</div>';
  }

  const { left, right } = buildCharDiff(original, updated);

  const buildParagraphHtml = (
    segments: { op: string; text: string }[],
    highlightOp: "remove" | "add",
    highlightClass: string,
  ): string => {
    let html = '<p class="cw-diff-paragraph">';
    for (const seg of segments) {
      const escaped = escapeHtml(seg.text);
      if (escaped === "") continue;
      if (seg.op === highlightOp) {
        html += `<span class="${highlightClass}" style="display:inline">${escaped}</span>`;
      } else {
        html += escaped;
      }
    }
    html += "</p>";
    return html;
  };

  return (
    '<div class="cw-diff-column cw-diff-column--left">' +
    '<div class="cw-diff-column__title">段落 1（原始/旧版）</div>' +
    '<div class="cw-diff-column__body">' +
    buildParagraphHtml(left.filter((s) => s.op !== "add"), "remove", "cw-diff-removed") +
    "</div></div>" +
    '<div class="cw-diff-column cw-diff-column--right">' +
    '<div class="cw-diff-column__title">段落 2（修改/新版）</div>' +
    '<div class="cw-diff-column__body">' +
    buildParagraphHtml(right.filter((s) => s.op !== "remove"), "add", "cw-diff-added") +
    "</div></div>"
  );
}

function buildMergedHtml(original: string, updated: string): string {
  if (original === updated) {
    return '<div class="cw-diff-nochange-message">未发现差异，两段文字完全相同。</div>';
  }

  const segments = buildUnifiedCharDiff(original, updated);
  let html = '<p class="cw-diff-merged-paragraph">';
  for (const seg of segments) {
    const escaped = escapeHtml(seg.text);
    if (escaped === "") continue;
    if (seg.op === "remove") {
      html += `<span class="cw-diff-removed" style="display:inline">${escaped}</span>`;
    } else if (seg.op === "add") {
      html += `<span class="cw-diff-added" style="display:inline">${escaped}</span>`;
    } else {
      html += escaped;
    }
  }
  html += "</p>";
  return html;
}

function renderSideBySideDiff(original: string, updated: string): void {
  if (!cwDiffResultContentEl) return;
  cwDiffResultContentEl.innerHTML = "";
  cwDiffResultContentEl.innerHTML = buildSideBySideHtml(original, updated);

  // Also pre-render merged view
  if (cwDiffResultMergedEl) {
    cwDiffResultMergedEl.innerHTML = "";
    cwDiffResultMergedEl.innerHTML = buildMergedHtml(original, updated);
  }

  // Reset view toggle
  cwDiffCurrentView = "side";
  updateDiffViewToggle();
}

function updateDiffViewToggle(): void {
  const sideBtn = document.querySelector<HTMLButtonElement>('[data-cw-diff-view="side"]');
  const mergedBtn = document.querySelector<HTMLButtonElement>('[data-cw-diff-view="merged"]');
  if (sideBtn) sideBtn.classList.toggle("is-active", cwDiffCurrentView === "side");
  if (mergedBtn) mergedBtn.classList.toggle("is-active", cwDiffCurrentView === "merged");
  if (cwDiffResultContentEl) cwDiffResultContentEl.hidden = cwDiffCurrentView !== "side";
  if (cwDiffResultMergedEl) cwDiffResultMergedEl.hidden = cwDiffCurrentView !== "merged";
}

function switchDiffView(view: "side" | "merged"): void {
  cwDiffCurrentView = view;
  updateDiffViewToggle();
}

function handleParagraphDiff(viewMode: "side" | "merged"): void {
  const text1 = cwDiffText1El?.value ?? "";
  const text2 = cwDiffText2El?.value ?? "";

  if (!text1.trim() && !text2.trim()) {
    setStatus("请至少在一个输入框中输入文字后再进行比较。", true);
    return;
  }

  if (!text1.trim() || !text2.trim()) {
    setStatus("两个输入框都需要输入文字才能进行比较。", true);
    return;
  }

  // Compute diff HTML
  const sideHtml = text1 === text2
    ? '<div class="cw-diff-nochange-message">未发现差异，两段文字完全相同。</div>'
    : buildSideBySideHtml(text1, text2);

  const mergedHtml = text1 === text2
    ? '<div class="cw-diff-nochange-message">未发现差异，两段文字完全相同。</div>'
    : buildMergedHtml(text1, text2);

  const copyText = "=== 段落差异对比 ===\n\n--- 段落 1（原始/旧版）---\n" +
    text1 + "\n\n--- 段落 2（修改/新版）---\n" +
    text2 + "\n\n--- 差异 ---\n" +
    (text1 === text2 ? "未发现差异。" : "两段文字存在差异，请查看对比视图。");

  const isMerged = viewMode === "merged";

  // Strategy A: open system browser via bridge
  openDiffPopupExternal({
    viewMode,
    sideHtml,
    mergedHtml,
    copyText,
    original: text1,
    updated: text2,
  }).then((resp) => {
    if (resp.ok) {
      setStatus(isMerged
        ? "已在系统浏览器打开合并差异对比窗口。"
        : "已在系统浏览器打开左右差异对比窗口。");
      return;
    }
    throw new Error(resp.error || "bridge returned ok=false");
  }).catch(() => {
    // Strategy B: window.open fallback
    let popout: Window | null = null;
    try {
      popout = window.open("", "_blank", "width=1200,height=800,left=100,top=80");
    } catch {
      // ignored
    }

    if (popout && !popout.closed) {
      if (isMerged) {
        writeDiffPopoutMergedWindow(popout, text1, text2, mergedHtml, copyText);
      } else {
        writeDiffPopoutWindow(popout, text1, text2, sideHtml, mergedHtml);
      }
      setStatus(isMerged
        ? "已打开合并差异对比窗口（WebView 内）。"
        : "已打开左右差异对比窗口（WebView 内）。");
      return;
    }

    // Strategy C: in-panel dialog (last resort)
    setStatus("当前 WPS 插件环境限制，且本地 bridge 未能打开外部窗口，已回退到面板内显示。", true);

    if (isMerged) {
      if (cwDiffResultMergedEl) {
        cwDiffResultMergedEl.innerHTML = mergedHtml;
        cwDiffResultMergedEl.hidden = false;
      }
      if (cwDiffResultContentEl) cwDiffResultContentEl.hidden = true;
      cwDiffCurrentView = "merged";
      updateDiffViewToggleForFallback(true);
    } else {
      renderSideBySideDiff(text1, text2);
    }

    if (cwDiffResultDialogEl) {
      cwDiffResultDialogEl.hidden = false;
      cwDiffResultDialogEl.setAttribute("aria-hidden", "false");
    }
  });
}

function updateDiffViewToggleForFallback(mergedOnly: boolean): void {
  const sideBtn = document.querySelector<HTMLButtonElement>('[data-cw-diff-view="side"]');
  const mergedBtn = document.querySelector<HTMLButtonElement>('[data-cw-diff-view="merged"]');
  if (mergedOnly) {
    if (sideBtn) sideBtn.style.display = "none";
    if (mergedBtn) { mergedBtn.classList.add("is-active"); mergedBtn.style.display = ""; }
  } else {
    if (sideBtn) sideBtn.style.display = "";
    if (mergedBtn) mergedBtn.style.display = "";
    if (sideBtn) sideBtn.classList.toggle("is-active", cwDiffCurrentView === "side");
    if (mergedBtn) mergedBtn.classList.toggle("is-active", cwDiffCurrentView === "merged");
  }
  if (cwDiffResultContentEl) cwDiffResultContentEl.hidden = cwDiffCurrentView !== "side";
  if (cwDiffResultMergedEl) cwDiffResultMergedEl.hidden = cwDiffCurrentView !== "merged";
}

function writeDiffPopoutMergedWindow(
  w: Window,
  original: string,
  updated: string,
  mergedHtml: string,
  copyText: string,
): void {
  const copyTextJson = JSON.stringify(copyText);
  const doc = w.document;
  doc.title = "段落合并对比";
  doc.write("<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
    "<title>段落合并对比</title>\n<style>\n" +
    "*{box-sizing:border-box;margin:0;padding:0}\n" +
    "body{font-family:\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",sans-serif;font-size:14px;color:#1a1a1a;background:#fff;display:flex;flex-direction:column;height:100vh;overflow:hidden}\n" +
    ".cw-diff-toolbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #ddd;background:#fafafa}\n" +
    ".cw-diff-toolbar__label{font-size:12px;color:#888}\n" +
    ".cw-diff-toolbar__btn{height:28px;padding:0 12px;border:1px solid #ccc;border-radius:5px;background:#fff;color:#333;font-size:12px;cursor:pointer}\n" +
    ".cw-diff-toolbar__spacer{flex:1}\n" +
    ".cw-diff-merged{flex:1 1 auto;min-height:0;overflow:auto;padding:14px;background:#fcfcfc}\n" +
    ".cw-diff-merged-paragraph{margin:0;white-space:pre-wrap;word-break:break-word;line-height:1.85;font-size:14px}\n" +
    ".cw-diff-added{display:inline;background:#d4edda;color:#1a5c34;border-radius:2px;padding:1px 2px}\n" +
    ".cw-diff-removed{display:inline;background:#fde2e2;color:#9b2525;text-decoration:line-through;border-radius:2px;padding:1px 2px}\n" +
    ".cw-diff-nochange-message{display:flex;align-items:center;justify-content:center;height:100%;font-size:14px;color:#888}\n" +
    "</style>\n</head>\n<body>\n" +
    "<div class=\"cw-diff-toolbar\">" +
    "<span class=\"cw-diff-toolbar__label\">合并对比</span>" +
    "<span class=\"cw-diff-toolbar__spacer\"></span>" +
    "<button class=\"cw-diff-toolbar__btn\" onclick=\"copyResult()\">复制对比结果</button>" +
    "<button class=\"cw-diff-toolbar__btn\" onclick=\"window.close()\">关闭</button></div>\n" +
    "<div class=\"cw-diff-merged\" id=\"merged-view\">" + mergedHtml + "</div>\n" +
    "<script>\n" +
    "function copyResult(){var t=" + copyTextJson + ";navigator.clipboard.writeText(t).then(function(){var btns=document.querySelectorAll(\".cw-diff-toolbar__btn\");var last=btns[btns.length-2];var orig=last.textContent;last.textContent=\"已复制！\";setTimeout(function(){last.textContent=orig},1500)}).catch(function(){})}\n" +
    "<\\/script>\n</body>\n</html>");
  doc.close();
}

function writeDiffPopoutWindow(
  w: Window,
  original: string,
  updated: string,
  sideHtml: string,
  mergedHtml: string,
): void {
  const copyText = JSON.stringify(
    "=== 段落差异对比 ===\n\n--- 段落 1（原始/旧版）---\n" +
    original + "\n\n--- 段落 2（修改/新版）---\n" +
    updated + "\n\n--- 差异 ---\n" +
    (original === updated ? "未发现差异。" : "两段文字存在差异，请查看对比视图。"),
  );

  const doc = w.document;
  doc.title = "段落差异对比";
  doc.write("<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
    "<title>段落差异对比</title>\n<style>\n" +
    "*{box-sizing:border-box;margin:0;padding:0}\n" +
    "body{font-family:\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",sans-serif;font-size:14px;color:#1a1a1a;background:#fff;display:flex;flex-direction:column;height:100vh;overflow:hidden}\n" +
    ".cw-diff-toolbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #ddd;background:#fafafa}\n" +
    ".cw-diff-toolbar__label{font-size:12px;color:#888}\n" +
    ".cw-diff-toolbar__btn{height:28px;padding:0 12px;border:1px solid #ccc;border-radius:5px;background:#fff;color:#333;font-size:12px;cursor:pointer}\n" +
    ".cw-diff-toolbar__btn.is-active{background:#1d7f63;color:#fff;border-color:#1d7f63}\n" +
    ".cw-diff-toolbar__spacer{flex:1}\n" +
    ".cw-diff-columns{flex:1 1 auto;min-height:0;display:flex;flex-direction:row;overflow:hidden}\n" +
    ".cw-diff-column{flex:1 1 50%;min-width:0;display:flex;flex-direction:column;overflow:hidden}\n" +
    ".cw-diff-column--left{border-right:1px solid #ddd}\n" +
    ".cw-diff-column__title{flex:0 0 auto;padding:8px 14px;font-size:11px;font-weight:600;color:#888;border-bottom:1px solid #ddd;background:#f8f8f8}\n" +
    ".cw-diff-column__body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px;background:#fcfcfc}\n" +
    ".cw-diff-paragraph{margin:0;white-space:pre-wrap;word-break:break-word;line-height:1.85;font-size:14px}\n" +
    ".cw-diff-merged{flex:1 1 auto;min-height:0;overflow:auto;padding:14px;background:#fcfcfc}\n" +
    ".cw-diff-merged-paragraph{margin:0;white-space:pre-wrap;word-break:break-word;line-height:1.85;font-size:14px}\n" +
    ".cw-diff-added{display:inline;background:#d4edda;color:#1a5c34;border-radius:2px;padding:1px 2px}\n" +
    ".cw-diff-removed{display:inline;background:#fde2e2;color:#9b2525;text-decoration:line-through;border-radius:2px;padding:1px 2px}\n" +
    ".cw-diff-nochange-message{display:flex;align-items:center;justify-content:center;height:100%;font-size:14px;color:#888}\n" +
    "@media(max-width:800px){.cw-diff-columns{flex-direction:column}.cw-diff-column--left{border-right:none;border-bottom:1px solid #ddd}}\n" +
    "</style>\n</head>\n<body>\n" +
    "<div class=\"cw-diff-toolbar\">" +
    "<span class=\"cw-diff-toolbar__label\">视图：</span>" +
    "<button class=\"cw-diff-toolbar__btn is-active\" onclick=\"switchView('side')\" id=\"btn-side\">左右对比</button>" +
    "<button class=\"cw-diff-toolbar__btn\" onclick=\"switchView('merged')\" id=\"btn-merged\">合并对比</button>" +
    "<span class=\"cw-diff-toolbar__spacer\"></span>" +
    "<button class=\"cw-diff-toolbar__btn\" onclick=\"copyResult()\">复制对比结果</button>" +
    "<button class=\"cw-diff-toolbar__btn\" onclick=\"window.close()\">关闭</button></div>\n" +
    "<div class=\"cw-diff-columns\" id=\"side-view\">" + sideHtml + "</div>\n" +
    "<div class=\"cw-diff-merged\" id=\"merged-view\" hidden>" + mergedHtml + "</div>\n" +
    "<script>\n" +
    "function switchView(v){document.getElementById(\"side-view\").hidden=v!==\"side\";document.getElementById(\"merged-view\").hidden=v!==\"merged\";document.getElementById(\"btn-side\").classList.toggle(\"is-active\",v===\"side\");document.getElementById(\"btn-merged\").classList.toggle(\"is-active\",v===\"merged\")}\n" +
    "function copyResult(){var t=" + copyText + ";navigator.clipboard.writeText(t).then(function(){var btns=document.querySelectorAll(\".cw-diff-toolbar__btn\");var last=btns[btns.length-2];var orig=last.textContent;last.textContent=\"已复制！\";setTimeout(function(){last.textContent=orig},1500)}).catch(function(){})}\n" +
    "<\\/script>\n</body>\n</html>");
  doc.close();
}

function closeParagraphDiffDialog(): void {
  if (cwDiffResultDialogEl) {
    cwDiffResultDialogEl.hidden = true;
    cwDiffResultDialogEl.setAttribute("aria-hidden", "true");
  }
}

async function copyParagraphDiffResult(): Promise<void> {
  const text1 = cwDiffText1El?.value ?? "";
  const text2 = cwDiffText2El?.value ?? "";
  const result = `=== 段落差异对比 ===

--- 段落 1（原始/旧版）---
${text1}

--- 段落 2（修改/新版）---
${text2}

--- 差异 ---
${text1 === text2 ? "未发现差异。" : "两段文字存在差异，请查看并排对比视图。"}`;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(result);
    setStatus("已复制对比结果到剪贴板。");
  } else {
    setStatus("无法复制：剪贴板不可用。", true);
  }
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const temp = document.createElement("textarea");
  temp.value = text;
  temp.style.position = "fixed";
  temp.style.opacity = "0";
  document.body.appendChild(temp);
  temp.select();
  document.execCommand("copy");
  temp.remove();
}

async function confirmWriteBack(app: any, newText: string, source: string): Promise<boolean> {
  const originalText = await getSelectionText(app);
  if (!originalText.trim()) {
    throw new Error("当前选区为空，无法直接写回。请先选中文本；如需追加内容，请使用“插入回复”。");
  }

  const diffLines = buildUnifiedDiff(originalText, newText);
  if (!hasMeaningfulDiff(diffLines)) {
    setStatus(`${source}未检测到文本变化。`);
    return false;
  }

  while (true) {
    const action = await openDiffModal(originalText, newText);
    if (action === "copy") {
      await copyTextToClipboard(newText);
      setStatus("已复制新文本，请继续决定是否写回。");
      continue;
    }
    if (action === "cancel") {
      setStatus(`已取消${source}。`);
      return false;
    }
    await replaceSelection(app, newText);
    return true;
  }
}

async function writeWordContent(app: any, text: string, mode: "replace" | "insert", source: string): Promise<boolean> {
  const structured = detectStructuredContent(text);

  if (structured?.kind === "table") {
    if (mode === "replace") {
      const accepted = window.confirm(`${source}识别为表格内容，将以 Word 表格形式写入当前选区。是否继续？`);
      if (!accepted) {
        setStatus(`已取消${source}。`);
        return false;
      }
      await replaceSelectionWithTable(app, structured.rows);
      return true;
    }
    await insertTableAfterSelection(app, structured.rows);
    return true;
  }

  if (mode === "replace") {
    return confirmWriteBack(app, text, source);
  }

  await insertAfterSelection(app, text);
  return true;
}

interface ResolvedContext {
  text: string;
  notice: string;
}

async function resolveContext(app: any, requestedScope: ContextScope): Promise<ResolvedContext> {
  if (requestedScope === "selection") {
    const fallbackText = await getSelectionOrParagraphText(app);
    if (!fallbackText) {
      return { text: "", notice: "当前没有可用选区或段落内容。" };
    }
    const selectionText = await getSelectionText(app);
    return selectionText
      ? { text: selectionText, notice: "已使用当前选区作为上下文。" }
      : { text: fallbackText, notice: "当前选区为空，已自动回退到当前段落。" };
  }

  if (requestedScope === "paragraph") {
    return { text: await getCurrentParagraphText(app), notice: "已使用当前段落作为上下文。" };
  }

  if (requestedScope === "heading") {
    const result = await getHeadingSectionText(app);
    if (result.heading) {
      return {
        text: result.text,
        notice: result.truncated ? `已读取标题“${result.heading}”下内容，因过长已截断。` : `已读取标题“${result.heading}”下内容。`,
      };
    }
    return { text: result.text, notice: "未识别到标题结构，已回退到当前段落。" };
  }

  const result = await getDocumentText(app);
  return {
    text: result.text,
    notice: result.truncated ? "已读取全文摘要上下文，因过长已按长度限制截断。" : "已读取全文作为上下文。",
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf("base64,");
      if (idx < 0) {
        reject(new Error(`文件编码失败：${file.name}`));
        return;
      }
      resolve(result.slice(idx + "base64,".length));
    };
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function renderAttachmentTray(): void {
  if (!attachmentTrayEl) return;
  const active = getActiveSession();
  attachmentTrayEl.innerHTML = "";
  const attachments = [
    ...active.pendingImages.map((item) => ({ type: "image" as const, name: item.name, meta: "图片", path: item.path })),
    ...active.pendingFiles.map((item) => ({ type: "file" as const, name: item.name, meta: formatFileSize(item.size), path: item.path })),
  ];
  attachmentTrayEl.hidden = attachments.length === 0;
  attachments.forEach((item, index) => {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    chip.title = item.path;

    const name = document.createElement("span");
    name.className = "attachment-chip__name";
    name.textContent = `${item.type === "image" ? "▧" : "▤"} ${item.name}`;
    chip.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "attachment-chip__meta";
    meta.textContent = item.meta;
    chip.appendChild(meta);

    const remove = document.createElement("span");
    remove.className = "attachment-chip__remove";
    remove.tabIndex = 0;
    remove.role = "button";
    remove.title = "移除附件";
    remove.textContent = "×";
    const removeAttachment = () => {
      if (item.type === "image") active.pendingImages.splice(index, 1);
      else active.pendingFiles.splice(index - active.pendingImages.length, 1);
      touchSession(active);
      persistAllSessions();
      renderAttachmentTray();
    };
    remove.addEventListener("click", removeAttachment);
    remove.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      removeAttachment();
    });
    chip.appendChild(remove);
    attachmentTrayEl.appendChild(chip);
  });
}

async function uploadFiles(files: FileList | File[]): Promise<void> {
  const active = getActiveSession();
  let imageCount = 0;
  let fileCount = 0;
  for (const file of Array.from(files)) {
    const base64 = await fileToBase64(file);
    if (isImageFile(file)) {
      const uploaded = await uploadImageAsset({
        name: file.name,
        dataBase64: base64,
      });
      active.pendingImages.push({
        name: uploaded.name || file.name,
        path: uploaded.path,
        previewDataUrl: `data:${file.type || "image/png"};base64,${base64}`,
        uploadedAt: Date.now(),
      });
      imageCount += 1;
    } else {
      const uploaded = await uploadFileAsset({
        name: file.name,
        dataBase64: base64,
        mimeType: file.type || "application/octet-stream",
      });
      active.pendingFiles.push({
        name: uploaded.name || file.name,
        path: uploaded.path,
        mimeType: uploaded.mimeType || file.type || "application/octet-stream",
        size: uploaded.size || file.size,
        uploadedAt: Date.now(),
      });
      fileCount += 1;
    }
  }
  touchSession(active);
  persistAllSessions();
  renderAttachmentTray();
  setStatus(`已添加 ${imageCount} 张图片、${fileCount} 个文件，发送消息后会一并提交。`);
}

function imageAttachmentsFromPending(active: ChatSessionRecord): ChatImageAttachment[] {
  return active.pendingImages.map((image) => ({ name: image.name, path: image.path }));
}

function fileAttachmentsFromPending(active: ChatSessionRecord): ChatFileAttachment[] {
  return active.pendingFiles.map((file) => ({ name: file.name, path: file.path, mimeType: file.mimeType, size: file.size }));
}

function maybeUpdateSessionTitle(active: ChatSessionRecord, userText: string): void {
  if (active.messages.length > 1) return;
  if (active.title !== INITIAL_SESSION_TITLE && active.title !== generatedSessionTitle(active)) return;
  active.title = shortenTitle(userText);
}

function persistActiveSession(active: ChatSessionRecord): void {
  bindSessionToCurrentDocument(active);
  touchSession(active);
  sessions = sessions.filter((item) => item.id !== active.id).concat(active);
  persistAllSessions();
  updateChatActionButtons();
}

function syncLastAssistantOutput(session: ChatSessionRecord): void {
  const latestAssistant = [...session.messages].reverse().find((message) => message.role === "assistant" && message.text.trim());
  session.lastAssistantOutput = latestAssistant?.text.trim() || "";
}

function deleteMessageAt(index: number): void {
  const active = getActiveSession();
  if (index < 0 || index >= active.messages.length) return;
  active.messages.splice(index, 1);
  syncLastAssistantOutput(active);
  persistActiveSession(active);
  redrawActiveSession();
  setStatus("已删除该条回复。");
}

function findUserBeforeAssistant(active: ChatSessionRecord, assistantIndex: number): number {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (active.messages[index]?.role === "user") return index;
  }
  return assistantIndex;
}

function deleteMessageTurnAt(index: number): void {
  const active = getActiveSession();
  if (index < 0 || index >= active.messages.length) return;
  const from = active.messages[index]?.role === "assistant" ? findUserBeforeAssistant(active, index) : index;
  const count = Math.max(1, index - from + 1);
  active.messages.splice(from, count);
  syncLastAssistantOutput(active);
  persistActiveSession(active);
  redrawActiveSession();
  setStatus("已删除本轮问答。");
}

function rewriteMessageTurnAt(index: number): void {
  const active = getActiveSession();
  const from = active.messages[index]?.role === "assistant" ? findUserBeforeAssistant(active, index) : index;
  const question = active.messages[from]?.role === "user" ? active.messages[from].text : "";
  if (chatInputEl) {
    chatInputEl.value = question;
    chatInputEl.focus();
    chatInputEl.setSelectionRange(chatInputEl.value.length, chatInputEl.value.length);
  }
  const count = Math.max(1, index - from + 1);
  active.messages.splice(from, count);
  syncLastAssistantOutput(active);
  persistActiveSession(active);
  redrawActiveSession();
  setStatus("已把原问题放回输入框，可修改后重新发送。");
}

function buildRewriteInstruction(message: ChatMessageRecord): string {
  const capability = getCapabilityProfile(selectedCapabilityProfile());
  return [
    "请重写你上一条回复，保留原意并提升可用性。",
    capability.id === "word-rewrite" ? "输出必须是适合直接写回 Word 的纯文本，不要带 Markdown 标记。" : "",
    capability.id === "word-review" ? "请保持为审阅建议格式，用纯文本编号，不要使用 Markdown 标题。" : "",
    "原回复如下：",
    message.text,
  ]
    .filter(Boolean)
    .join("\n");
}

async function rewriteAssistantMessageAt(index: number): Promise<void> {
  const active = getActiveSession();
  const target = active.messages[index];
  if (!target || target.role !== "assistant") return;

  const capability = getCapabilityProfile(selectedCapabilityProfile());
  const payload = basePayload(buildRewriteInstruction(target), capability.instruction, []);
  payload.threadId = active.threadId || undefined;

  const messageEl = chatLogEl?.querySelectorAll<HTMLDivElement>(".chat-message__text")[index] || null;
  const originalText = target.text;
  target.text = "";
  updateChatMessageText(messageEl, "...");
  setStatus("正在重写该条回复...");

  const streamController = new AbortController();
  activeStreamAbortController = streamController;
  activeStreamRunId = "";
  setBusy(true);

  try {
    const result = await runByBridgeStream(payload, {
      signal: streamController.signal,
      onRunStarted: (runId) => {
        activeStreamRunId = runId;
        if (chatStopBtn) chatStopBtn.disabled = false;
      },
      onDelta: (chunk) => {
        target.text += chunk;
        updateChatMessageText(messageEl, target.text || "...");
      },
    });
    target.text = (result.output || target.text).trim() || originalText;
    if (result.threadId) active.threadId = result.threadId;
    syncLastAssistantOutput(active);
    persistActiveSession(active);
    updateChatMessageText(messageEl, target.text);
    setStatus("已重写该条回复。");
  } catch (error) {
    target.text = originalText;
    updateChatMessageText(messageEl, target.text);
    setStatus((error as Error).message, true);
  } finally {
    activeStreamAbortController = null;
    activeStreamRunId = "";
    setBusy(false);
  }
}

async function stopActiveRun(): Promise<void> {
  const controller = activeStreamAbortController;
  const runId = activeStreamRunId;
  if (!controller) return;
  controller.abort();
  activeStreamAbortController = null;
  activeStreamRunId = "";
  if (runId) {
    try {
      await cancelBridgeRun(runId);
    } catch {
      // Best effort: connection abort usually already stops server-side process.
    }
  }
  setStatus("已停止生成。");
  setBusy(false);
}

async function runChat(): Promise<void> {
  const active = getActiveSession();
  const input = String(chatInputEl?.value || "").trim();
  const hasPendingImages = active.pendingImages.length > 0;
  const hasPendingFiles = active.pendingFiles.length > 0;
  const presetId = selectedPromptPreset();
  const preset = getPromptPreset(presetId);
  if (!input && !hasPendingImages && !hasPendingFiles && !preset.defaultUserText) return;

  let contextText = "";
  let contextNotice = "";
  let app: any = null;
  try {
    app = await getApplication();
    const identity = await getDocumentIdentity(app);
    currentDocumentKey = identity.documentKey;
    currentDocumentLabel = identity.documentLabel;
    renderCurrentDocumentLabel();
    bindSessionToCurrentDocument(active);
    const resolvedContext = await resolveContext(app, selectedContextScope());
    contextText = resolvedContext.text.trim();
    contextNotice = resolvedContext.notice;
  } catch {
    contextText = "";
    contextNotice = "";
  }

  const prompt = buildPrompt(presetId, selectedContextScope(), input, contextNotice);
  const capability = getCapabilityProfile(selectedCapabilityProfile());
  const capabilityInstruction = presetId === "punctuation-fragments" ? "" : capability.instruction;
  const userText = prompt.userText || "请结合当前上下文处理内容。";
  const userImages = active.pendingImages.slice();
  const userFiles = active.pendingFiles.slice();
  const userMessage: ChatMessageRecord = {
    id: createId("msg"),
    role: "user",
    text: userText,
    images: userImages,
    files: userFiles,
    createdAt: Date.now(),
  };
  active.messages.push(userMessage);
  maybeUpdateSessionTitle(active, userText);
  appendChat(userMessage, active.messages.length - 1);
  if (chatInputEl) chatInputEl.value = "";

  const payload = basePayload(
    userText,
    [capabilityInstruction, prompt.instruction, contextText].filter(Boolean).join("\n\n"),
    imageAttachmentsFromPending(active),
    fileAttachmentsFromPending(active)
  );
  payload.threadId = active.threadId || undefined;
  setStatus(contextNotice ? `Codex 对话中...${contextNotice}` : "Codex 对话中...");
  const assistantMessage: ChatMessageRecord = {
    id: createId("msg"),
    role: "assistant",
    text: "",
    images: [],
    files: [],
    createdAt: Date.now(),
  };
  active.messages.push(assistantMessage);
  const assistantMessageEl = appendChat(assistantMessage, active.messages.length - 1);

  const streamController = new AbortController();
  activeStreamAbortController = streamController;
  activeStreamRunId = "";
  setBusy(true);

  let streamedOutput = "";
  let streamAborted = false;
  try {
    const result = await runByBridgeStream(payload, {
      signal: streamController.signal,
      onRunStarted: (runId) => {
        activeStreamRunId = runId;
        if (chatStopBtn) chatStopBtn.disabled = false;
      },
      onDelta: (chunk) => {
        assistantMessage.text += chunk;
        updateChatMessageText(assistantMessageEl, assistantMessage.text || "...");
      },
    });
    streamedOutput = result.output || assistantMessage.text;
    streamAborted = Boolean(result.aborted);
    if (result.threadId) active.threadId = result.threadId;
  } catch (error) {
    const message = (error as Error).message || "";
    if (streamController.signal.aborted || /abort|已停止/i.test(message)) {
      streamAborted = true;
    } else {
      throw error;
    }
  } finally {
    activeStreamAbortController = null;
    activeStreamRunId = "";
    if (busy) setBusy(true);
  }

  const finalAssistantText = (streamedOutput || assistantMessage.text).trim();
  assistantMessage.text = finalAssistantText || (streamAborted ? "(已停止)" : "(无输出)");
  updateChatMessageText(assistantMessageEl, assistantMessage.text);
  active.pendingImages = [];
  active.pendingFiles = [];
  renderAttachmentTray();
  active.lastAssistantOutput = finalAssistantText;

  if (streamAborted) {
    setStatus("已停止生成。");
    persistActiveSession(active);
    return;
  }

  const wantsImage = /图片|插图|配图|image|figure/i.test(userText);
  const wantsWriteBack =
    capability.writebackPolicy === "allow" &&
    (/修改|改写|润色|写回|替换|更新|正式|压缩|扩写|错别字/.test(userText) ||
      ["polish", "formal", "compress", "expand", "typo"].includes(preset.id));
  const wantsInsert = /插入|追加|加入/.test(userText);

  if (selectedMode() === "agent" && app) {
    let writeBackAccepted = false;
    if (wantsWriteBack && contextText && active.lastAssistantOutput.trim()) {
      writeBackAccepted = await writeWordContent(app, active.lastAssistantOutput, "replace", "agent 写回");
      if (writeBackAccepted) setStatus("agent 已写回选区。");
    }
    if (wantsImage) {
      await insertChatIllustration(userText);
      setStatus(writeBackAccepted ? "agent 已写回选区并插入插图。" : "agent 已插入插图。");
    } else if (wantsInsert && !wantsWriteBack && active.lastAssistantOutput.trim()) {
      await writeWordContent(app, active.lastAssistantOutput, "insert", "插入回复");
      setStatus("agent 已插入回复。");
    } else if (!wantsImage && !wantsWriteBack && !wantsInsert) {
      setStatus("对话完成。");
    }
  } else {
    setStatus("对话完成。");
  }

  persistActiveSession(active);
}

async function loadConfig(): Promise<void> {
  const config = await getBridgeConfig();
  const nextCliPath = config.cliPath || config.detectedCliPaths[0] || "";
  const nextWorkingDir = config.workingDir || "";
  loadedConfigSnapshot = { cliPath: nextCliPath, workingDir: nextWorkingDir };
  if (cliPathEl) cliPathEl.value = nextCliPath;
  if (workingDirEl) workingDirEl.value = nextWorkingDir;
  settingsDirty = false;
  renderSettingsStatus();
}

async function loadModels(): Promise<void> {
  const current = selectedModel();
  const response = await getCodexModels();
  if (!modelEl) return;
  modelEl.innerHTML = "";
  response.models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelEl.appendChild(option);
  });
  modelEl.value = current || response.defaultModel || response.models[0] || "";
}

async function detectCli(): Promise<void> {
  const config = await getBridgeConfig();
  if (cliPathEl) cliPathEl.value = config.detectedCliPaths[0] || config.cliPath || "";
  updateSettingsDirtyState();
  if (settingsAutoSave && settingsDirty) {
    await saveConfig("已自动嗅探并保存 Codex CLI 路径。");
  } else {
    setStatus(config.detectedCliPaths.length ? "已自动嗅探 Codex CLI。" : "未嗅探到 Codex CLI。", !config.detectedCliPaths.length);
  }
}

async function saveConfig(statusText = "配置已保存，已对后续请求生效。"): Promise<void> {
  if (settingsSaveTimer) {
    window.clearTimeout(settingsSaveTimer);
    settingsSaveTimer = null;
  }
  const config = await saveBridgeConfig({
    cliPath: cliPathEl?.value.trim() || "",
    workingDir: workingDirEl?.value.trim() || "",
  });
  loadedConfigSnapshot = {
    cliPath: config.cliPath || "",
    workingDir: config.workingDir || "",
  };
  if (cliPathEl) cliPathEl.value = loadedConfigSnapshot.cliPath;
  if (workingDirEl) workingDirEl.value = loadedConfigSnapshot.workingDir;
  settingsDirty = false;
  lastSavedAt = Date.now();
  renderSettingsStatus();
  setStatus(statusText);
}

async function applyChatToSelection(): Promise<void> {
  const active = getActiveSession();
  if (!active.lastAssistantOutput.trim()) return;
  const app = await getApplication();
  const accepted = await writeWordContent(app, active.lastAssistantOutput, "replace", "写回选区");
  if (accepted) setStatus("已将最近回复写回选区。");
}

async function insertChatText(): Promise<void> {
  const active = getActiveSession();
  if (!active.lastAssistantOutput.trim()) return;
  const app = await getApplication();
  await writeWordContent(app, active.lastAssistantOutput, "insert", "插入回复");
  setStatus("已插入最近回复。");
}

async function insertChatIllustration(prompt?: string): Promise<void> {
  const active = getActiveSession();
  const app = await getApplication();
  const source = String(prompt || chatInputEl?.value || active.lastAssistantOutput || "文档配图").trim();
  const illustration = await createIllustration({
    title: "文档配图",
    prompt: source || active.lastAssistantOutput || "文档配图",
  });
  try {
    await insertImageAfterSelection(app, illustration.path);
  } catch {
    await insertAfterSelection(app, `\n[图片文件：${illustration.path}]\n`);
  }
}

function createNewSession(): void {
  const session = makeSession(INITIAL_SESSION_TITLE, currentDocumentKey, currentDocumentLabel);
  ensureSessionTitle(session);
  setMultiSelectMode(false);
  sessions = [session, ...sessions];
  activeSessionId = session.id;
  persistAllSessions();
  redrawActiveSession();
  showChatPage();
  setStatus("已新建会话。");
}

function exportSession(session: ChatSessionRecord): void {
  const markdown = buildSessionMarkdown(session);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${session.title || "session"}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatus(`已导出会话：${sessionDisplayTitle(session)}`);
}

chatSendBtn?.addEventListener("click", () => {
  void (async () => {
    if (busy) {
      await stopActiveRun();
      return;
    }
    try {
      setBusy(true);
      await runChat();
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});

chatStopBtn?.addEventListener("click", () => {
  void stopActiveRun();
});

chatInputEl?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    chatSendBtn?.click();
  }
});

chatInputEl?.addEventListener("paste", (event) => {
  const items = Array.from(event.clipboardData?.items || []);
  const files = items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (!files.length) return;
  event.preventDefault();
  void (async () => {
    try {
      setBusy(true);
      await uploadFiles(files);
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});

chatInputEl?.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  chatInputEl.classList.add("is-dragover");
});

chatInputEl?.addEventListener("dragleave", () => {
  chatInputEl.classList.remove("is-dragover");
});

chatInputEl?.addEventListener("drop", (event) => {
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  event.preventDefault();
  chatInputEl.classList.remove("is-dragover");
  void (async () => {
    try {
      setBusy(true);
      await uploadFiles(files);
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});

chatUploadImageBtn?.addEventListener("click", () => {
  chatImageFileEl?.click();
});

chatImageFileEl?.addEventListener("change", () => {
  void (async () => {
    const files = chatImageFileEl.files;
    if (!files?.length) return;
    try {
      setBusy(true);
      await uploadFiles(files);
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      chatImageFileEl.value = "";
      setBusy(false);
    }
  })();
});

detectCliBtn?.addEventListener("click", () => void detectCli());
saveConfigBtn?.addEventListener("click", () => void saveConfig());
settingsResetBtn?.addEventListener("click", () => {
  revertConfigDraft();
  setStatus("已撤销未保存改动。");
});
settingsToggleBtn?.addEventListener("click", openSettingsPanel);
settingsCloseBtn?.addEventListener("click", closeSettingsPanel);
settingsAutoSaveEl?.addEventListener("change", () => {
  settingsAutoSave = settingsAutoSaveEl.checked;
  if (settingsAutoSave) scheduleSettingsAutoSave();
});
settingsPanelEl?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target?.dataset?.close === "1") closeSettingsPanel();
});
cliPathEl?.addEventListener("input", () => {
  updateSettingsDirtyState();
  scheduleSettingsAutoSave();
});
workingDirEl?.addEventListener("input", () => {
  updateSettingsDirtyState();
  scheduleSettingsAutoSave();
});
refreshModelsBtn?.addEventListener("click", () => void loadModels());
refreshStyleOptionsBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      setBusy(true);
      await refreshStyleOptions();
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});
showAllStylesEl?.addEventListener("change", () => {
  renderStyleOptions();
  ensureStyleInputValue();
});
styleNameEl?.addEventListener("input", () => {
  openStyleSuggestions(styleNameEl.value);
});
styleNameEl?.addEventListener("focus", () => {
  openStyleSuggestions(styleNameEl.value);
});
styleNameEl?.addEventListener("blur", () => {
  window.setTimeout(() => closeStyleSuggestions(), 120);
});
styleApplyModeEl?.addEventListener("change", () => {
  setStyleApplyMode(styleApplyModeEl.value === "punctuation" ? "punctuation" : "paragraph");
});
punctuationMultiselectToggleBtn?.addEventListener("click", () => {
  setPunctuationMultiselectOpen(Boolean(punctuationMultiselectMenuEl?.hidden));
});
[punctuationQuoteEl, punctuationCommaEl, punctuationColonEl].forEach((checkbox) => {
  checkbox?.addEventListener("change", renderPunctuationMultiselect);
});
applyStyleRangeBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      setBusy(true);
      await applyStyleRange();
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});
applyPunctuationFontRangeBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      setBusy(true);
      await applyPunctuationFontRange();
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});
splitDocxByHeadingBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      setBusy(true);
      await splitDocxByHeading();
    } catch (error) {
      const message = (error as Error).message;
      setSplitProgress(100, `拆分失败：${message}`, true);
      setStatus(message, true);
    } finally {
      setBusy(false);
    }
  })();
});
applyStyleNlBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      setBusy(true);
      await applyStyleSetByNaturalLanguage();
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});
inspectStyleSelectionBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      setBusy(true);
      await inspectSelectionStyleResult();
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});
stylePromptTemplateSelectEl?.addEventListener("change", () => {
  activeStylePromptTemplateId = String(stylePromptTemplateSelectEl.value || "").trim();
  renderStylePromptTemplateControls();
});
stylePromptCreateBtn?.addEventListener("click", () => {
  try {
    openStylePromptEditor("create");
  } catch (error) {
    setStatus((error as Error).message, true);
  }
});
stylePromptUpdateBtn?.addEventListener("click", () => {
  try {
    openStylePromptEditor("update");
  } catch (error) {
    setStatus((error as Error).message, true);
  }
});
stylePromptDeleteBtn?.addEventListener("click", () => {
  try {
    deleteStylePromptTemplate();
  } catch (error) {
    setStatus((error as Error).message, true);
  }
});
stylePromptUseBtn?.addEventListener("click", () => {
  try {
    useStylePromptTemplateToRequirement();
  } catch (error) {
    setStatus((error as Error).message, true);
  }
});
stylePromptEditorCancelBtn?.addEventListener("click", closeStylePromptEditor);
stylePromptEditorConfirmBtn?.addEventListener("click", () => {
  try {
    submitStylePromptEditor();
  } catch (error) {
    setStatus((error as Error).message, true);
  }
});
stylePromptEditorDialogEl?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target?.dataset?.close === "1") closeStylePromptEditor();
});
stylePromptEditorNameEl?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    stylePromptEditorConfirmBtn?.click();
  }
});
stylePromptEditorContentEl?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    stylePromptEditorConfirmBtn?.click();
  }
});
newChatSessionBtn?.addEventListener("click", createNewSession);
openStyleToolBtn?.addEventListener("click", showStyleToolPage);
manageChatSessionsBtn?.addEventListener("click", showSessionManagerPage);
backToChatFromStyleBtn?.addEventListener("click", showChatPage);
sessionBackChatBtn?.addEventListener("click", showChatPage);
sessionOpenSelectedBtn?.addEventListener("click", openCurrentSelectedSession);
sessionManageModeToggleBtn?.addEventListener("click", () => setMultiSelectMode(!multiSelectMode));
sessionSelectAllBtn?.addEventListener("click", selectAllFilteredSessions);
sessionDeleteSelectedBtn?.addEventListener("click", () => {
  if (!selectedSessionIds.size) return;
  const confirmed = window.confirm(`确认删除选中的 ${selectedSessionIds.size} 个会话吗？此操作不可恢复。`);
  if (!confirmed) return;
  deleteSessionsByIds(Array.from(selectedSessionIds));
  setStatus("已删除选中的会话。");
});
sessionSearchEl?.addEventListener("input", () => {
  renderSessionList();
});
sessionContextMenuEl?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  const session = sessions.find((item) => item.id === contextMenuSessionId);
  closeSessionContextMenu();
  if (!session) return;
  const action = button.dataset.action;
  if (action === "pin") {
    session.pinned = !session.pinned;
    persistActiveSession(session);
    setStatus(session.pinned ? "已置顶会话。" : "已取消置顶。");
    return;
  }
  if (action === "rename") {
    openSessionRenameDialog(session.id);
    return;
  }
  if (action === "export") {
    exportSession(session);
    return;
  }
  if (action === "delete") {
    const confirmed = window.confirm(`确认删除会话“${sessionDisplayTitle(session)}”吗？此操作不可恢复。`);
    if (!confirmed) return;
    deleteSessionsByIds([session.id]);
    setStatus("已删除该会话。");
  }
});
sessionRenameCancelBtn?.addEventListener("click", closeSessionRenameDialog);
sessionRenameConfirmBtn?.addEventListener("click", commitRenameSession);
sessionRenameInputEl?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    commitRenameSession();
  }
});
sessionRenameDialogEl?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target?.dataset?.close === "1") closeSessionRenameDialog();
});
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (punctuationMultiselectEl && !punctuationMultiselectEl.contains(target)) {
    setPunctuationMultiselectOpen(false);
  }
  if (!target.closest(".session-item__action") && !target.closest("#session-context-menu")) {
    closeSessionContextMenu();
  }
});
document.addEventListener("mouseover", (event) => {
  const target = event.target as HTMLElement;
  const popover = target.closest<HTMLElement>(".help-popover");
  if (popover) showHelpTooltip(popover);
});
document.addEventListener("mouseout", (event) => {
  const target = event.target as HTMLElement;
  const popover = target.closest<HTMLElement>(".help-popover");
  if (popover && !popover.contains(event.relatedTarget as Node | null)) hideHelpTooltip(popover);
});
document.addEventListener("focusin", (event) => {
  const target = event.target as HTMLElement;
  const popover = target.closest<HTMLElement>(".help-popover");
  if (popover) showHelpTooltip(popover);
});
document.addEventListener("focusout", (event) => {
  const target = event.target as HTMLElement;
  const popover = target.closest<HTMLElement>(".help-popover");
  if (popover) hideHelpTooltip(popover);
});
window.addEventListener("scroll", () => activeHelpPopoverEl && positionHelpTooltip(activeHelpPopoverEl), true);
window.addEventListener("resize", () => activeHelpPopoverEl && positionHelpTooltip(activeHelpPopoverEl));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideHelpTooltip();
    closeSessionContextMenu();
    closeSessionRenameDialog();
    closeStylePromptEditor();
    closeParagraphDiffDialog();
    closeSettingsPanel();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && settingsPanelEl && !settingsPanelEl.hidden) {
    event.preventDefault();
    void saveConfig();
  }
});
promptPresetEl?.addEventListener("change", () => {
  const preset = getPromptPreset(selectedPromptPreset());
  const capability = getCapabilityProfile(selectedCapabilityProfile());
  if (!chatInputEl || chatInputEl.value.trim()) return;
  chatInputEl.placeholder =
    preset.id === "custom"
      ? capability.placeholder
      : `${capability.placeholder} 直接发送则默认执行“${preset.label}”。`;
});

capabilityProfileEl?.addEventListener("change", () => {
  promptPresetEl?.dispatchEvent(new Event("change"));
});

promptPresetEl?.dispatchEvent(new Event("change"));

chatApplySelectionBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      setBusy(true);
      await applyChatToSelection();
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});

chatInsertTextBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      setBusy(true);
      await insertChatText();
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});

chatInsertImageBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      setBusy(true);
      await insertChatIllustration();
      setStatus("已插入插图。");
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  })();
});

closePanelBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      await closeCurrentPanel();
    } catch {
      // Ignore close failures in standalone browser mode.
    }
  })();
});

// ---- Paragraph Diff (005) event listeners ----
cwDiffCompareBtn?.addEventListener("click", () => handleParagraphDiff("side"));
cwDiffCompareMergedBtn?.addEventListener("click", () => handleParagraphDiff("merged"));
cwDiffResultCloseBtn?.addEventListener("click", closeParagraphDiffDialog);
cwDiffResultCopyBtn?.addEventListener("click", () => {
  void (async () => {
    await copyParagraphDiffResult();
  })();
});
cwDiffResultDialogEl?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target?.dataset?.close === "1") closeParagraphDiffDialog();
  const view = target?.dataset?.cwDiffView;
  if (view === "side" || view === "merged") switchDiffView(view);
});

void (async () => {
  try {
    const restored = loadSessionsFromStorage();
    sessions = restored.sessions;
    activeSessionId = restored.activeSessionId;
    settingsAutoSave = settingsAutoSaveEl?.checked !== false;
    setMultiSelectMode(false);
    loadStylePromptTemplates();
    renderStylePromptLibrary();
    resetSplitProgress();
    await syncCurrentDocumentContext(true);
    sessions.forEach(ensureSessionTitle);
    persistAllSessions();
    redrawActiveSession();
    await Promise.all([loadConfig(), loadModels()]);
    try {
      await refreshStyleOptions();
    } catch {
      populateStyleOptions([]);
    }
    renderSettingsStatus();
    setBusy(false);
    setStatus("就绪：请选择会话并开始对话。");
  } catch (error) {
    setStatus((error as Error).message, true);
  }
})();
