import type {
  ParagraphStyleDescription,
  ParagraphStyleGroup,
  StyleComparisonResult,
  StyleDifferenceItem,
} from "./style-inspector-types";

interface FieldDef {
  key: string;
  label: string;
  pick: (item: ParagraphStyleDescription) => unknown;
}

const DIFFERENCE_FIELDS: FieldDef[] = [
  { key: "style.name", label: "样式名称", pick: (item) => item.style.name },
  { key: "font.sizePt", label: "字号", pick: (item) => item.font.sizePt },
  { key: "font.bold", label: "加粗", pick: (item) => item.font.bold },
  { key: "font.italic", label: "倾斜", pick: (item) => item.font.italic },
  { key: "font.eastAsia", label: "中文字体", pick: (item) => item.font.eastAsia },
  { key: "font.ascii", label: "英文字体", pick: (item) => item.font.ascii },
  { key: "paragraph.lineSpacingRule", label: "行距规则", pick: (item) => item.paragraph.lineSpacingRule },
  { key: "paragraph.lineSpacing", label: "行距", pick: (item) => item.paragraph.lineSpacing },
  { key: "paragraph.beforePt", label: "段前间距", pick: (item) => item.paragraph.beforePt },
  { key: "paragraph.before", label: "段前间距单位", pick: (item) => item.paragraph.before ? `${item.paragraph.before.value}${item.paragraph.before.unit}` : null },
  { key: "paragraph.afterPt", label: "段后间距", pick: (item) => item.paragraph.afterPt },
  { key: "paragraph.after", label: "段后间距单位", pick: (item) => item.paragraph.after ? `${item.paragraph.after.value}${item.paragraph.after.unit}` : null },
  { key: "paragraph.leftIndent", label: "左缩进", pick: (item) => item.paragraph.leftIndent },
  { key: "paragraph.leftIndentChars", label: "左缩进字符", pick: (item) => item.paragraph.leftIndentChars },
  { key: "paragraph.rightIndent", label: "右缩进", pick: (item) => item.paragraph.rightIndent },
  { key: "paragraph.rightIndentChars", label: "右缩进字符", pick: (item) => item.paragraph.rightIndentChars },
  { key: "paragraph.firstLineIndentChars", label: "首行缩进字符", pick: (item) => item.paragraph.firstLineIndentChars },
  { key: "paragraph.firstLineIndent", label: "首行缩进", pick: (item) => item.paragraph.firstLineIndent },
  { key: "paragraph.hangingIndent", label: "悬挂缩进", pick: (item) => item.paragraph.hangingIndent },
  { key: "paragraph.alignment", label: "对齐方式", pick: (item) => item.paragraph.alignment },
  { key: "paragraph.snapToGrid", label: "文档网格", pick: (item) => item.paragraph.snapToGrid },
  { key: "numbering.enabled", label: "是否编号", pick: (item) => item.numbering.enabled },
  { key: "numbering.level", label: "编号层级", pick: (item) => item.numbering.level },
  { key: "numbering.displayFormat", label: "编号格式", pick: (item) => item.numbering.displayFormat },
  { key: "numbering.leftIndent", label: "编号对齐位置", pick: (item) => item.numbering.leftIndent },
  { key: "numbering.textIndent", label: "文本缩进位置", pick: (item) => item.numbering.textIndent },
  { key: "numbering.suffix", label: "编号后字符", pick: (item) => item.numbering.suffix },
  { key: "numbering.linkedStyle", label: "编号绑定样式", pick: (item) => item.numbering.linkedStyle },
];

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "unknown";
  const text = String(value).trim();
  return text || "unknown";
}

function paragraphStyleSignature(item: ParagraphStyleDescription): string {
  return JSON.stringify({
    style: item.style,
    font: item.font,
    paragraph: item.paragraph,
    numbering: item.numbering,
  });
}

function groupParagraphs(paragraphs: ParagraphStyleDescription[]): ParagraphStyleGroup[] {
  const groups = new Map<string, ParagraphStyleGroup>();
  for (const paragraph of paragraphs) {
    const signature = paragraphStyleSignature(paragraph);
    const existed = groups.get(signature);
    if (existed) {
      existed.paragraphIndexes.push(paragraph.paragraphIndex);
      continue;
    }
    groups.set(signature, {
      signature,
      paragraphIndexes: [paragraph.paragraphIndex],
      style: paragraph,
    });
  }
  return Array.from(groups.values()).sort((a, b) => a.paragraphIndexes[0] - b.paragraphIndexes[0]);
}

function detectDifferences(paragraphs: ParagraphStyleDescription[]): StyleDifferenceItem[] {
  if (paragraphs.length <= 1) return [];
  const result: StyleDifferenceItem[] = [];

  for (const field of DIFFERENCE_FIELDS) {
    const values = paragraphs.map((item) => ({
      paragraphIndex: item.paragraphIndex,
      value: formatValue(field.pick(item)),
    }));
    const uniqueValues = new Set(values.map((item) => item.value));
    if (uniqueValues.size <= 1) continue;
    result.push({
      key: field.key,
      label: field.label,
      values,
    });
  }

  return result;
}

export function compareParagraphStyles(paragraphs: ParagraphStyleDescription[]): StyleComparisonResult {
  const groups = groupParagraphs(paragraphs);
  const differences = detectDifferences(paragraphs);
  const styleConsistent = groups.length <= 1;
  const differenceKeys = differences.map((item) => item.key);
  const differenceLabels = differences.map((item) => item.label);
  return {
    styleConsistent,
    groups,
    differences,
    differenceKeys,
    differenceLabels,
  };
}
