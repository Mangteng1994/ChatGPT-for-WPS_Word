export interface StylePromptTemplateRecord {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  isBuiltin: boolean;
}

const BUILTIN_TIMESTAMP = 0;

export const BUILTIN_STYLE_PROMPT_TEMPLATES: readonly StylePromptTemplateRecord[] = [
  {
    id: "builtin-thesis",
    name: "中文论文（四级标题）",
    prompt: "一级标题：黑体，三号，加粗，居中，段前 24 磅，段后 18 磅。\n二级标题：黑体，四号，加粗，左对齐，段前 18 磅，段后 12 磅。\n三级标题：黑体，小四号，加粗，左对齐，段前 12 磅，段后 6 磅。\n四级标题：宋体，小四号，加粗，左对齐，段前 6 磅，段后 6 磅。\n正文：宋体，小四号，1.5 倍行距，首行缩进 2 字符，两端对齐。",
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
    isBuiltin: true,
  },
  {
    id: "builtin-report",
    name: "通用报告（三级标题）",
    prompt: "一级标题：微软雅黑，二号，加粗，居中，段前 24 磅，段后 18 磅。\n二级标题：微软雅黑，三号，加粗，左对齐，段前 18 磅，段后 12 磅。\n三级标题：微软雅黑，四号，加粗，左对齐，段前 12 磅，段后 6 磅。\n正文：微软雅黑，小四号，1.5 倍行距，首行缩进 2 字符，两端对齐。",
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
    isBuiltin: true,
  },
  {
    id: "builtin-official-document",
    name: "行政公文（标题与正文）",
    prompt: "标题：方正小标宋简体，二号，居中，段后 24 磅。\n一级标题：黑体，三号，左对齐，段前 18 磅，段后 6 磅。\n二级标题：楷体_GB2312，三号，左对齐，段前 12 磅，段后 6 磅。\n正文：仿宋_GB2312，三号，28 磅固定行距，首行缩进 2 字符，两端对齐。",
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
    isBuiltin: true,
  },
] as const;

function sortStylePromptTemplates(items: StylePromptTemplateRecord[]): StylePromptTemplateRecord[] {
  return items.slice().sort((a, b) => {
    if (a.isBuiltin !== b.isBuiltin) return a.isBuiltin ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

export function loadStylePromptTemplateLibrary(raw: string | null, now = Date.now()): StylePromptTemplateRecord[] {
  let parsed: unknown = [];
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    parsed = [];
  }

  const builtinIds = new Set(BUILTIN_STYLE_PROMPT_TEMPLATES.map((item) => item.id));
  const customTemplates: StylePromptTemplateRecord[] = Array.isArray(parsed)
    ? parsed
        .map((item): StylePromptTemplateRecord | null => {
          const record = item as Partial<StylePromptTemplateRecord> | null;
          const id = String(record?.id || "").trim();
          const name = String(record?.name || "").trim();
          const prompt = String(record?.prompt || "").trim();
          if (!id || !name || !prompt || builtinIds.has(id)) return null;
          return {
            id,
            name,
            prompt,
            createdAt: Number.isFinite(Number(record?.createdAt)) ? Number(record?.createdAt) : now,
            updatedAt: Number.isFinite(Number(record?.updatedAt)) ? Number(record?.updatedAt) : now,
            isBuiltin: false,
          };
        })
        .filter((item): item is StylePromptTemplateRecord => item !== null)
    : [];

  return sortStylePromptTemplates([...BUILTIN_STYLE_PROMPT_TEMPLATES, ...customTemplates]);
}
