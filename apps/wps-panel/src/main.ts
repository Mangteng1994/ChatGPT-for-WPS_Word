import { runByBridge } from "./api-client";
import { defaultInstruction } from "./prompt-builder";
import { getWordSelectionText, replaceWordSelection } from "./wps-adapter";
import type { CodexRunRequest } from "../../../shared/types";

declare const instance: any;

async function rewriteSelection() {
  await instance.ready();
  const app = instance.Application;
  const selectedText = await getWordSelectionText(app);
  if (!selectedText.trim()) {
    console.warn("no selected text");
    return;
  }

  const payload: CodexRunRequest = {
    task: "rewrite",
    content: selectedText,
    instruction: defaultInstruction("rewrite"),
    workingDir: process.cwd?.() || ".",
  };
  const result = await runByBridge(payload);
  await replaceWordSelection(app, result.output);
}

void rewriteSelection();

