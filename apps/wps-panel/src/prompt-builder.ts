import type { TaskType } from "../../../shared/types";

export function defaultInstruction(task: TaskType): string {
  if (task === "rewrite") return "保持原意，提升表达清晰度。";
  if (task === "summary") return "提炼核心信息。";
  return "生成可直接粘贴到文档的正式文本。";
}

