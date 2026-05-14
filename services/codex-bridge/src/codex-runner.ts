import { spawn } from "node:child_process";
import type { CodexStreamEvent } from "../../../shared/types";
import type { CodexChatMode, CodexReasoningEffort } from "../../../shared/types";

export interface RunOptions {
  cliPath: string;
  prompt: string;
  workingDir: string;
  model?: string;
  threadId?: string;
  mode?: CodexChatMode;
  reasoningEffort?: CodexReasoningEffort;
}

export interface RunCodexStreamCallbacks {
  onEvent?: (event: CodexStreamEvent) => void;
  onDelta?: (chunk: string, event: CodexStreamEvent) => void;
  onStdErrLine?: (line: string) => void;
}

export interface RunCodexHandle {
  abort: () => void;
  completed: Promise<{
    output: string;
    threadId?: string;
    events: CodexStreamEvent[];
  }>;
}

function getAssistantTextFromEvent(event: CodexStreamEvent): string {
  const type = String(event.type || "");
  const item = (event as { item?: { type?: string; text?: string } }).item;
  if (item && (type === "item.delta" || type === "item.completed")) {
    const itemType = String(item.type || "").toLowerCase();
    if (itemType === "assistant_message" || itemType === "agent_message") {
      return typeof item.text === "string" ? item.text : "";
    }
  }
  if (typeof (event as { delta?: unknown }).delta === "string") {
    return String((event as { delta?: string }).delta || "");
  }
  if (typeof event.text === "string") return event.text;
  return "";
}

function buildCodexArgs(options: RunOptions): string[] {
  const args = ["exec", "--json", "-C", options.workingDir];
  if (options.model) args.push("--model", options.model);
  if (options.reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${options.reasoningEffort}"`);
  }
  if (options.mode === "ask") {
    args.push("--sandbox", "read-only");
  } else if (options.mode === "agent") {
    args.push("--sandbox", "workspace-write");
  }
  if (options.threadId) {
    args.push("resume", options.threadId, "-");
  } else {
    args.push("-");
  }
  return args;
}

function shouldUseShell(cliPath: string): boolean {
  return /\.(cmd|bat)$/i.test(cliPath);
}

export function runCodexStream(options: RunOptions, callbacks: RunCodexStreamCallbacks = {}): RunCodexHandle {
  const args = buildCodexArgs(options);
  const child = spawn(options.cliPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: shouldUseShell(options.cliPath),
  });

  let output = "";
  let stdoutBuf = "";
  let stderrBuf = "";
  let stderrLineBuf = "";
  let capturedThreadId = options.threadId;
  const events: CodexStreamEvent[] = [];
  let hasDeltaOutput = false;
  let aborted = false;

  const consumeStdoutLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed) as CodexStreamEvent;
      events.push(event);
      callbacks.onEvent?.(event);

      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        capturedThreadId = event.thread_id;
      }

      const text = getAssistantTextFromEvent(event);
      if (!text) return;
      if (event.type === "item.delta") {
        hasDeltaOutput = true;
        output += text;
        callbacks.onDelta?.(text, event);
        return;
      }
      if (!hasDeltaOutput) {
        output += text;
      }
      callbacks.onDelta?.(text, event);
    } catch {
      const rawEvent: CodexStreamEvent = { type: "stdout.raw", text: trimmed };
      events.push(rawEvent);
      callbacks.onEvent?.(rawEvent);
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    for (;;) {
      const idx = stdoutBuf.indexOf("\n");
      if (idx < 0) break;
      const line = stdoutBuf.slice(0, idx).replace(/\r$/, "");
      stdoutBuf = stdoutBuf.slice(idx + 1);
      consumeStdoutLine(line);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderrBuf += text;
    stderrLineBuf += text;
    for (;;) {
      const idx = stderrLineBuf.indexOf("\n");
      if (idx < 0) break;
      const line = stderrLineBuf.slice(0, idx).replace(/\r$/, "");
      stderrLineBuf = stderrLineBuf.slice(idx + 1);
      if (line.trim()) callbacks.onStdErrLine?.(line);
    }
  });

  try {
    child.stdin.write(options.prompt);
    child.stdin.write("\n");
    child.stdin.end();
  } catch (error) {
    callbacks.onStdErrLine?.(`Failed to write codex stdin: ${(error as Error).message}`);
  }

  const abort = (): void => {
    if (aborted) return;
    aborted = true;
    try {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
          windowsHide: true,
          shell: true,
        });
      }
    } catch {
      // Ignore best-effort process tree cleanup errors.
    }
    try {
      child.kill();
    } catch {
      // Ignore kill errors.
    }
  };

  const completed = new Promise<{
    output: string;
    threadId?: string;
    events: CodexStreamEvent[];
  }>((resolve, reject) => {
    const flushBuffers = (): void => {
      if (stdoutBuf.trim()) {
        consumeStdoutLine(stdoutBuf.replace(/\r$/, ""));
      }
      stdoutBuf = "";
      if (stderrLineBuf.trim()) {
        callbacks.onStdErrLine?.(stderrLineBuf.replace(/\r$/, ""));
      }
      stderrLineBuf = "";
    };

    child.on("error", (error) => {
      flushBuffers();
      reject(error);
    });

    child.on("close", (code) => {
      flushBuffers();
      if (code === 0) {
        resolve({ output: output.trim(), threadId: capturedThreadId, events });
        return;
      }
      if (aborted) {
        reject(new Error("Codex 执行已停止。"));
        return;
      }
      reject(new Error(stderrBuf || `codex exited with code ${code}`));
    });
  });

  return { abort, completed };
}

export async function runCodex(options: RunOptions): Promise<{
  output: string;
  threadId?: string;
  events: CodexStreamEvent[];
}> {
  const handle = runCodexStream(options);
  return handle.completed;
}
