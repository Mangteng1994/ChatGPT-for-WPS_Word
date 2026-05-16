export type HeadingLevel = 1 | 2 | 3 | 4;
export type NumberingSuffix = "space" | "tab" | "nothing";
export type NumberingFormat =
  | "decimal"
  | "lowerLetter"
  | "upperLetter"
  | "lowerRoman"
  | "upperRoman"
  | "numberInCircle"
  | "parenthesizedNumber"
  | "parenthesizedArabic";

export interface ParsedHeadingStyleTokens {
  basedOnNone: boolean | null;
  fontSizeAlias: string | null;
  fontSizePt: number | null;
  bold: boolean | null;
  eastAsiaFont: string | null;
  asciiFont: string | null;
  complexFont: string | null;
  lineSpacing: number | null;
  paragraphZero: boolean;
  beforeAfterZero: boolean;
  indentZero: boolean;
  snapToGrid: boolean | null;
  numberingAlignLeftZero: boolean;
  numberingTextIndentZero: boolean;
  numberingNoTab: boolean;
  numberingSuffix: NumberingSuffix | null;
}

export interface ParsedHeadingStyleBlock {
  name: string;
  level: HeadingLevel;
  rawText: string;
  tokens: ParsedHeadingStyleTokens;
}

export const FONT_SIZE_ALIAS_TO_PT: Record<string, number> = {
  三号: 16,
  小三: 15,
  四号: 14,
  小四: 12,
  五号: 10.5,
};

const DEFAULT_STYLE_NAME_BY_LEVEL: Record<HeadingLevel, string> = {
  1: "一级标题",
  2: "二级标题",
  3: "三级标题",
  4: "四级标题",
};

const HEADING_MARKER_REGEX = /(一级标题|二级标题|三级标题|四级标题|标题\s*[1-4]|heading\s*[1-4]|h[1-4])\s*[：:]/gim;
const HEADING_MENTION_REGEX = /(一级标题|二级标题|三级标题|四级标题|标题\s*[1-4]|heading\s*[1-4]|h[1-4])/gim;

interface HeadingSection {
  level: HeadingLevel;
  name: string;
  rawText: string;
}

export function parseNaturalLanguageStyleInput(input: string): ParsedHeadingStyleBlock[] {
  const text = String(input || "").trim();
  if (!text) return [];

  const sections = splitIntoHeadingSections(text);
  return sections
    .map((section) => ({
      name: section.name,
      level: section.level,
      rawText: section.rawText,
      tokens: parseHeadingTokens(section.rawText),
    }))
    .sort((a, b) => a.level - b.level);
}

function splitIntoHeadingSections(text: string): HeadingSection[] {
  const markers: Array<{ level: HeadingLevel; index: number; end: number }> = [];
  const markerRegex = new RegExp(HEADING_MARKER_REGEX);
  let match: RegExpExecArray | null = null;
  while ((match = markerRegex.exec(text)) !== null) {
    const level = resolveHeadingLevel(match[1]);
    if (!level) continue;
    markers.push({
      level,
      index: match.index,
      end: match.index + match[0].length,
    });
  }

  if (markers.length > 0) {
    const sectionMap = new Map<HeadingLevel, HeadingSection>();
    for (let i = 0; i < markers.length; i += 1) {
      const current = markers[i];
      const next = markers[i + 1];
      const body = text.slice(current.end, next ? next.index : text.length).trim();
      sectionMap.set(current.level, {
        level: current.level,
        name: DEFAULT_STYLE_NAME_BY_LEVEL[current.level],
        rawText: body || text,
      });
    }
    return Array.from(sectionMap.values());
  }

  const mentionRegex = new RegExp(HEADING_MENTION_REGEX);
  const levels = new Set<HeadingLevel>();
  while ((match = mentionRegex.exec(text)) !== null) {
    const level = resolveHeadingLevel(match[1]);
    if (level) levels.add(level);
  }

  const resolvedLevels = levels.size ? Array.from(levels.values()) : ([1, 2, 3, 4] as HeadingLevel[]);
  return resolvedLevels.map((level) => ({
    level,
    name: DEFAULT_STYLE_NAME_BY_LEVEL[level],
    rawText: text,
  }));
}

function resolveHeadingLevel(label: string): HeadingLevel | null {
  const normalized = String(label || "")
    .toLowerCase()
    .replace(/\s+/g, "");

  if (!normalized) return null;
  if (normalized.includes("一级") || normalized.includes("标题1") || normalized.includes("heading1") || normalized === "h1") return 1;
  if (normalized.includes("二级") || normalized.includes("标题2") || normalized.includes("heading2") || normalized === "h2") return 2;
  if (normalized.includes("三级") || normalized.includes("标题3") || normalized.includes("heading3") || normalized === "h3") return 3;
  if (normalized.includes("四级") || normalized.includes("标题4") || normalized.includes("heading4") || normalized === "h4") return 4;
  return null;
}

function parseHeadingTokens(text: string): ParsedHeadingStyleTokens {
  const source = String(text || "");
  const fontSize = parseFontSize(source);
  const latinFont = extractLatinFont(source);
  const mentionsEnglish = /英文|西文|ascii|hansi/i.test(source);
  const mentionsComplex = /复杂字体|复杂字|cs字体|bi字体|双向字体/i.test(source);
  const mentionsEnglishAndComplex = /英文和复杂(?:字体)?|英文、复杂(?:字体)?|英文字体和复杂字体/i.test(source);

  const notBold = /(不加粗|取消加粗|非加粗|常规字重|正常字重|regular)/i.test(source);
  const shouldBold = /(加粗|粗体|\bbold\b)/i.test(source);
  let bold: boolean | null = null;
  if (notBold) bold = false;
  else if (shouldBold) bold = true;

  const lineSpacingMatch = /([0-9]+(?:\.[0-9]+)?)\s*倍(?:行距|间距)?/i.exec(source);
  const lineSpacing = lineSpacingMatch ? Number(lineSpacingMatch[1]) : null;

  const paragraphZero = /其余[^。；;\n]*(0|零|无)|其余都是0|其余都为0|其余都是0或无|全部为0/i.test(source);
  const beforeAfterZero =
    /段前段后[^。；;\n]*(0|零|无)/i.test(source) ||
    (/段前[^。；;\n]*(0|零|无)/i.test(source) && /段后[^。；;\n]*(0|零|无)/i.test(source));
  const indentZero =
    /缩进[^。；;\n]*(0|零|无)/i.test(source) ||
    /左缩进[^。；;\n]*(0|零|无)/i.test(source) ||
    /右缩进[^。；;\n]*(0|零|无)/i.test(source) ||
    /首行缩进[^。；;\n]*(0|零|无)/i.test(source);

  const numberingAlignLeftZero =
    /编号(?:左对齐)?位置[^。；;\n]*(0|零)/i.test(source) || /编号对齐位置[^。；;\n]*(0|零)/i.test(source);
  const numberingTextIndentZero =
    /(文本缩进位置|文本位置|悬挂缩进|编号文本缩进|文本缩进)[^。；;\n]*(0|零|无)/i.test(source);
  const numberingNoTab = /(不用|不使用|不要)\s*(制表符|tab)/i.test(source);

  let numberingSuffix: NumberingSuffix | null = null;
  if (/编号后[^。；;\n]*(空格)|用空格|后跟空格|编号和(?:汉字|标题文字)之间[^。；;\n]*空格/i.test(source)) {
    numberingSuffix = "space";
  } else if (/编号后[^。；;\n]*(制表符|tab)/i.test(source)) {
    numberingSuffix = "tab";
  } else if (/编号后[^。；;\n]*(无|不加|不使用)/i.test(source)) {
    numberingSuffix = "nothing";
  }
  if (numberingNoTab && numberingSuffix === "tab") {
    numberingSuffix = "space";
  }

  let asciiFont: string | null = null;
  let complexFont: string | null = null;
  if (latinFont) {
    if (mentionsEnglishAndComplex) {
      asciiFont = latinFont;
      complexFont = latinFont;
    } else {
      if (mentionsEnglish || /times\s+new\s+roman/i.test(source)) asciiFont = latinFont;
      if (mentionsComplex || (/times\s+new\s+roman/i.test(source) && /复杂/.test(source))) complexFont = latinFont;
      if (!mentionsEnglish && !mentionsComplex && /times\s+new\s+roman/i.test(source)) {
        asciiFont = latinFont;
        complexFont = latinFont;
      }
    }
  }

  return {
    basedOnNone: /(基于|based\s*on)\s*(无样式|no\s*style|none|无)/i.test(source) ? true : null,
    fontSizeAlias: fontSize.alias,
    fontSizePt: fontSize.pt,
    bold,
    eastAsiaFont: extractChineseFont(source),
    asciiFont,
    complexFont,
    lineSpacing: Number.isFinite(lineSpacing || NaN) ? lineSpacing : null,
    paragraphZero,
    beforeAfterZero,
    indentZero,
    snapToGrid: /(定义(文档)?网格|勾选.*网格|与文档网格对齐|snap\s*to\s*grid)/i.test(source) ? true : null,
    numberingAlignLeftZero,
    numberingTextIndentZero,
    numberingNoTab,
    numberingSuffix,
  };
}

function parseFontSize(text: string): { alias: string | null; pt: number | null } {
  const aliasMatch = /(小三|小四|三号|四号|五号)/.exec(text);
  if (aliasMatch) {
    const alias = aliasMatch[1];
    return { alias, pt: FONT_SIZE_ALIAS_TO_PT[alias] || null };
  }

  const ptMatch = /([0-9]+(?:\.[0-9]+)?)\s*(pt|磅)/i.exec(text);
  if (ptMatch) {
    return { alias: null, pt: Number(ptMatch[1]) };
  }

  return { alias: null, pt: null };
}

function extractChineseFont(text: string): string | null {
  const directMatch = /中文(?:字体)?[^，。；;:\n]*?(宋体|仿宋|黑体|楷体|微软雅黑|等线)/i.exec(text);
  if (directMatch) return directMatch[1];
  if (/宋体/.test(text)) return "宋体";
  return null;
}

function extractLatinFont(text: string): string | null {
  const match = /\b(Times New Roman|Calibri|Arial|Cambria|Georgia|Tahoma|Verdana)\b/i.exec(text);
  if (!match) return null;
  return canonicalLatinFont(match[1]);
}

function canonicalLatinFont(value: string): string {
  if (/times\s+new\s+roman/i.test(value)) return "Times New Roman";
  return String(value || "").replace(/\s+/g, " ").trim();
}
