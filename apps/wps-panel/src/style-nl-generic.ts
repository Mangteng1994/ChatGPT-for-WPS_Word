import { FONT_SIZE_ALIAS_TO_PT, type NumberingSuffix } from "./style-nl-parser";

export type GenericStyleType = "paragraph" | "character";
export type GenericParagraphAlignment = "left" | "center" | "right" | "justify" | "distribute" | "unknown";
export type GenericLineSpacingRule = "single" | "onePointFive" | "double" | "multiple" | "exactly" | "atLeast" | "unknown";

export interface StructuredGenericStyleSpec {
  name: string;
  styleType: GenericStyleType;
  basedOn: string | null | "unknown";
  font: {
    eastAsia: string | null;
    ascii: string | null;
    hAnsi: string | null;
    cs: string | null;
    sizePt: number | null;
    bold: boolean | null;
    italic: boolean | null;
    color: string | null;
    underline: boolean | null;
    strikeThrough: boolean | null;
    doubleStrikeThrough: boolean | null;
  };
  paragraph: {
    lineSpacingRule: GenericLineSpacingRule;
    lineSpacing: number | null;
    lineSpacingPt: number | null;
    beforePt: number | null;
    afterPt: number | null;
    leftIndent: number | null;
    rightIndent: number | null;
    firstLineIndent: number | null;
    firstLineIndentChars: number | null;
    alignment: GenericParagraphAlignment;
    snapToGrid: boolean | null;
  };
  numbering: {
    enabled: boolean | null;
    level: number | null;
    levelText: string | null;
    suffix: NumberingSuffix | null;
  };
}

const HEADING_STYLE_NAMES = new Set(["一级标题", "二级标题", "三级标题", "四级标题", "标题1", "标题2", "标题3", "标题4", "heading 1", "heading 2", "heading 3", "heading 4"]);

const CN_LEVEL_TO_NUMBER: Record<string, number> = {
  一级: 1,
  二级: 2,
  三级: 3,
  四级: 4,
  五级: 5,
  六级: 6,
  七级: 7,
  八级: 8,
  九级: 9,
};

const LATIN_FONTS = [
  "Times New Roman",
  "Calibri",
  "Arial",
  "Cambria",
  "Georgia",
  "Tahoma",
  "Verdana",
];

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\r/g, "").trim();
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNumber(value: string): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  if (Math.abs(numeric) < 0.00001) return 0;
  return numeric;
}

function parseChineseNumber(value: string): number | null {
  const token = normalizeText(value).replace(/个/g, "");
  if (!token) return null;
  if (token === "半") return 0.5;
  const digitMap: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (token in digitMap) return digitMap[token];

  if (/^[负\-]/.test(token)) {
    const next = parseChineseNumber(token.replace(/^[负\-]/, ""));
    return next === null ? null : -next;
  }

  const decimalMatch = /^([零一二两三四五六七八九十]+)点([零一二两三四五六七八九]+)$/.exec(token);
  if (decimalMatch) {
    const integer = parseChineseNumber(decimalMatch[1]);
    if (integer === null) return null;
    const decimalDigits = Array.from(decimalMatch[2])
      .map((char) => digitMap[char])
      .filter((num) => Number.isFinite(num));
    if (!decimalDigits.length) return integer;
    const decimalValue = Number(`0.${decimalDigits.join("")}`);
    return integer + decimalValue;
  }

  if (token.includes("十")) {
    const [tensPart, onesPart] = token.split("十");
    const tens = tensPart ? digitMap[tensPart] : 1;
    if (!Number.isFinite(tens)) return null;
    const ones = onesPart ? digitMap[onesPart] : 0;
    if (!Number.isFinite(ones)) return null;
    return tens * 10 + ones;
  }

  return null;
}

function parseNumberLike(value: string): number | null {
  const direct = parseNumber(value);
  if (direct !== null) return direct;
  return parseChineseNumber(value);
}

function normalizedStyleName(value: string): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function isHeadingStyleName(styleName: string): boolean {
  const normalized = normalizedStyleName(styleName).toLowerCase();
  if (!normalized) return false;
  if (HEADING_STYLE_NAMES.has(normalized)) return true;
  return /^标题\s*[1-4]$/.test(normalized) || /^heading\s*[1-4]$/.test(normalized);
}

function isNoStyle(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  return !normalized || normalized === "无样式" || normalized === "none" || normalized === "no style";
}

function captureAfter(source: string, pattern: RegExp): string | null {
  const match = pattern.exec(source);
  if (!match) return null;
  const value = normalizeText(match[1]);
  return value || null;
}

function parseFontSize(source: string): number | null {
  const aliasMatch = /(小三|小四|三号|四号|五号)/.exec(source);
  if (aliasMatch) return FONT_SIZE_ALIAS_TO_PT[aliasMatch[1]] ?? null;
  const ptMatch = /([0-9]+(?:\.[0-9]+)?)\s*(?:pt|磅)/i.exec(source);
  if (ptMatch) return parseNumber(ptMatch[1]);
  return null;
}

function parseBold(source: string): boolean | null {
  if (/(不加粗|取消加粗|非加粗|常规字重|正常字重|regular)/i.test(source)) return false;
  if (/(加粗|粗体|\bbold\b)/i.test(source)) return true;
  return null;
}

function parseItalic(source: string): boolean | null {
  if (/(不倾斜|取消倾斜|非倾斜|正常字形|不斜体|regular)/i.test(source)) return false;
  if (/(倾斜|斜体|\bitalic\b)/i.test(source)) return true;
  return null;
}

function parseColor(source: string): string | null {
  const hex = /#([0-9a-fA-F]{6})/.exec(source);
  if (hex) return `#${hex[1].toUpperCase()}`;
  return null;
}

function parseChineseFont(source: string): string | null {
  const direct = captureAfter(source, /中文(?:字体)?(?:为|：)?\s*([^，。；;\n]+)/i);
  if (direct) return direct;
  if (/宋体/.test(source)) return "宋体";
  return null;
}

function canonicalLatinFont(value: string): string {
  for (const font of LATIN_FONTS) {
    if (new RegExp(font.replace(/\s+/g, "\\s+"), "i").test(value)) return font;
  }
  return normalizedStyleName(value);
}

function parseLatinFont(source: string): string | null {
  for (const font of LATIN_FONTS) {
    const regex = new RegExp(font.replace(/\s+/g, "\\s+"), "i");
    const match = regex.exec(source);
    if (match) return canonicalLatinFont(match[0]);
  }
  const direct = captureAfter(source, /(?:英文字体|英文|西文|复杂字体|复杂字|cs字体)(?:为|：)?\s*([^，。；;\n]+)/i);
  return direct ? canonicalLatinFont(direct) : null;
}

function parseLineSpacing(source: string): { rule: GenericLineSpacingRule; multiple: number | null; points: number | null } {
  if (/单倍行距/.test(source)) return { rule: "single", multiple: 1, points: null };
  if (/1\.5\s*倍行距/.test(source)) return { rule: "onePointFive", multiple: 1.5, points: null };
  if (/2(?:\.0+)?\s*倍行距/.test(source)) return { rule: "double", multiple: 2, points: null };
  const multi = /([0-9]+(?:\.[0-9]+)?)\s*倍行距/.exec(source);
  if (multi) return { rule: "multiple", multiple: parseNumber(multi[1]), points: null };
  const exactly = /固定值\s*([0-9]+(?:\.[0-9]+)?)\s*(?:pt|磅)?/.exec(source);
  if (exactly) return { rule: "exactly", multiple: null, points: parseNumber(exactly[1]) };
  const atLeast = /最小值\s*([0-9]+(?:\.[0-9]+)?)\s*(?:pt|磅)?/.exec(source);
  if (atLeast) return { rule: "atLeast", multiple: null, points: parseNumber(atLeast[1]) };
  return { rule: "unknown", multiple: null, points: null };
}

function parseSpacing(source: string): { beforePt: number | null; afterPt: number | null } {
  const both = /段前段后(?:均为|都为|为)?\s*([0-9]+(?:\.[0-9]+)?)/.exec(source);
  if (both) {
    const value = parseNumber(both[1]);
    return { beforePt: value, afterPt: value };
  }
  const before = captureAfter(source, /段前(?:为|：)?\s*([0-9]+(?:\.[0-9]+)?)/);
  const after = captureAfter(source, /段后(?:为|：)?\s*([0-9]+(?:\.[0-9]+)?)/);
  return {
    beforePt: before ? parseNumber(before) : null,
    afterPt: after ? parseNumber(after) : null,
  };
}

function parseIndents(source: string): { left: number | null; right: number | null; firstPt: number | null; firstChars: number | null } {
  const allZero = /左缩进、右缩进和首行缩进(?:均为|都为|为)\s*([0-9]+(?:\.[0-9]+)?|零)/.exec(source);
  if (allZero) {
    const value = parseNumberLike(allZero[1]);
    return { left: value, right: value, firstPt: value, firstChars: null };
  }
  const left = captureAfter(source, /左缩进(?:为|：)?\s*([\-]?(?:[0-9]+(?:\.[0-9]+)?|零|一|二|两|三|四|五|六|七|八|九|十))/);
  const right = captureAfter(source, /右缩进(?:为|：)?\s*([\-]?(?:[0-9]+(?:\.[0-9]+)?|零|一|二|两|三|四|五|六|七|八|九|十))/);
  const firstChars = captureAfter(
    source,
    /首行缩进(?:为|：)?\s*([\-]?(?:[0-9]+(?:\.[0-9]+)?|零|一|二|两|三|四|五|六|七|八|九|十|[零一二两三四五六七八九十]+点[零一二两三四五六七八九]+))(?:个)?\s*(?:字|字符)/
  );
  const first = captureAfter(
    source,
    /首行缩进(?:为|：)?\s*([\-]?(?:[0-9]+(?:\.[0-9]+)?|零|一|二|两|三|四|五|六|七|八|九|十|[零一二两三四五六七八九十]+点[零一二两三四五六七八九]+))/
  );
  return {
    left: left ? parseNumberLike(left) : null,
    right: right ? parseNumberLike(right) : null,
    firstPt: firstChars ? null : first ? parseNumberLike(first) : null,
    firstChars: firstChars ? parseNumberLike(firstChars) : null,
  };
}

function parseAlignment(source: string): GenericParagraphAlignment {
  if (/两端对齐/.test(source)) return "justify";
  if (/分散对齐/.test(source)) return "distribute";
  if (/居中|居中对齐/.test(source)) return "center";
  if (/右对齐/.test(source)) return "right";
  if (/左对齐/.test(source)) return "left";
  return "unknown";
}

function parseSnapToGrid(source: string): boolean | null {
  if (/(勾选|启用).*(文档)?网格|snap\s*to\s*grid/i.test(source)) return true;
  if (/(未勾选|取消).*(文档)?网格|no\s*snap\s*to\s*grid/i.test(source)) return false;
  return null;
}

function parseNumbering(source: string): StructuredGenericStyleSpec["numbering"] {
  let enabled: boolean | null = null;
  if (/无编号|不编号|不使用编号|没有编号/.test(source)) enabled = false;
  else if (/编号为|编号格式/.test(source)) enabled = true;

  let level: number | null = null;
  const levelMatch = /(一级|二级|三级|四级|五级|六级|七级|八级|九级)编号/.exec(source);
  if (levelMatch) level = CN_LEVEL_TO_NUMBER[levelMatch[1]] || null;

  const formatMatch = /编号(?:格式)?(?:为|：)\s*([0-9]+(?:\.[0-9]+){0,8})/.exec(source);
  let levelText: string | null = null;
  if (formatMatch) {
    const levelCount = formatMatch[1].split(".").length;
    levelText = Array.from({ length: levelCount }, (_, idx) => `%${idx + 1}`).join(".");
  }

  let suffix: NumberingSuffix | null = null;
  if (/编号后字符未读取到明确设置|编号后[^。；;\n]*未读取到明确设置/.test(source)) {
    suffix = null;
  } else if (/编号后[^。；;\n]*(空格)|用空格|后跟空格/i.test(source)) {
    suffix = "space";
  } else if (/编号后[^。；;\n]*(制表符|tab)/i.test(source)) {
    suffix = "tab";
  } else if (/编号后[^。；;\n]*(无|不使用|不要)/i.test(source)) {
    suffix = "nothing";
  }

  return {
    enabled,
    level,
    levelText,
    suffix,
  };
}

function parseStyleType(source: string): GenericStyleType {
  if (/字符样式/.test(source)) return "character";
  return "paragraph";
}

function parseBasedOn(source: string): string | null | "unknown" {
  const value = captureAfter(source, /基于\s*([^，。；;\n]+)/);
  if (!value) return "unknown";
  if (isNoStyle(value)) return null;
  return value;
}

function parseStyleSection(name: string, body: string): StructuredGenericStyleSpec {
  const source = normalizeText(body);
  const latin = parseLatinFont(source);
  const englishAndComplex = /英文和复杂(?:字体)?|英文、复杂(?:字体)?|英文字体和复杂字体/.test(source);
  const ascii = englishAndComplex || /(英文|西文|ascii|hansi)/i.test(source) ? latin : null;
  const complex = englishAndComplex || /复杂字体|复杂字|cs字体|bi字体/.test(source) ? latin : null;

  const lineSpacing = parseLineSpacing(source);
  const spacing = parseSpacing(source);
  const indents = parseIndents(source);
  const numbering = parseNumbering(source);

  let levelText = numbering.levelText;
  if (!levelText && numbering.level && numbering.level > 0) {
    levelText = Array.from({ length: numbering.level }, (_, idx) => `%${idx + 1}`).join(".");
  }

  return {
    name,
    styleType: parseStyleType(source),
    basedOn: parseBasedOn(source),
    font: {
      eastAsia: parseChineseFont(source),
      ascii,
      hAnsi: ascii,
      cs: complex || ascii,
      sizePt: parseFontSize(source),
      bold: parseBold(source),
      italic: parseItalic(source),
      color: parseColor(source),
      underline: /(下划线)/.test(source) ? true : /(取消下划线|无下划线)/.test(source) ? false : null,
      strikeThrough: /(删除线)/.test(source) ? true : /(取消删除线|无删除线)/.test(source) ? false : null,
      doubleStrikeThrough: /(双删除线)/.test(source) ? true : /(取消双删除线|无双删除线)/.test(source) ? false : null,
    },
    paragraph: {
      lineSpacingRule: lineSpacing.rule,
      lineSpacing: lineSpacing.multiple,
      lineSpacingPt: lineSpacing.points,
      beforePt: spacing.beforePt,
      afterPt: spacing.afterPt,
      leftIndent: indents.left,
      rightIndent: indents.right,
      firstLineIndent: indents.firstPt,
      firstLineIndentChars: indents.firstChars,
      alignment: parseAlignment(source),
      snapToGrid: parseSnapToGrid(source),
    },
    numbering: {
      enabled: numbering.enabled,
      level: numbering.level,
      levelText,
      suffix: numbering.suffix,
    },
  };
}

function splitExplicitSections(text: string): Array<{ name: string; body: string }> {
  const sections: Array<{ name: string; body: string }> = [];
  const regex = /(?:^|\n)\s*([^\n：:]{1,40})\s*[：:]\s*([\s\S]*?)(?=(?:\n\s*[^\n：:]{1,40}\s*[：:])|$)/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(text)) !== null) {
    const name = normalizedStyleName(match[1]);
    if (!name) continue;
    sections.push({
      name,
      body: normalizeText(match[2] || ""),
    });
  }
  return sections;
}

export interface GenericStyleParseResult {
  explicitSections: StructuredGenericStyleSpec[];
  nonHeadingSections: StructuredGenericStyleSpec[];
}

export function parseGenericStylesFromNaturalLanguage(input: string): GenericStyleParseResult {
  const text = normalizeText(input);
  if (!text) {
    return { explicitSections: [], nonHeadingSections: [] };
  }

  const sections = splitExplicitSections(text).map((item) => parseStyleSection(item.name, item.body || text));
  const explicitSections = sections.filter((item) => Boolean(item.name));
  const nonHeadingSections = explicitSections.filter((item) => !isHeadingStyleName(item.name));
  return { explicitSections, nonHeadingSections };
}
