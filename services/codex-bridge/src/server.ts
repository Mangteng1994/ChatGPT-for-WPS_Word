import { createServer } from "node:http";
import { runCodex } from "./codex-runner";
import type { BridgeRunRequest, BridgeRunResponse } from "./protocol";

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

const server = createServer(async (req, res) => {
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
        prompt,
        workingDir: payload.workingDir,
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

server.listen(32123, "127.0.0.1", () => {
  console.log("codex-bridge listening on http://127.0.0.1:32123");
});

