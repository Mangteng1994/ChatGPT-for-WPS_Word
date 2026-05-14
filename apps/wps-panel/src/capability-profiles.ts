export type CapabilityProfileId = "word-rewrite" | "word-review" | "chat-markdown";
export type WritebackPolicy = "allow" | "manual";

export interface CapabilityProfile {
  id: CapabilityProfileId;
  label: string;
  instruction: string;
  placeholder: string;
  writebackPolicy: WritebackPolicy;
}

const PROFILES: CapabilityProfile[] = [
  {
    id: "word-rewrite",
    label: "Word 正文",
    instruction:
      "输出必须适合直接写入 Word 正文。默认返回纯文本，不要使用 Markdown 标题、列表标记、代码块或额外解释。除非用户明确要求，否则不要添加前言、总结或说明。如果用户明确要求制作表格，请只输出 Markdown 表格本体，不要添加表格前后说明，前端会将其转换为 Word 真表格。",
    placeholder: "面向 Word 正文：默认输出可直接写回的纯文本。",
    writebackPolicy: "allow",
  },
  {
    id: "word-review",
    label: "审阅建议",
    instruction:
      "输出面向 Word 审阅场景。优先给出问题清单、修改建议和修正版正文。不要使用 Markdown 标题或代码块；如需分点，请使用纯文本编号。",
    placeholder: "面向审阅建议：输出问题清单和修订建议，不直接自动写回。",
    writebackPolicy: "manual",
  },
  {
    id: "chat-markdown",
    label: "Markdown 对话",
    instruction:
      "按普通对话方式回答，可以使用 Markdown 组织内容。除非用户明确要求，否则不要假设结果会直接写回 Word。",
    placeholder: "面向聊天和草稿：允许 Markdown 表达，不建议直接写回 Word。",
    writebackPolicy: "manual",
  },
];

export function getCapabilityProfile(id: CapabilityProfileId): CapabilityProfile {
  return PROFILES.find((item) => item.id === id) || PROFILES[0];
}
