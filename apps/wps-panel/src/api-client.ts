import type {
  CodexBridgeConfig,
  CodexModelsResponse,
  CodexRunRequest,
  CodexRunResponse,
  CodexStreamEvent,
  FileUploadRequest,
  FileUploadResponse,
  ImageUploadRequest,
  ImageUploadResponse,
  IllustrationRequest,
  IllustrationResponse,
} from "../../../shared/types";

const BRIDGE_BASE_URL = "http://127.0.0.1:32123";

interface RunStreamPayload {
  type: "run.started" | "run.event" | "run.delta" | "run.stderr" | "run.completed" | "run.aborted" | "run.error";
  runId?: string;
  event?: CodexStreamEvent;
  chunk?: string;
  line?: string;
  output?: string;
  threadId?: string;
  message?: string;
  error?: string;
}

export interface RunByBridgeStreamHandlers {
  signal?: AbortSignal;
  onRunStarted?: (runId: string) => void;
  onEvent?: (event: CodexStreamEvent) => void;
  onDelta?: (chunk: string) => void;
  onStdErr?: (line: string) => void;
}

export interface RunByBridgeStreamResult extends CodexRunResponse {
  runId?: string;
  aborted?: boolean;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BRIDGE_BASE_URL}${path}`, init);
  const data = (await resp.json()) as T & { ok?: boolean; error?: string };
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `bridge request failed: ${resp.status}`);
  }
  return data as T;
}

export async function runByBridge(payload: CodexRunRequest): Promise<CodexRunResponse> {
  return requestJson<CodexRunResponse>("/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function parseSsePayload(raw: string): RunStreamPayload | null {
  const lines = raw.split(/\r?\n/);
  const dataLines = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  if (!dataLines.length) return null;
  const joined = dataLines.join("\n");
  try {
    return JSON.parse(joined) as RunStreamPayload;
  } catch {
    return null;
  }
}

export async function runByBridgeStream(
  payload: CodexRunRequest,
  handlers: RunByBridgeStreamHandlers = {}
): Promise<RunByBridgeStreamResult> {
  const resp = await fetch(`${BRIDGE_BASE_URL}/run/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: handlers.signal,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`bridge stream failed: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let streamBuf = "";
  let output = "";
  let threadId = payload.threadId;
  let runId = "";
  const events: CodexStreamEvent[] = [];
  let aborted = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    streamBuf += decoder.decode(value, { stream: true });

    for (;;) {
      const idx = streamBuf.indexOf("\n\n");
      if (idx < 0) break;
      const packet = streamBuf.slice(0, idx);
      streamBuf = streamBuf.slice(idx + 2);
      const payloadEvent = parseSsePayload(packet);
      if (!payloadEvent) continue;

      if (payloadEvent.type === "run.started" && payloadEvent.runId) {
        runId = payloadEvent.runId;
        handlers.onRunStarted?.(runId);
      }
      if (payloadEvent.type === "run.event" && payloadEvent.event) {
        events.push(payloadEvent.event);
        handlers.onEvent?.(payloadEvent.event);
      }
      if (payloadEvent.type === "run.delta" && typeof payloadEvent.chunk === "string") {
        output += payloadEvent.chunk;
        handlers.onDelta?.(payloadEvent.chunk);
      }
      if (payloadEvent.type === "run.stderr" && payloadEvent.line) {
        handlers.onStdErr?.(payloadEvent.line);
      }
      if (payloadEvent.type === "run.completed") {
        if (typeof payloadEvent.output === "string") output = payloadEvent.output;
        if (typeof payloadEvent.threadId === "string") threadId = payloadEvent.threadId;
      }
      if (payloadEvent.type === "run.aborted") {
        aborted = true;
      }
      if (payloadEvent.type === "run.error") {
        throw new Error(payloadEvent.error || "Codex stream failed");
      }
    }
  }

  return {
    ok: true,
    output: output.trim(),
    threadId,
    events,
    runId: runId || undefined,
    aborted,
  };
}

export async function cancelBridgeRun(runId: string): Promise<void> {
  const value = String(runId || "").trim();
  if (!value) return;
  await requestJson<{ ok: boolean }>("/run/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: value }),
  });
}

export async function getBridgeConfig(): Promise<CodexBridgeConfig> {
  return requestJson<CodexBridgeConfig>("/config");
}

export async function saveBridgeConfig(payload: Partial<CodexBridgeConfig>): Promise<CodexBridgeConfig> {
  return requestJson<CodexBridgeConfig>("/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getCodexModels(): Promise<CodexModelsResponse> {
  return requestJson<CodexModelsResponse>("/models");
}

export async function createIllustration(payload: IllustrationRequest): Promise<IllustrationResponse> {
  return requestJson<IllustrationResponse>("/asset/illustration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function uploadImageAsset(payload: ImageUploadRequest): Promise<ImageUploadResponse> {
  return requestJson<ImageUploadResponse>("/asset/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function uploadFileAsset(payload: FileUploadRequest): Promise<FileUploadResponse> {
  return requestJson<FileUploadResponse>("/asset/upload-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}


export interface DiffPopupOpenRequest {
  viewMode: "side" | "merged";
  sideHtml: string;
  mergedHtml: string;
  copyText: string;
  original: string;
  updated: string;
}

export interface DiffPopupOpenResponse {
  ok: boolean;
  url?: string;
  error?: string;
}

export async function openDiffPopupExternal(payload: DiffPopupOpenRequest): Promise<DiffPopupOpenResponse> {
  return requestJson<DiffPopupOpenResponse>("/diff-popup/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}