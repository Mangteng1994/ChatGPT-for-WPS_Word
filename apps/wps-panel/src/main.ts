import { runByBridge } from "./api-client";
import { defaultInstruction } from "./prompt-builder";
import { getSelectionText, insertAfterSelection, replaceSelection } from "./wps-adapter";
import type { CodexRunRequest, TaskType } from "../../../shared/types";
import "./style.css";

declare global {
  interface Window {
    instance?: any;
  }
}

let threadId = "";

const statusEl = document.querySelector<HTMLDivElement>("#status");
const instructionEl = document.querySelector<HTMLTextAreaElement>("#instruction");
const rewriteBtn = document.querySelector<HTMLButtonElement>("#action-rewrite");
const summaryBtn = document.querySelector<HTMLButtonElement>("#action-summary");
const insertBtn = document.querySelector<HTMLButtonElement>("#action-insert");

function setStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.error = isError ? "1" : "0";
}

function getInstance(): any {
  const inst = window.instance;
  if (!inst) {
    throw new Error("WPS WebOffice instance 未注入，当前页面无法直接操作 Word。");
  }
  return inst;
}

function getInstruction(task: TaskType): string {
  const custom = String(instructionEl?.value || "").trim();
  return custom || defaultInstruction(task);
}

async function runTask(task: TaskType): Promise<void> {
  const instance = getInstance();
  await instance.ready();
  const app = instance.Application;
  const selectedText = await getSelectionText(app);

  if ((task === "rewrite" || task === "summary") && !selectedText.trim()) {
    setStatus("请先选中文本后再执行该操作。", true);
    return;
  }

  const payload: CodexRunRequest = {
    task,
    content: selectedText,
    instruction: getInstruction(task),
    threadId: threadId || undefined,
  };

  setStatus("处理中...");
  const result = await runByBridge(payload);
  if (result.threadId) {
    threadId = result.threadId;
  }

  if (task === "insert") {
    await insertAfterSelection(app, result.output);
    setStatus("已插入到光标后。");
    return;
  }

  await replaceSelection(app, result.output);
  setStatus("已写回选区。");
}

async function onClick(task: TaskType): Promise<void> {
  try {
    rewriteBtn && (rewriteBtn.disabled = true);
    summaryBtn && (summaryBtn.disabled = true);
    insertBtn && (insertBtn.disabled = true);
    await runTask(task);
  } catch (error) {
    setStatus((error as Error).message, true);
  } finally {
    rewriteBtn && (rewriteBtn.disabled = false);
    summaryBtn && (summaryBtn.disabled = false);
    insertBtn && (insertBtn.disabled = false);
  }
}

rewriteBtn?.addEventListener("click", () => void onClick("rewrite"));
summaryBtn?.addEventListener("click", () => void onClick("summary"));
insertBtn?.addEventListener("click", () => void onClick("insert"));

setStatus("就绪：请选择操作。");
