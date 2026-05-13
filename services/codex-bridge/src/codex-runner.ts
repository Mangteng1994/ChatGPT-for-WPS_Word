import { spawn } from "node:child_process";
import type { CodexStreamEvent } from "../../../shared/types";

export interface RunOptions {
  cliPath: string;
  prompt: string;
  workingDir: string;
  model?: string;
  threadId?: string;
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

export async function runCodex(options: RunOptions): Promise<{
  output: string;
  threadId?: string;
  events: CodexStreamEvent[];
}> {
  const args = ["exec", "--json", "-C", options.workingDir];
  if (options.model) args.push("--model", options.model);
  if (options.threadId) {
    args.push("resume", options.threadId, "-");
  } else {
    args.push("-");
  }

  const child = spawn(options.cliPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: /\.(cmd|bat)$/i.test(options.cliPath),
  });

  let output = "";
  let stdoutBuf = "";
  let stderrBuf = "";
  let capturedThreadId = options.threadId;
  const events: CodexStreamEvent[] = [];
  let hasDeltaOutput = false;

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    for (;;) {
      const idx = stdoutBuf.indexOf("\n");
      if (idx < 0) break;
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line) as CodexStreamEvent;
        events.push(event);
        if (event.type === "thread.started" && typeof event.thread_id === "string") {
          capturedThreadId = event.thread_id;
        }
        const text = getAssistantTextFromEvent(event);
        if (!text) continue;
        if (event.type === "item.delta") {
          hasDeltaOutput = true;
          output += text;
          continue;
        }
        if (!hasDeltaOutput) {
          output += text;
        }
      } catch {
        events.push({ type: "stdout.raw", text: line });
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });

  child.stdin.write(options.prompt);
  child.stdin.write("\n");
  child.stdin.end();

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrBuf || `codex exited with code ${code}`));
    });
  });

  return { output: output.trim(), threadId: capturedThreadId, events };
}
