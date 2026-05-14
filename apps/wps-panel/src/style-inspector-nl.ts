import type {
  FontStyleInfo,
  NumberingStyleInfo,
  ParagraphAlignment,
  ParagraphStyleDescription,
  ParagraphStyleInfo,
  SelectionStyleDescriptionResult,
  SelectionStyleStructuredResult,
  StyleComparisonResult,
  StyleType,
} from "./style-inspector-types";

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "未读取到明确设置";
  if (Math.abs(value % 1) < 0.0001) return String(value.toFixed(0));
  return String(value);
}

function formatPointValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "未读取到明确设置";
  if (Math.abs(value % 1) < 0.0001) return `${value.toFixed(0)} 磅`;
  return `${value} 磅`;
}

function styleTypeLabel(value: StyleType): string {
  if (value === "paragraph") return "段落样式";
  if (value === "character") return "字符样式";
  if (value === "table") return "表格样式";
  if (value === "list") return "列表样式";
  return "未知样式";
}

function alignmentLabel(value: ParagraphAlignment): string {
  if (value === "left") return "左对齐";
  if (value === "center") return "居中";
  if (value === "right") return "右对齐";
  if (value === "justify") return "两端对齐";
  if (value === "distribute") return "分散对齐";
  return "未读取到明确设置";
}

function numberingAlignmentLabel(value: NumberingStyleInfo["align"]): string {
  if (value === "left") return "左对齐";
  if (value === "center") return "居中";
  if (value === "right") return "右对齐";
  return "未读取到明确设置";
}

function numberingSuffixLabel(value: NumberingStyleInfo["suffix"]): string {
  if (value === "space") return "编号后使用空格，不使用制表符";
  if (value === "tab") return "编号后使用制表符";
  if (value === "nothing") return "编号后不使用空格和制表符";
  return "编号后字符未读取到明确设置";
}

function levelLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "未读取到层级";
  const mapping: Record<number, string> = {
    1: "一级",
    2: "二级",
    3: "三级",
    4: "四级",
    5: "五级",
    6: "六级",
    7: "七级",
    8: "八级",
    9: "九级",
  };
  return mapping[Math.floor(value)] || `第${Math.floor(value)}级`;
}

function fontDescription(font: FontStyleInfo): string {
  const parts: string[] = [];
  const sizePart = font.sizeName || (font.sizePt !== null ? `${formatNumber(font.sizePt)}pt` : "字号未读取到明确设置");
  if (font.bold === true) {
    parts.push(`${sizePart}加粗`);
  } else if (font.bold === false) {
    parts.push(`${sizePart}不加粗`);
  } else {
    parts.push(sizePart);
  }

  if (font.italic === true) parts.push("倾斜");
  if (font.italic === false) parts.push("不倾斜");

  if (font.eastAsia && font.eastAsia !== "unknown") {
    parts.push(`中文字体为 ${font.eastAsia}`);
  }

  const ascii = font.ascii && font.ascii !== "unknown" ? font.ascii : null;
  const cs = font.cs && font.cs !== "unknown" ? font.cs : null;
  if (ascii && cs && ascii === cs) {
    parts.push(`英文和复杂字体为 ${ascii}`);
  } else {
    if (ascii) parts.push(`英文字体为 ${ascii}`);
    if (cs) parts.push(`复杂字体为 ${cs}`);
  }

  if (font.color && font.color !== "unknown") {
    parts.push(`字体颜色为 ${font.color}`);
  }
  if (font.underline === true) parts.push("带下划线");
  if (font.strikeThrough === true) parts.push("带删除线");
  if (font.doubleStrikeThrough === true) parts.push("带双删除线");

  return parts.join("，");
}

function lineSpacingDescription(paragraph: ParagraphStyleInfo): string {
  if (paragraph.lineSpacingRule === "single") return "单倍行距";
  if (paragraph.lineSpacingRule === "onePointFive") return "1.5 倍行距";
  if (paragraph.lineSpacingRule === "double") return "2 倍行距";
  if (paragraph.lineSpacingRule === "multiple") {
    if (paragraph.lineSpacing !== null) return `${formatNumber(paragraph.lineSpacing)} 倍行距`;
    return "多倍行距";
  }
  if (paragraph.lineSpacingRule === "exactly") {
    return `固定值 ${formatPointValue(paragraph.lineSpacingPt)}`;
  }
  if (paragraph.lineSpacingRule === "atLeast") {
    return `最小值 ${formatPointValue(paragraph.lineSpacingPt)}`;
  }
  return "行距未读取到明确设置";
}

function paragraphSpacingDescription(paragraph: ParagraphStyleInfo): string {
  if (paragraph.beforePt === 0 && paragraph.afterPt === 0) {
    return "段前段后均为 0";
  }
  const parts: string[] = [];
  if (paragraph.beforePt !== null) parts.push(`段前 ${formatNumber(paragraph.beforePt)}`);
  if (paragraph.afterPt !== null) parts.push(`段后 ${formatNumber(paragraph.afterPt)}`);
  return parts.join("，") || "段前段后未读取到明确设置";
}

function paragraphIndentDescription(paragraph: ParagraphStyleInfo): string {
  const firstLineZero = paragraph.firstLineIndentChars !== null ? paragraph.firstLineIndentChars === 0 : paragraph.firstLineIndent === 0;
  const allZero =
    paragraph.leftIndent === 0 &&
    paragraph.rightIndent === 0 &&
    firstLineZero &&
    (paragraph.hangingIndent === 0 || paragraph.hangingIndent === null);
  if (allZero) {
    return "左缩进、右缩进和首行缩进均为 0";
  }

  const parts: string[] = [];
  if (paragraph.leftIndent !== null) parts.push(`左缩进 ${formatNumber(paragraph.leftIndent)}`);
  if (paragraph.rightIndent !== null) parts.push(`右缩进 ${formatNumber(paragraph.rightIndent)}`);
  if (paragraph.firstLineIndentChars !== null) parts.push(`首行缩进 ${formatNumber(paragraph.firstLineIndentChars)} 字符`);
  else if (paragraph.firstLineIndent !== null) parts.push(`首行缩进 ${formatNumber(paragraph.firstLineIndent)}`);
  if (paragraph.hangingIndent !== null && paragraph.hangingIndent > 0) {
    parts.push(`悬挂缩进 ${formatNumber(paragraph.hangingIndent)}`);
  }
  return parts.join("，") || "缩进未读取到明确设置";
}

function paragraphDescription(paragraph: ParagraphStyleInfo): string {
  const parts = [lineSpacingDescription(paragraph), paragraphSpacingDescription(paragraph), paragraphIndentDescription(paragraph)];
  const alignText = alignmentLabel(paragraph.alignment);
  if (alignText !== "未读取到明确设置") {
    parts.push(`对齐方式为${alignText}`);
  }
  if (paragraph.snapToGrid === true) {
    parts.push("勾选定义文档网格");
  } else if (paragraph.snapToGrid === false) {
    parts.push("未勾选定义文档网格");
  }
  return parts.join("，");
}

function numberingDescription(numbering: NumberingStyleInfo): string {
  if (!numbering.enabled) return "无编号设置";

  const parts: string[] = [];
  parts.push(`编号为${levelLabel(numbering.level)}编号`);
  if (numbering.displayFormat) {
    parts.push(`格式为 ${numbering.displayFormat}`);
  } else if (numbering.levelText) {
    parts.push(`级别模板为 ${numbering.levelText}`);
  }

  if (numbering.align !== "unknown") {
    parts.push(`编号对齐方式为${numberingAlignmentLabel(numbering.align)}`);
  }
  if (numbering.leftIndent !== null) {
    parts.push(`编号对齐位置为 ${formatNumber(numbering.leftIndent)}`);
  }
  if (numbering.textIndent !== null) {
    parts.push(`文本缩进位置为 ${formatNumber(numbering.textIndent)}`);
  }
  if (numbering.hanging !== null) {
    parts.push(`编号悬挂值为 ${formatNumber(numbering.hanging)}`);
  }
  parts.push(numberingSuffixLabel(numbering.suffix));
  if (numbering.linkedStyle) {
    parts.push(`编号绑定样式为 ${numbering.linkedStyle}`);
  }
  return parts.join("，");
}

function paragraphStyleSentence(item: ParagraphStyleDescription, subject: string): string {
  const styleName = item.style.name || "未命名样式";
  const styleType = styleTypeLabel(item.style.type);
  const basedOn =
    item.style.basedOn === null
      ? "基于无样式"
      : item.style.basedOn === "unknown"
      ? "基准样式未读取到明确设置"
      : `基于${item.style.basedOn}`;

  return `${subject}使用${styleName}样式（${styleType}），${basedOn}，${fontDescription(item.font)}；段落为${paragraphDescription(
    item.paragraph
  )}；${numberingDescription(item.numbering)}。`;
}

export function buildSelectionStyleDescription(
  structured: SelectionStyleStructuredResult,
  comparison: StyleComparisonResult
): SelectionStyleDescriptionResult {
  const paragraphs = structured.paragraphs.map((item) => ({
    ...item,
    naturalLanguage: paragraphStyleSentence(item, `第${item.paragraphIndex}段`),
  }));

  const first = paragraphs[0] || null;
  if (paragraphs.length === 1 && first) {
    const subject = structured.target === "cursorParagraph" ? "当前段落" : "所选段落";
    const naturalLanguage = paragraphStyleSentence(first, subject);
    return {
      ...structured,
      style: first.style,
      font: first.font,
      paragraph: first.paragraph,
      numbering: first.numbering,
      paragraphs,
      ...comparison,
      summary: naturalLanguage,
      naturalLanguage,
    };
  }

  const summary = `所选内容包含 ${structured.paragraphCount} 个段落。`;
  const detailLines = paragraphs.map((item) => item.naturalLanguage).join("\n");
  const naturalLanguage = detailLines ? `${summary}\n${detailLines}` : summary;

  return {
    ...structured,
    style: comparison.styleConsistent && first ? first.style : null,
    font: comparison.styleConsistent && first ? first.font : null,
    paragraph: comparison.styleConsistent && first ? first.paragraph : null,
    numbering: comparison.styleConsistent && first ? first.numbering : null,
    paragraphs,
    ...comparison,
    summary,
    naturalLanguage,
  };
}
