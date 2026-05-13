import { spawn } from "node:child_process";
import type { CodexStreamEvent } from "../../../shared/types";

export interface RunOptions {
  prompt: string;
  workingDir: string;
  model?: string;
  threadId?: string;
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

  const child = spawn("codex", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  let output = "";
  let stdoutBuf = "";
  let stderrBuf = "";
  let capturedThreadId = options.threadId;
  const events: CodexStreamEvent[] = [];

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
        const text = typeof event.text === "string" ? event.text : "";
        if (text) output += text;
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

