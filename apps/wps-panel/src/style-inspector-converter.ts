import { FONT_SIZE_ALIAS_TO_PT, type NumberingSuffix } from "./style-nl-parser";
import type {
  FontStyleInfo,
  LineSpacingRule,
  NumberingAlignment,
  NumberingStyleInfo,
  ParagraphAlignment,
  ParagraphStyleDescription,
  ParagraphStyleInfo,
  RawParagraphStyleSnapshot,
  RawSelectionStyleSnapshot,
  SelectionStyleStructuredResult,
  StyleBasicInfo,
  StyleInspectTarget,
  StyleType,
} from "./style-inspector-types";
import { normalizeLengthValue } from "./length-units";

const WD_LINE_SPACE_SINGLE = 0;
const WD_LINE_SPACE_1PT5 = 1;
const WD_LINE_SPACE_DOUBLE = 2;
const WD_LINE_SPACE_AT_LEAST = 3;
const WD_LINE_SPACE_EXACTLY = 4;
const WD_LINE_SPACE_MULTIPLE = 5;

const WD_ALIGN_PARAGRAPH_LEFT = 0;
const WD_ALIGN_PARAGRAPH_CENTER = 1;
const WD_ALIGN_PARAGRAPH_RIGHT = 2;
const WD_ALIGN_PARAGRAPH_JUSTIFY = 3;
const WD_ALIGN_PARAGRAPH_DISTRIBUTE = 4;

const WD_LIST_LEVEL_ALIGN_LEFT = 0;
const WD_LIST_LEVEL_ALIGN_CENTER = 1;
const WD_LIST_LEVEL_ALIGN_RIGHT = 2;
const WD_LIST_NO_NUMBERING = 0;
const WD_LIST_LIST_NUM_ONLY = 1;

const WD_TRAILING_TAB = 0;
const WD_TRAILING_SPACE = 1;
const WD_TRAILING_NONE = 2;

const NO_STYLE_NAMES = new Set(["", "none", "no style", "无样式"]);

const FONT_SIZE_PT_TO_ALIAS = new Map<number, string>(
  Object.entries(FONT_SIZE_ALIAS_TO_PT).map(([alias, pt]) => [Number(pt), alias])
);

if (!FONT_SIZE_PT_TO_ALIAS.has(10.5)) {
  FONT_SIZE_PT_TO_ALIAS.set(10.5, "五号");
}

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\r/g, "").trim();
}

function roundNumber(value: number | null, precision = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const base = Math.pow(10, precision);
  const rounded = Math.round(value * base) / base;
  if (Math.abs(rounded) < 0.001) return 0;
  return rounded;
}

function normalizeOptionalText(value: unknown): string | null {
  const text = normalizeText(value);
  return text || null;
}

function isMixedFlagValue(value: number): boolean {
  return Math.abs(value) >= 999999;
}

function toBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (isMixedFlagValue(numeric)) return null;
  if (numeric === 0) return false;
  return true;
}

function mapStyleType(typeValue: number | null): StyleType {
  if (typeValue === 1) return "paragraph";
  if (typeValue === 2) return "character";
  if (typeValue === 3) return "table";
  if (typeValue === 4) return "list";
  return "unknown";
}

function mapParagraphAlignment(value: number | null): ParagraphAlignment {
  if (value === WD_ALIGN_PARAGRAPH_LEFT) return "left";
  if (value === WD_ALIGN_PARAGRAPH_CENTER) return "center";
  if (value === WD_ALIGN_PARAGRAPH_RIGHT) return "right";
  if (value === WD_ALIGN_PARAGRAPH_JUSTIFY) return "justify";
  if (value === WD_ALIGN_PARAGRAPH_DISTRIBUTE) return "distribute";
  return "unknown";
}

function mapNumberingAlignment(value: number | null): NumberingAlignment {
  if (value === WD_LIST_LEVEL_ALIGN_LEFT) return "left";
  if (value === WD_LIST_LEVEL_ALIGN_CENTER) return "center";
  if (value === WD_LIST_LEVEL_ALIGN_RIGHT) return "right";
  return "unknown";
}

function mapTrailingCharacter(value: number | null): NumberingSuffix | null {
  if (value === WD_TRAILING_TAB) return "tab";
  if (value === WD_TRAILING_SPACE) return "space";
  if (value === WD_TRAILING_NONE) return "nothing";
  return null;
}

function resolveFontSizeName(sizePt: number | null): string | null {
  if (sizePt === null) return null;
  for (const [pt, alias] of FONT_SIZE_PT_TO_ALIAS.entries()) {
    if (Math.abs(pt - sizePt) < 0.05) return alias;
  }
  return null;
}

function normalizeBasedOnStyle(value: string | null | "unknown"): string | null | "unknown" {
  if (value === "unknown") return "unknown";
  if (!value) return null;
  const normalized = normalizeText(value).toLowerCase();
  if (NO_STYLE_NAMES.has(normalized)) return null;
  return normalizeText(value);
}

function formatColor(value: number | string | null): string | null | "unknown" {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = normalizeText(value);
    return text || null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "unknown";
  const rgb = (numeric >>> 0) & 0xffffff;
  const r = rgb & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = (rgb >> 16) & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

function resolveLineSpacing(ruleValue: number | null, spacingValue: number | null): {
  lineSpacingRule: LineSpacingRule;
  lineSpacing: number | null;
  lineSpacingPt: number | null;
} {
  if (ruleValue === WD_LINE_SPACE_SINGLE) return { lineSpacingRule: "single", lineSpacing: 1, lineSpacingPt: null };
  if (ruleValue === WD_LINE_SPACE_1PT5) return { lineSpacingRule: "onePointFive", lineSpacing: 1.5, lineSpacingPt: null };
  if (ruleValue === WD_LINE_SPACE_DOUBLE) return { lineSpacingRule: "double", lineSpacing: 2, lineSpacingPt: null };
  if (ruleValue === WD_LINE_SPACE_MULTIPLE) {
    const multiple = spacingValue !== null && Number.isFinite(spacingValue) ? spacingValue / 12 : null;
    return {
      lineSpacingRule: "multiple",
      lineSpacing: roundNumber(multiple),
      lineSpacingPt: spacingValue === null ? null : roundNumber(spacingValue),
    };
  }
  if (ruleValue === WD_LINE_SPACE_EXACTLY) {
    return {
      lineSpacingRule: "exactly",
      lineSpacing: null,
      lineSpacingPt: spacingValue === null ? null : roundNumber(spacingValue),
    };
  }
  if (ruleValue === WD_LINE_SPACE_AT_LEAST) {
    return {
      lineSpacingRule: "atLeast",
      lineSpacing: null,
      lineSpacingPt: spacingValue === null ? null : roundNumber(spacingValue),
    };
  }
  if (spacingValue !== null && Number.isFinite(spacingValue) && spacingValue > 0) {
    return {
      lineSpacingRule: "multiple",
      lineSpacing: roundNumber(spacingValue / 12),
      lineSpacingPt: roundNumber(spacingValue),
    };
  }
  return { lineSpacingRule: "unknown", lineSpacing: null, lineSpacingPt: null };
}

function resolveDisplayFormat(listString: string | null, levelText: string | null): string | null {
  if (listString) return listString;
  if (!levelText) return null;
  const preview = levelText
    .replace(/%[0-9]+/g, "1")
    .replace(/\s+/g, " ")
    .trim();
  return preview || null;
}

function resolveTarget(raw: RawSelectionStyleSnapshot): StyleInspectTarget {
  if (raw.target === "cursorParagraph") return "cursorParagraph";
  return raw.paragraphs.length <= 1 ? "selectionSingleParagraph" : "selectionMultiParagraph";
}

function convertStyle(raw: RawParagraphStyleSnapshot): StyleBasicInfo {
  const name = normalizeOptionalText(raw.style.nameLocal) || normalizeOptionalText(raw.style.name);
  const basedOn = normalizeBasedOnStyle(raw.style.basedOn);
  return {
    name,
    type: mapStyleType(raw.style.type),
    basedOn,
  };
}

function convertFont(raw: RawParagraphStyleSnapshot): FontStyleInfo {
  const sizePt = roundNumber(raw.font.sizePt);
  const eastAsia = normalizeOptionalText(raw.font.eastAsia);
  const ascii = normalizeOptionalText(raw.font.ascii);
  const hAnsi = normalizeOptionalText(raw.font.hAnsi);
  const cs = normalizeOptionalText(raw.font.cs);
  return {
    eastAsia: eastAsia || "unknown",
    ascii: ascii || "unknown",
    hAnsi: hAnsi || ascii || "unknown",
    cs: cs || ascii || "unknown",
    sizePt,
    sizeName: resolveFontSizeName(sizePt),
    bold: toBooleanOrNull(raw.font.bold),
    italic: toBooleanOrNull(raw.font.italic),
    color: formatColor(raw.font.color),
    underline: toBooleanOrNull(raw.font.underline),
    strikeThrough: toBooleanOrNull(raw.font.strikeThrough),
    doubleStrikeThrough: toBooleanOrNull(raw.font.doubleStrikeThrough),
  };
}

function convertParagraph(raw: RawParagraphStyleSnapshot): ParagraphStyleInfo {
  const before = normalizeLengthValue(raw.paragraph.before);
  const after = normalizeLengthValue(raw.paragraph.after);
  const leftIndentValue = normalizeLengthValue(raw.paragraph.leftIndentValue);
  const rightIndentValue = normalizeLengthValue(raw.paragraph.rightIndentValue);
  const firstLineIndentValue = normalizeLengthValue(raw.paragraph.firstLineIndentValue);
  const hangingIndentValue = normalizeLengthValue(raw.paragraph.hangingIndentValue);
  const leftIndentChars = roundNumber(raw.paragraph.leftIndentChars);
  const rightIndentChars = roundNumber(raw.paragraph.rightIndentChars);
  const firstLineChars = roundNumber(raw.paragraph.firstLineIndentChars);
  const firstLineRaw = roundNumber(raw.paragraph.firstLineIndent);
  const firstLineIndent = firstLineChars === null ? (firstLineRaw === null ? null : firstLineRaw > 0 ? firstLineRaw : 0) : null;
  const hangingIndent = firstLineChars === null ? (firstLineRaw === null ? null : firstLineRaw < 0 ? roundNumber(Math.abs(firstLineRaw)) : 0) : null;
  const lineSpacing = resolveLineSpacing(roundNumber(raw.paragraph.lineSpacingRule), roundNumber(raw.paragraph.lineSpacing));
  return {
    lineSpacing: lineSpacing.lineSpacing,
    lineSpacingRule: lineSpacing.lineSpacingRule,
    lineSpacingPt: lineSpacing.lineSpacingPt,
    beforePt: roundNumber(raw.paragraph.beforePt),
    before,
    afterPt: roundNumber(raw.paragraph.afterPt),
    after,
    leftIndent: roundNumber(raw.paragraph.leftIndent),
    leftIndentValue,
    leftIndentChars,
    rightIndent: roundNumber(raw.paragraph.rightIndent),
    rightIndentValue,
    rightIndentChars,
    firstLineIndent,
    firstLineIndentValue,
    firstLineIndentChars: firstLineChars,
    hangingIndent,
    hangingIndentValue,
    alignment: mapParagraphAlignment(roundNumber(raw.paragraph.alignment)),
    snapToGrid: toBooleanOrNull(raw.paragraph.snapToGrid),
  };
}

function convertNumbering(raw: RawParagraphStyleSnapshot): NumberingStyleInfo {
  const level = roundNumber(raw.numbering.level);
  const listType = roundNumber(raw.numbering.listType);
  const listValue = roundNumber(raw.numbering.listValue);
  const levelText = normalizeOptionalText(raw.numbering.levelText);
  const displayFormat = resolveDisplayFormat(normalizeOptionalText(raw.numbering.listString), levelText);
  const leftIndent = roundNumber(raw.numbering.numberPosition);
  const textIndent = roundNumber(raw.numbering.textPosition);
  const hanging = leftIndent !== null && textIndent !== null ? roundNumber(textIndent - leftIndent) : null;
  const hasParagraphListType = Boolean(
    listType !== null && listType !== WD_LIST_NO_NUMBERING && listType !== WD_LIST_LIST_NUM_ONLY
  );
  const hasListValue = Boolean(listValue !== null && listValue > 0);
  const hasListString = Boolean(normalizeOptionalText(raw.numbering.listString));
  const hasNumbering = hasParagraphListType || hasListValue || hasListString;

  return {
    enabled: hasNumbering,
    level: hasNumbering ? level : null,
    levelText: hasNumbering ? levelText : null,
    displayFormat: hasNumbering ? displayFormat : null,
    align: hasNumbering ? mapNumberingAlignment(roundNumber(raw.numbering.align)) : "unknown",
    leftIndent: hasNumbering ? leftIndent : null,
    textIndent: hasNumbering ? textIndent : null,
    tabPosition: hasNumbering ? roundNumber(raw.numbering.tabPosition) : null,
    hanging: hasNumbering ? hanging : null,
    suffix: hasNumbering ? mapTrailingCharacter(roundNumber(raw.numbering.trailingCharacter)) : null,
    linkedStyle: hasNumbering ? normalizeOptionalText(raw.numbering.linkedStyle) : null,
  };
}

function convertParagraphSnapshot(raw: RawParagraphStyleSnapshot): ParagraphStyleDescription {
  return {
    paragraphIndex: raw.paragraphIndex,
    paragraphText: raw.paragraphText,
    style: convertStyle(raw),
    font: convertFont(raw),
    paragraph: convertParagraph(raw),
    numbering: convertNumbering(raw),
    naturalLanguage: "",
  };
}

export function convertRawSelectionStyleSnapshot(raw: RawSelectionStyleSnapshot): SelectionStyleStructuredResult {
  const paragraphs = raw.paragraphs.map((item) => convertParagraphSnapshot(item));
  const target = resolveTarget(raw);
  const first = paragraphs[0] || null;

  return {
    target,
    selectionCollapsed: raw.selectionCollapsed,
    selectionStart: raw.selectionStart,
    selectionEnd: raw.selectionEnd,
    paragraphCount: paragraphs.length,
    style: paragraphs.length === 1 ? first?.style || null : null,
    font: paragraphs.length === 1 ? first?.font || null : null,
    paragraph: paragraphs.length === 1 ? first?.paragraph || null : null,
    numbering: paragraphs.length === 1 ? first?.numbering || null : null,
    paragraphs,
  };
}
