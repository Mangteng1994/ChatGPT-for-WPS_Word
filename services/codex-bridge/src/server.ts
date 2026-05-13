import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runCodex } from "./codex-runner";
import type { BridgeRunRequest, BridgeRunResponse } from "./protocol";

interface RuntimeConfig {
  host: string;
  port: number;
  cliPath: string;
  workingDir: string;
}

type LocalConfig = Partial<{
  host: string;
  port: number;
  cliPath: string;
  workingDir: string;
}>;

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadLocalConfigFile(): LocalConfig {
  const configPath = path.resolve(process.cwd(), "services", "codex-bridge", "config.local.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as LocalConfig;
  } catch (error) {
    throw new Error(
      `failed to parse config.local.json: ${(error as Error).message}`
    );
  }
}

function loadRuntimeConfig(): RuntimeConfig {
  const fileConfig = loadLocalConfigFile();
  const host = process.env.CODEX_BRIDGE_HOST || fileConfig.host || "127.0.0.1";
  const port = toNumber(process.env.CODEX_BRIDGE_PORT || fileConfig.port, 32123);
  const cliPath = process.env.CODEX_CLI_PATH || fileConfig.cliPath || "codex";
  const workingDir = process.env.CODEX_WORKING_DIR || fileConfig.workingDir || "";

  if (!workingDir.trim()) {
    throw new Error(
      "CODEX_WORKING_DIR is required (or set services/codex-bridge/config.local.json -> workingDir)"
    );
  }

  return { host, port, cliPath, workingDir: path.resolve(workingDir) };
}

function buildPrompt(req: BridgeRunRequest): string {
  const instruction = (req.instruction || "").trim();
  if (req.task === "rewrite") {
    return [
      "你是文档改写助手，只输出改写后的正文，不要解释。",
      instruction ? `附加要求：${instruction}` : "",
      "",
      "原文：",
      req.content,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (req.task === "summary") {
    return [
      "请生成中文摘要，3-5条要点，只输出摘要内容。",
      instruction ? `附加要求：${instruction}` : "",
      "",
      "内容：",
      req.content,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "你是写作助手，请根据要求生成可直接插入文档的内容，不要解释。",
    instruction ? `写作要求：${instruction}` : "",
    "",
    "上下文：",
    req.content,
  ]
    .filter(Boolean)
    .join("\n");
}

function setCorsHeaders(res: import("node:http").ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const runtime = loadRuntimeConfig();

const server = createServer((req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/run") {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += String(chunk)));
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body) as BridgeRunRequest;
      const prompt = buildPrompt(payload);
      const result = await runCodex({
        cliPath: runtime.cliPath,
        prompt,
        workingDir: runtime.workingDir,
        model: payload.model,
        threadId: payload.threadId,
      });

      const response: BridgeRunResponse = {
        ok: true,
        output: result.output,
        threadId: result.threadId,
        events: result.events,
      };
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(response));
    } catch (error) {
      const response: BridgeRunResponse = {
        ok: false,
        output: "",
        error: (error as Error).message,
      };
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(response));
    }
  });
});

server.listen(runtime.port, runtime.host, () => {
  console.log(
    `codex-bridge listening on http://${runtime.host}:${runtime.port} (workingDir=${runtime.workingDir})`
  );
});

