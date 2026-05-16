export type ContextScope = "selection" | "paragraph" | "heading" | "document";
export type PromptPresetId =
  | "custom"
  | "polish"
  | "formal"
  | "compress"
  | "expand"
  | "summary"
  | "translate"
  | "typo"
  | "punctuation-fragments"
  | "contract-review"
  | "meeting-minutes";

export interface PromptPreset {
  id: PromptPresetId;
  label: string;
  defaultUserText: string;
  systemInstruction: string;
}

export interface BuiltPrompt {
  userText: string;
  instruction: string;
}

const PRESETS: PromptPreset[] = [
  { id: "custom", label: "自定义", defaultUserText: "", systemInstruction: "" },
  {
    id: "polish",
    label: "润色",
    defaultUserText: "请润色这段内容。",
    systemInstruction: "请保持原意，对文本做专业润色，提升清晰度、流畅度和可读性，输出可直接写回正文的结果。",
  },
  {
    id: "formal",
    label: "改正式",
    defaultUserText: "请改成更正式的书面表达。",
    systemInstruction: "请将文本改写为正式、稳妥、适合文档正文的书面表达，避免口语化，保持事实和原意不变。",
  },
  {
    id: "compress",
    label: "压缩",
    defaultUserText: "请压缩这段内容。",
    systemInstruction: "请在不丢失关键信息的前提下压缩文本长度，删除重复和赘述，输出精简后的正文。",
  },
  {
    id: "expand",
    label: "扩写",
    defaultUserText: "请扩写这段内容。",
    systemInstruction: "请基于现有内容做适度扩写，补足上下文、逻辑衔接和必要细节，输出自然完整的正文。",
  },
  {
    id: "summary",
    label: "摘要",
    defaultUserText: "请提炼摘要。",
    systemInstruction: "请提炼核心信息，给出准确、简洁、结构清楚的摘要；如果输入较长，优先输出适合放入文档中的摘要正文。",
  },
  {
    id: "translate",
    label: "翻译",
    defaultUserText: "请翻译这段内容。",
    systemInstruction:
      "请根据用户补充要求进行翻译；如果用户未指定目标语言，则中文译为英文、英文译为中文。保持术语准确、语气自然、格式尽量贴近原文。",
  },
  {
    id: "typo",
    label: "错别字检查",
    defaultUserText: "请检查文本中的字词和标点错误，列出问题片段与修改建议，并提供修正后的完整文本。",
    systemInstruction:
      "请检查文本中的错别字、误用字和标点符号问题。输出时先逐条列出有问题的原文片段、问题说明和修改建议，再给出一版修正后的完整正文。不要省略错误位置，也不要只返回最终正文。",
  },
  {
    id: "punctuation-fragments",
    label: "标点检查",
    defaultUserText: "请检查文本中的标点错误，以列表返回问题片段、问题说明和修改建议。",
    systemInstruction:
      "请只检查标点符号使用错误，不检查错别字、语病、事实或风格问题。输出必须使用 Markdown 无序列表，且只能使用以下结构：\n- 问题片段：原文片段\n  - 问题说明：说明标点错误\n  - 修改建议：给出建议改法\n若有多个问题，重复上述一级列表结构。不要输出标题、编号、表格、代码块、前言、总结或修正后的全文。若未发现标点错误，只输出“未发现标点错误”。",
  },
  {
    id: "contract-review",
    label: "合同审查",
    defaultUserText: "请审查这段合同内容。",
    systemInstruction:
      "请从合同审查角度识别风险、歧义、责任不对等等问题。先给出简明问题清单，再给出建议改写文本；不要假装提供法律意见。",
  },
  {
    id: "meeting-minutes",
    label: "会议纪要",
    defaultUserText: "请整理成会议纪要。",
    systemInstruction: "请将内容整理成正式会议纪要，包含议题、关键结论、待办事项和责任信息；缺失信息不要编造。",
  },
];

const CONTEXT_LABELS: Record<ContextScope, string> = {
  selection: "当前选区",
  paragraph: "当前段落",
  heading: "当前标题下内容",
  document: "全文摘要",
};

export function getPromptPreset(id: PromptPresetId): PromptPreset {
  return PRESETS.find((item) => item.id === id) || PRESETS[0];
}

export function buildPrompt(
  presetId: PromptPresetId,
  contextScope: ContextScope,
  userInput: string,
  contextNotice?: string
): BuiltPrompt {
  const preset = getPromptPreset(presetId);
  const userText = userInput.trim() || preset.defaultUserText || "请基于当前上下文处理文本。";
  const instruction = [
    preset.systemInstruction,
    `当前上下文范围：${CONTEXT_LABELS[contextScope] || CONTEXT_LABELS.selection}。`,
    contextNotice ? `上下文说明：${contextNotice}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { userText, instruction };
}
