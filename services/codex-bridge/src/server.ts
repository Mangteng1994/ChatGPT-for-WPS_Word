import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { runCodex, runCodexStream } from "./codex-runner";
import type { BridgeRunRequest, BridgeRunResponse } from "./protocol";
import type {
  CodexBridgeConfig,
  CodexModelsResponse,
  CodexStreamEvent,
  FileUploadRequest,
  FileUploadResponse,
  IllustrationRequest,
  IllustrationResponse,
  ImageUploadRequest,
  ImageUploadResponse,
} from "../../../shared/types";

interface RuntimeConfig {
  host: string;
  port: number;
  cliPath: string;
  workingDir: string;
}

type LocalConfig = Partial<RuntimeConfig>;

const CONFIG_PATH = path.resolve(process.cwd(), "services", "codex-bridge", "config.local.json");
const DEFAULT_MODELS = ["gpt-5.3-codex", "gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5"];
const ASSET_DIR = path.join(os.tmpdir(), "wps-codex-assets");
const IMAGE_ASSET_DIR = path.join(ASSET_DIR, "uploads");
const FILE_ASSET_DIR = path.join(ASSET_DIR, "files");
const activeRuns = new Map<string, { abort: () => void }>();

interface RunCancelRequest {
  runId?: string;
}

type RunStreamEventPayload =
  | { type: "run.started"; runId: string }
  | { type: "run.event"; event: CodexStreamEvent }
  | { type: "run.delta"; chunk: string }
  | { type: "run.stderr"; line: string }
  | { type: "run.completed"; output: string; threadId?: string }
  | { type: "run.aborted"; runId: string; message: string }
  | { type: "run.error"; runId: string; error: string };

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readJsonBody<T>(body: string): T {
  return body ? (JSON.parse(body) as T) : ({} as T);
}

function loadLocalConfigFile(): LocalConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as LocalConfig;
}

function saveLocalConfigFile(config: LocalConfig): void {
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function runWhere(command: string): string[] {
  if (process.platform !== "win32") return [];
  try {
    return execFileSync("where.exe", [command], { encoding: "utf8" })
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function detectCliPaths(): string[] {
  const candidates = [
    process.env.CODEX_CLI_PATH || "",
    ...runWhere("codex"),
    path.join(os.homedir(), "AppData", "Roaming", "npm", "codex.cmd"),
    path.join(os.homedir(), "AppData", "Local", "OpenAI", "Codex", "bin", "codex.exe"),
  ];
  const unique = Array.from(new Set(candidates.filter((item) => item && existsSync(item))));
  if (process.platform !== "win32") return unique;

  const rank = (item: string): number => {
    const ext = path.extname(item).toLowerCase();
    if (ext === ".cmd") return 0;
    if (ext === ".exe") return 1;
    if (ext === ".bat") return 2;
    return 9;
  };

  return unique.sort((a, b) => rank(a) - rank(b));
}

function resolveCliPath(input: string): string {
  const value = String(input || "").trim();
  if (!value) return "";
  if (process.platform !== "win32") return existsSync(value) ? value : value;

  const ext = path.extname(value).toLowerCase();
  if (!ext) {
    const candidates = [`${value}.cmd`, `${value}.exe`, `${value}.bat`];
    const matched = candidates.find((item) => existsSync(item));
    if (matched) return matched;

    const detected = detectCliPaths();
    const exactBase = detected.find((item) => path.basename(item, path.extname(item)).toLowerCase() === path.basename(value).toLowerCase());
    if (exactBase) return exactBase;
  }

  return existsSync(value) ? value : value;
}

function loadRuntimeConfig(): RuntimeConfig {
  const fileConfig = loadLocalConfigFile();
  const detected = detectCliPaths();
  const cliPath = resolveCliPath(process.env.CODEX_CLI_PATH || fileConfig.cliPath || detected[0] || "codex");
  const workingDir = process.env.CODEX_WORKING_DIR || fileConfig.workingDir || process.cwd();
  return {
    host: process.env.CODEX_BRIDGE_HOST || fileConfig.host || "127.0.0.1",
    port: toNumber(process.env.CODEX_BRIDGE_PORT || fileConfig.port, 32123),
    cliPath,
    workingDir: path.resolve(workingDir),
  };
}

function readCodexConfigToml(): string {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = path.join(codexHome, "config.toml");
  return existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
}

function listModels(): { models: string[]; defaultModel?: string } {
  const toml = readCodexConfigToml();
  const matches = Array.from(toml.matchAll(/(?:^|\n)\s*model\s*=\s*["']([^"']+)["']/g));
  const models = Array.from(new Set([...matches.map((match) => match[1]), ...DEFAULT_MODELS]));
  return { models, defaultModel: matches[0]?.[1] };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapSvgText(text: string, maxChars = 22): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  for (let i = 0; i < clean.length; i += maxChars) {
    lines.push(clean.slice(i, i + maxChars));
  }
  return lines.slice(0, 4);
}

function createIllustrationFile(req: IllustrationRequest): string {
  mkdirSync(ASSET_DIR, { recursive: true });
  const title = (req.title || "Codex 插图").trim();
  const lines = wrapSvgText(req.prompt || title);
  const filePath = path.join(ASSET_DIR, `codex-illustration-${Date.now()}.svg`);
  const textSpans = lines
    .map((line, index) => `<text x="64" y="${250 + index * 38}" class="body">${escapeXml(line)}</text>`)
    .join("\n");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#eef7f4"/>
      <stop offset="1" stop-color="#d9e8ff"/>
    </linearGradient>
    <style>
      .title{font:700 46px "Microsoft YaHei",Arial,sans-serif;fill:#152236}
      .body{font:400 28px "Microsoft YaHei",Arial,sans-serif;fill:#223246}
      .label{font:600 20px "Microsoft YaHei",Arial,sans-serif;fill:#0e8a6a}
    </style>
  </defs>
  <rect width="960" height="540" rx="28" fill="url(#bg)"/>
  <circle cx="792" cy="124" r="88" fill="#0e8a6a" opacity=".14"/>
  <circle cx="842" cy="180" r="34" fill="#0e8a6a" opacity=".32"/>
  <path d="M72 382 C210 316, 302 430, 432 350 S690 318, 862 396" fill="none" stroke="#0e8a6a" stroke-width="14" stroke-linecap="round" opacity=".55"/>
  <rect x="48" y="48" width="864" height="444" rx="22" fill="white" opacity=".66"/>
  <text x="64" y="132" class="label">Codex for WPS Word</text>
  <text x="64" y="192" class="title">${escapeXml(title).slice(0, 32)}</text>
  ${textSpans}
</svg>
`;
  writeFileSync(filePath, svg, "utf8");
  return filePath;
}

function sanitizeFileName(value: string): string {
  const name = value.replace(/[\\/:*?"<>|]/g, "_").trim();
  return name || "image.png";
}

function inferImageExt(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return ".png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return ".jpg";
  if (lower.endsWith(".webp")) return ".webp";
  if (lower.endsWith(".gif")) return ".gif";
  return ".png";
}

function saveUploadedImage(req: ImageUploadRequest): { path: string; name: string } {
  const cleanName = sanitizeFileName(req.name || "image.png");
  const ext = inferImageExt(cleanName);
  const finalName = cleanName.toLowerCase().endsWith(ext) ? cleanName : `${cleanName}${ext}`;
  mkdirSync(IMAGE_ASSET_DIR, { recursive: true });
  const filePath = path.join(IMAGE_ASSET_DIR, `${Date.now()}-${finalName}`);
  const buffer = Buffer.from(req.dataBase64 || "", "base64");
  if (!buffer.length) throw new Error("图片数据为空。");
  writeFileSync(filePath, buffer);
  return { path: filePath, name: finalName };
}

function saveUploadedFile(req: FileUploadRequest): FileUploadResponse {
  const cleanName = sanitizeFileName(req.name || "file");
  mkdirSync(FILE_ASSET_DIR, { recursive: true });
  const filePath = path.join(FILE_ASSET_DIR, `${Date.now()}-${cleanName}`);
  const buffer = Buffer.from(req.dataBase64 || "", "base64");
  if (!buffer.length) throw new Error("文件数据为空。");
  writeFileSync(filePath, buffer);
  return {
    ok: true,
    path: filePath,
    name: cleanName,
    mimeType: req.mimeType || "application/octet-stream",
    size: buffer.length,
  };
}

function buildPrompt(req: BridgeRunRequest): string {
  const imageHints =
    req.imageAttachments?.length
      ? [
          "",
          "用户上传了图片附件，请结合图片与文字一起回答：",
          ...req.imageAttachments.map((item, index) => `[图片${index + 1}] ${item.name}\n本地路径：${item.path}`),
        ].join("\n")
      : "";
  const fileHints =
    req.fileAttachments?.length
      ? [
          "",
          "用户上传了文件附件。需要读取时，请使用下列本地路径：",
          ...req.fileAttachments.map((item, index) => `[文件${index + 1}] ${item.name}\n本地路径：${item.path}`),
        ].join("\n")
      : "";
  const instruction = (req.instruction || "").trim();
  if (req.task === "rewrite") {
    return [
      "你是文档改写助手，只输出改写后的正文，不要解释。",
      instruction ? `附加要求：${instruction}` : "",
      "",
      "原文：",
      req.content,
    ].filter(Boolean).join("\n");
  }
  if (req.task === "summary") {
    return [
      "请生成中文摘要，3-5条要点，只输出摘要内容。",
      instruction ? `附加要求：${instruction}` : "",
      "",
      "内容：",
      req.content,
    ].filter(Boolean).join("\n");
  }
  if (req.task === "chat") {
    return [
      req.mode === "agent"
        ? "你是 Codex agent。你不能直接操作 WPS 文档；如果用户要求修改、写回或替换当前选区，只输出应写入 Word 的最终正文，不要解释。若用户要求插入图片，图片由面板处理，你只需输出正文或图片说明。"
        : "你是 Codex ask 模式助手。只回答问题，不修改文件。",
      instruction ? `文档选区上下文：\n${instruction}` : "",
      imageHints,
      fileHints,
      "",
      "用户：",
      req.content,
    ].filter(Boolean).join("\n");
  }
  return [
    "你是写作助手，请根据要求生成可直接插入文档的内容，不要解释。",
    instruction ? `写作要求：${instruction}` : "",
    "",
    "上下文：",
    req.content,
  ].filter(Boolean).join("\n");
}

function setCorsHeaders(res: import("node:http").ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: import("node:http").ServerResponse, statusCode: number, data: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function createRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function setSseHeaders(res: import("node:http").ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

function sendSse(res: import("node:http").ServerResponse, payload: RunStreamEventPayload): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleRun(body: string, res: import("node:http").ServerResponse): Promise<void> {
  try {
    const runtime = loadRuntimeConfig();
    const payload = readJsonBody<BridgeRunRequest>(body);
    const result = await runCodex({
      cliPath: runtime.cliPath,
      prompt: buildPrompt(payload),
      workingDir: runtime.workingDir,
      model: payload.model,
      mode: payload.mode,
      reasoningEffort: payload.reasoningEffort,
      threadId: payload.threadId,
    });
    const response: BridgeRunResponse = {
      ok: true,
      output: result.output,
      threadId: result.threadId,
      events: result.events,
    };
    sendJson(res, 200, response);
  } catch (error) {
    sendJson(res, 500, { ok: false, output: "", error: (error as Error).message } satisfies BridgeRunResponse);
  }
}

function handleRunCancel(body: string, res: import("node:http").ServerResponse): void {
  const payload = readJsonBody<RunCancelRequest>(body);
  const runId = String(payload.runId || "").trim();
  if (!runId) {
    sendJson(res, 400, { ok: false, error: "runId is required" });
    return;
  }
  const run = activeRuns.get(runId);
  if (!run) {
    sendJson(res, 404, { ok: false, error: "run not found" });
    return;
  }
  run.abort();
  sendJson(res, 200, { ok: true, runId });
}

function handleRunStream(
  req: import("node:http").IncomingMessage,
  body: string,
  res: import("node:http").ServerResponse
): void {
  const runtime = loadRuntimeConfig();
  const payload = readJsonBody<BridgeRunRequest>(body);
  const runId = createRunId();
  let finished = false;

  setSseHeaders(res);
  sendSse(res, { type: "run.started", runId });

  const runner = runCodexStream(
    {
      cliPath: runtime.cliPath,
      prompt: buildPrompt(payload),
      workingDir: runtime.workingDir,
      model: payload.model,
      mode: payload.mode,
      reasoningEffort: payload.reasoningEffort,
      threadId: payload.threadId,
    },
    {
      onEvent: (event) => sendSse(res, { type: "run.event", event }),
      onDelta: (chunk) => sendSse(res, { type: "run.delta", chunk }),
      onStdErrLine: (line) => sendSse(res, { type: "run.stderr", line }),
    }
  );

  const closeStream = (): void => {
    if (finished) return;
    finished = true;
    activeRuns.delete(runId);
    res.end();
  };

  res.on("close", () => {
    if (!finished && activeRuns.has(runId)) {
      runner.abort();
    }
  });

  activeRuns.set(runId, { abort: runner.abort });

  void runner.completed
    .then((result) => {
      sendSse(res, { type: "run.completed", output: result.output, threadId: result.threadId });
      closeStream();
    })
    .catch((error) => {
      const message = (error as Error).message || "Codex stream failed";
      if (/已停止/.test(message)) {
        sendSse(res, { type: "run.aborted", runId, message });
      } else {
        sendSse(res, { type: "run.error", runId, error: message });
      }
      closeStream();
    });
}


// ---- Diff Popup ----

interface DiffPopupData {
  defaultView: "side" | "merged" | "comprehensive";
  sideHtml: string;
  mergedHtml: string;
  comprehensiveHtml: string;
  copyText: string;
  original: string;
  updated: string;
}

const diffPopupStore = new Map<string, { data: DiffPopupData; expiresAt: number; version: number }>();
const DIFF_POPUP_TTL_MS = 10 * 60 * 1000; // 10 minutes
let activeDiffPopupToken: string | null = null;

function generateDiffToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

function openSystemBrowser(url: string): void {
  if (process.platform === "win32") {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Start-Process", url],
      { windowsHide: true },
      (err) => { if (err) console.error("[diff-popup] Failed to open browser:", err.message); },
    );
  } else if (process.platform === "darwin") {
    execFile("open", [url]);
  } else {
    execFile("xdg-open", [url]);
  }
}

function buildDiffPopupHtml(data: DiffPopupData, token: string, version: number): string {
  const { defaultView, sideHtml, mergedHtml, comprehensiveHtml, copyText } = data;
  const title = "段落差异对比";
  const copyTextJson = JSON.stringify(copyText);

  const sideHidden = defaultView === "side" ? "" : " hidden";
  const mergedHidden = defaultView === "merged" ? "" : " hidden";
  const comprehensiveHidden = defaultView === "comprehensive" ? "" : " hidden";
  const sideActive = defaultView === "side" ? " is-active" : "";
  const mergedActive = defaultView === "merged" ? " is-active" : "";
  const comprehensiveActive = defaultView === "comprehensive" ? " is-active" : "";

  return "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
    "<title>" + title + "</title>\n<style>\n" +
    "*{box-sizing:border-box;margin:0;padding:0}\n" +
    "body{font-family:\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",sans-serif;font-size:14px;color:#1a1a1a;background:#fff;display:flex;flex-direction:column;height:100vh;overflow:hidden}\n" +
    ".cw-diff-toolbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #ddd;background:#fafafa}\n" +
    ".cw-diff-toolbar__label{font-size:12px;color:#888}\n" +
    ".cw-diff-toolbar__btn{height:28px;padding:0 12px;border:1px solid #ccc;border-radius:5px;background:#fff;color:#333;font-size:12px;cursor:pointer}\n" +
    ".cw-diff-toolbar__btn.is-active{background:#1d7f63;color:#fff;border-color:#1d7f63}\n" +
    ".cw-diff-toolbar__spacer{flex:1}\n" +
    ".cw-diff-main{flex:1 1 auto;min-height:0}\n" +
    ".cw-diff-view{flex:1 1 auto;min-height:0;height:100%}\n" +
    ".cw-diff-view[hidden]{display:none!important}\n" +
    ".cw-diff-view--side{overflow:hidden}\n" +
    ".cw-diff-view--merged{overflow:auto}\n" +
    ".cw-diff-view--comprehensive{overflow:auto;padding:12px}\n" +
    ".cw-diff-columns{flex:1 1 auto;min-height:0;display:flex;flex-direction:row;overflow:hidden;height:100%}\n" +
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
    ".cw-diff-section{border:1px solid #ddd;border-radius:8px;overflow:hidden;background:#fff}\n" +
    ".cw-diff-section+.cw-diff-section{margin-top:12px}\n" +
    ".cw-diff-section h3{margin:0;padding:8px 14px;font-size:12px;color:#666;background:#f8f8f8;border-bottom:1px solid #ddd}\n" +
    ".cw-diff-section--side .cw-diff-columns{height:260px}\n" +
    "@media(max-width:800px){.cw-diff-columns{flex-direction:column}.cw-diff-column--left{border-right:none;border-bottom:1px solid #ddd}}\n" +
    "</style>\n</head>\n<body>\n" +
    "<div class=\"cw-diff-toolbar\">" +
    "<span class=\"cw-diff-toolbar__label\">视图：</span>" +
    "<button class=\"cw-diff-toolbar__btn" + sideActive + "\" data-view=\"side\" id=\"btn-side\" type=\"button\">左右视图</button>" +
    "<button class=\"cw-diff-toolbar__btn" + mergedActive + "\" data-view=\"merged\" id=\"btn-merged\" type=\"button\">合并视图</button>" +
    "<button class=\"cw-diff-toolbar__btn" + comprehensiveActive + "\" data-view=\"comprehensive\" id=\"btn-comprehensive\" type=\"button\">综合视图</button>" +
    "<span class=\"cw-diff-toolbar__spacer\"></span>" +
    "<button class=\"cw-diff-toolbar__btn\" id=\"btn-copy\" type=\"button\">复制对比结果</button>" +
    "<button class=\"cw-diff-toolbar__btn\" id=\"btn-close\" type=\"button\">关闭</button></div>\n" +
    "<main class=\"cw-diff-main\">\n" +
    "<div id=\"side-view\" class=\"cw-diff-view cw-diff-view--side\"" + sideHidden + ">" + sideHtml + "</div>\n" +
    "<div id=\"merged-view\" class=\"cw-diff-view cw-diff-view--merged\"" + mergedHidden + ">" + mergedHtml + "</div>\n" +
    "<div id=\"comprehensive-view\" class=\"cw-diff-view cw-diff-view--comprehensive\"" + comprehensiveHidden + ">" + comprehensiveHtml + "</div>\n" +
    "</main>\n" +
    "<script>\n" +
    "(function(){\n" +
    "var TOKEN=\"" + token + "\";\n" +
    "var CURRENT_VERSION=" + version + ";\n" +
    "var POLL_INTERVAL=2000;\n" +
    "var defaultView=\"" + defaultView + "\";\n" +
    "function setHidden(id,h){var e=document.getElementById(id);if(e)e.hidden=h;}\n" +
    "function setActive(id,a){var e=document.getElementById(id);if(e)e.classList.toggle(\"is-active\",a);}\n" +
    "function switchView(v){if(v!==\"side\"&&v!==\"merged\"&&v!==\"comprehensive\")v=\"comprehensive\";setHidden(\"side-view\",v!==\"side\");setHidden(\"merged-view\",v!==\"merged\");setHidden(\"comprehensive-view\",v!==\"comprehensive\");setActive(\"btn-side\",v===\"side\");setActive(\"btn-merged\",v===\"merged\");setActive(\"btn-comprehensive\",v===\"comprehensive\");}\n" +
    "function copyResult(){var t=" + copyTextJson + ";if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){var b=document.getElementById(\"btn-copy\");if(!b)return;var o=b.textContent;b.textContent=\"已复制！\";setTimeout(function(){b.textContent=o;},1500)}).catch(function(){})}}\n" +
    "function pollVersion(){\n" +
    "fetch('/diff-popup/version/'+TOKEN).then(function(r){return r.json();}).then(function(d){\n" +
    "if(d.expired){window.location.reload();return;}\n" +
    "if(d.version>CURRENT_VERSION){window.location.reload();}\n" +
    "}).catch(function(){});\n" +
    "}\n" +
    "setInterval(pollVersion,POLL_INTERVAL);\n" +
    "document.addEventListener(\"DOMContentLoaded\",function(){\n" +
    "var btns=document.querySelectorAll(\"[data-view]\");\n" +
    "for(var i=0;i<btns.length;i+=1){btns[i].addEventListener(\"click\",function(){switchView(this.getAttribute(\"data-view\")||\"comprehensive\");});}\n" +
    "var cb=document.getElementById(\"btn-copy\");if(cb)cb.addEventListener(\"click\",copyResult);\n" +
    "var cl=document.getElementById(\"btn-close\");if(cl)cl.addEventListener(\"click\",function(){window.close();});\n" +
    "switchView(defaultView);\n" +
    "});\n" +
    "})();\n" +
    "</script>\n</body>\n</html>";
}

function handleDiffPopupOpen(body: string, res: import("node:http").ServerResponse, runtime: RuntimeConfig): void {
  try {
    const payload = readJsonBody<DiffPopupData>(body);
    if (!payload.defaultView || !payload.sideHtml || !payload.mergedHtml || !payload.comprehensiveHtml) {
      sendJson(res, 400, { ok: false, error: "Missing required fields: defaultView, sideHtml, mergedHtml, comprehensiveHtml" });
      return;
    }

    // Reuse active token if still valid
    let token = activeDiffPopupToken;
    const existing = token ? diffPopupStore.get(token) : undefined;

    if (existing && Date.now() <= existing.expiresAt) {
      // Update data and bump version
      existing.data = payload;
      existing.version += 1;
      existing.expiresAt = Date.now() + DIFF_POPUP_TTL_MS;
    } else {
      // Create new token
      if (token) diffPopupStore.delete(token);
      token = generateDiffToken();
      activeDiffPopupToken = token;
      diffPopupStore.set(token, {
        data: payload,
        expiresAt: Date.now() + DIFF_POPUP_TTL_MS,
        version: 1,
      });

      const url = `http://${runtime.host}:${runtime.port}/diff-popup/${token}`;
      openSystemBrowser(url);
    }

    sendJson(res, 200, { ok: true, url: `http://${runtime.host}:${runtime.port}/diff-popup/${token}` });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: (error as Error).message });
  }
}

function handleDiffPopupView(url: string, res: import("node:http").ServerResponse): void {
  const path = (url || "").split("?")[0];
  const token = path.replace("/diff-popup/", "").replace("/version/", "");

  // Version polling endpoint
  if (path.includes("/version/")) {
    const entry = diffPopupStore.get(token);
    if (!entry || Date.now() > entry.expiresAt) {
      diffPopupStore.delete(token);
      if (activeDiffPopupToken === token) activeDiffPopupToken = null;
      sendJson(res, 200, { version: 0, expired: true });
      return;
    }
    sendJson(res, 200, { version: entry.version, expired: false });
    return;
  }
  const entry = diffPopupStore.get(token);

  if (!entry || Date.now() > entry.expiresAt) {
    diffPopupStore.delete(token);
    if (activeDiffPopupToken === token) activeDiffPopupToken = null;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<!doctype html><html><body><p style=\"text-align:center;padding:48px;color:#888\">对比数据已过期，请从 WPS 面板重新触发对比。</p></body></html>");
    return;
  }

  // Clean up expired entries periodically
  if (Math.random() < 0.1) {
    const now = Date.now();
    for (const [k, v] of diffPopupStore) {
      if (now > v.expiresAt) {
        diffPopupStore.delete(k);
        if (activeDiffPopupToken === k) activeDiffPopupToken = null;
      }
    }
  }

  const html = buildDiffPopupHtml(entry.data, token, entry.version);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(html);
}

function handleConfigGet(res: import("node:http").ServerResponse): void {
  const runtime = loadRuntimeConfig();
  const response: CodexBridgeConfig = { ...runtime, detectedCliPaths: detectCliPaths() };
  sendJson(res, 200, response);
}

function handleHealth(res: import("node:http").ServerResponse): void {
  const runtime = loadRuntimeConfig();
  sendJson(res, 200, {
    ok: true,
    service: "codex-bridge",
    host: runtime.host,
    port: runtime.port,
    workingDir: runtime.workingDir,
  });
}

function handleConfigPost(body: string, res: import("node:http").ServerResponse): void {
  const current = loadLocalConfigFile();
  const next = readJsonBody<LocalConfig>(body);
  const merged: LocalConfig = {
    ...current,
    ...next,
    cliPath: next.cliPath !== undefined ? resolveCliPath(String(next.cliPath || "")) : current.cliPath,
    port: next.port ? toNumber(next.port, 32123) : current.port,
  };
  saveLocalConfigFile(merged);
  handleConfigGet(res);
}

function handleModels(res: import("node:http").ServerResponse): void {
  try {
    sendJson(res, 200, { ok: true, ...listModels() } satisfies CodexModelsResponse);
  } catch (error) {
    sendJson(res, 500, { ok: false, models: DEFAULT_MODELS, error: (error as Error).message } satisfies CodexModelsResponse);
  }
}

function handleIllustration(body: string, res: import("node:http").ServerResponse): void {
  try {
    const payload = readJsonBody<IllustrationRequest>(body);
    const filePath = createIllustrationFile(payload);
    sendJson(res, 200, { ok: true, path: filePath } satisfies IllustrationResponse);
  } catch (error) {
    sendJson(res, 500, { ok: false, path: "", error: (error as Error).message } satisfies IllustrationResponse);
  }
}

function handleUploadImage(body: string, res: import("node:http").ServerResponse): void {
  try {
    const payload = readJsonBody<ImageUploadRequest>(body);
    const saved = saveUploadedImage(payload);
    sendJson(res, 200, { ok: true, path: saved.path, name: saved.name } satisfies ImageUploadResponse);
  } catch (error) {
    sendJson(res, 500, { ok: false, path: "", name: "", error: (error as Error).message } satisfies ImageUploadResponse);
  }
}

function handleUploadFile(body: string, res: import("node:http").ServerResponse): void {
  try {
    const payload = readJsonBody<FileUploadRequest>(body);
    sendJson(res, 200, saveUploadedFile(payload));
  } catch (error) {
    sendJson(res, 500, { ok: false, path: "", name: "", size: 0, error: (error as Error).message } satisfies FileUploadResponse);
  }
}

const initialRuntime = loadRuntimeConfig();

const server = createServer((req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += String(chunk)));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/run") return void handleRun(body, res);
    if (req.method === "POST" && req.url === "/run/stream") return handleRunStream(req, body, res);
    if (req.method === "POST" && req.url === "/run/cancel") return handleRunCancel(body, res);
    if (req.method === "GET" && req.url === "/health") return handleHealth(res);
    if (req.method === "GET" && req.url === "/config") return handleConfigGet(res);
    if (req.method === "POST" && req.url === "/config") return handleConfigPost(body, res);
    if (req.method === "GET" && req.url === "/models") return handleModels(res);
    if (req.method === "POST" && req.url === "/asset/illustration") return handleIllustration(body, res);
    if (req.method === "POST" && req.url === "/asset/upload-image") return handleUploadImage(body, res);
    if (req.method === "POST" && req.url === "/diff-popup/open") return handleDiffPopupOpen(body, res, initialRuntime);
    if (req.method === "GET" && (req.url || "").startsWith("/diff-popup/")) return handleDiffPopupView(req.url || "", res);
    if (req.method === "POST" && req.url === "/asset/upload-file") return handleUploadFile(body, res);
    sendJson(res, 404, { ok: false, error: "Not Found" });
  });
});

server.listen(initialRuntime.port, initialRuntime.host, () => {
  console.log(
    `codex-bridge listening on http://${initialRuntime.host}:${initialRuntime.port} (workingDir=${initialRuntime.workingDir})`
  );
});
