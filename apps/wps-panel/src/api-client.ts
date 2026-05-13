import type { CodexRunRequest, CodexRunResponse } from "../../../shared/types";

const BRIDGE_URL = "http://127.0.0.1:32123/run";

export async function runByBridge(payload: CodexRunRequest): Promise<CodexRunResponse> {
  const resp = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await resp.json()) as CodexRunResponse;
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || `bridge request failed: ${resp.status}`);
  }
  return data;
}

