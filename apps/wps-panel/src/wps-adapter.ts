import { buildStructuredStyleSetFromNaturalLanguage, type StructuredHeadingStyle, type StructuredStyleSet } from "./style-nl-converter";
import {
  parseGenericStylesFromNaturalLanguage,
  type GenericParagraphAlignment,
  type StructuredGenericStyleSpec,
} from "./style-nl-generic";
import { convertLengthToPoints, type LengthValue } from "./length-units";
import { convertRawSelectionStyleSnapshot } from "./style-inspector-converter";
import { compareParagraphStyles } from "./style-inspector-diff";
import { buildSelectionStyleDescription } from "./style-inspector-nl";
import { readSelectionStyleRaw } from "./style-inspector-reader";
import type { SelectionStyleDescriptionResult } from "./style-inspector-types";

async function getSelection(app: any): Promise<any> {
  const activeDocument = await app?.ActiveDocument;
  if (!activeDocument) {
    throw new Error("未找到活动文档，请先在 WPS 中打开一个 Word 文档。");
  }

  const activeWindow = await activeDocument?.ActiveWindow;
  const selection = (await activeWindow?.Selection) || (await app?.Selection);
  if (!selection) {
    throw new Error("未找到可用选区，请先激活文档窗口。");
  }

  return selection;
}

async function getSelectionRange(app: any): Promise<any> {
  const selection = await getSelection(app);
  const range = await selection?.Range;
  if (!range) {
    throw new Error("未找到选区 Range。");
  }
  return range;
}

async function getDocument(app: any): Promise<any> {
  const activeDocument = await app?.ActiveDocument;
  if (!activeDocument) {
    throw new Error("未找到活动文档，请先在 WPS 中打开一个 Word 文档。");
  }
  return activeDocument;
}

const WD_INFO_ACTIVE_END_PAGE_NUMBER = 3;
const WD_INFO_WITHIN_TABLE = 12;
const WD_COLLAPSE_START = 1;
const WD_STYLE_TYPE_PARAGRAPH = 1;
const WD_STYLE_TYPE_CHARACTER = 2;
const WD_OUTLINE_NUMBER_GALLERY = 3;
const WD_LIST_NUMBER_STYLE_ARABIC = 0;
const WD_LIST_NUMBER_STYLE_UPPERCASE_ROMAN = 1;
const WD_LIST_NUMBER_STYLE_LOWERCASE_ROMAN = 2;
const WD_LIST_NUMBER_STYLE_UPPERCASE_LETTER = 3;
const WD_LIST_NUMBER_STYLE_LOWERCASE_LETTER = 4;
const WD_LIST_NUMBER_STYLE_NUMBER_IN_CIRCLE = 18;
const WD_LIST_NUMBER_STYLE_GB_NUM2 = 27;
const WD_LIST_NUMBER_STYLE_ARABIC1 = 46;
const WD_LIST_LEVEL_ALIGN_LEFT = 0;
const WD_TRAILING_TAB = 0;
const WD_TRAILING_SPACE = 1;
const WD_TRAILING_NONE = 2;
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
const WD_FORMAT_DOCUMENT_DEFAULT = 16;
const WD_DO_NOT_SAVE_CHANGES = 0;
const QUOTE_CHARACTERS = new Set(['"', "'", "\u201C", "\u201D", "\u2018", "\u2019", "\u300C", "\u300D", "\u300E", "\u300F", "\uFF02"]);

export type StyleTargetType = "image-paragraph" | "image-caption" | "table-text" | "other-text";

export interface DocumentStyleOption {
  name: string;
}

export interface ApplyStyleByPageRangeOptions {
  pageFrom: number;
  pageTo: number;
  styleName: string;
  targetType: StyleTargetType;
}

export interface ApplyQuoteFontByPageRangeOptions {
  pageFrom: number;
  pageTo: number;
  fontName: string;
}

export interface ApplyStyleByPageRangeResult {
  matched: number;
  updated: number;
  skipped: number;
}

export interface SplitDocumentByHeadingOptions {
  pageFrom: number;
  pageTo: number;
  headingLevel: number;
  outputDirectory: string;
  onProgress?: (progress: SplitDocumentProgress) => void | Promise<void>;
}

export interface SplitDocumentByHeadingResult {
  totalSections: number;
  exported: number;
  skipped: number;
  files: string[];
}

export interface SplitDocumentProgress {
  phase: "scan" | "export" | "done";
  scanned: number;
  scanTotal: number;
  current: number;
  total: number;
  exported: number;
  skipped: number;
  currentTitle: string;
}

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\r/g, "").trim();
}

const CHINESE_HEADING_LEVEL_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseHeadingLevelFromStyleName(styleName: string): number {
  const normalized = normalizeText(styleName).toLowerCase();
  if (!normalized) return 0;

  const englishMatch = normalized.match(/^heading\s*(\d{1,2})$/);
  if (englishMatch) {
    const level = Number(englishMatch[1]);
    return Number.isFinite(level) && level >= 1 && level <= 9 ? level : 0;
  }

  const chineseDigitMatch = normalized.match(/^标题\s*(\d{1,2})$/);
  if (chineseDigitMatch) {
    const level = Number(chineseDigitMatch[1]);
    return Number.isFinite(level) && level >= 1 && level <= 9 ? level : 0;
  }

  const chineseWordMatch = normalized.match(/^([一二三四五六七八九])级标题$/);
  if (chineseWordMatch) {
    return CHINESE_HEADING_LEVEL_MAP[chineseWordMatch[1]] || 0;
  }

  return 0;
}

function normalizeOutputDirectory(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z]:[\\/]?$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}\\`;
  }
  if (trimmed === "/" || trimmed === "\\") {
    return trimmed;
  }
  return trimmed.replace(/[\\/]+$/, "");
}

function buildPathUnderDirectory(directory: string, fileName: string): string {
  const normalizedDirectory = normalizeOutputDirectory(directory);
  if (!normalizedDirectory) return fileName;
  if (/[\\/]$/.test(normalizedDirectory)) return `${normalizedDirectory}${fileName}`;
  const separator = /\\/.test(normalizedDirectory) ? "\\" : "/";
  return `${normalizedDirectory}${separator}${fileName}`;
}

function sanitizeFileNamePart(value: string): string {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  const noReserved = normalized.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "");
  return noReserved || "未命名章节";
}

async function safeRead<T>(factory: () => Promise<T> | T): Promise<T | null> {
  try {
    return await factory();
  } catch {
    return null;
  }
}

async function safeWrite(factory: () => Promise<void> | void): Promise<boolean> {
  try {
    await factory();
    return true;
  } catch {
    return false;
  }
}

export async function getDocumentIdentity(app: any): Promise<{ documentKey: string; documentLabel: string }> {
  const activeDocument = await safeRead(() => getDocument(app));
  if (!activeDocument) {
    return { documentKey: "", documentLabel: "" };
  }

  const fullName = normalizeText(await safeRead(() => activeDocument?.FullName));
  const path = normalizeText(await safeRead(() => activeDocument?.Path));
  const name = normalizeText(await safeRead(() => activeDocument?.Name));
  const documentKey = fullName || [path, name].filter(Boolean).join("\\") || name;
  const documentLabel = name || fullName || "未命名文档";
  return { documentKey, documentLabel };
}

async function getParagraphCollection(range: any): Promise<any[] | null> {
  const paragraphs = await safeRead(() => range?.Paragraphs);
  if (!paragraphs) return null;
  const count = Number((await safeRead(() => paragraphs?.Count)) || 0);
  if (!Number.isFinite(count) || count <= 0) return null;

  const items: any[] = [];
  for (let index = 1; index <= count; index += 1) {
    const item =
      (await safeRead(() => paragraphs?.Item?.(index))) ??
      (await safeRead(() => paragraphs?.item?.(index))) ??
      (await safeRead(() => paragraphs?.[index]));
    if (item) items.push(item);
  }
  return items.length ? items : null;
}

async function getRangeText(range: any): Promise<string> {
  return normalizeText(await safeRead(() => range?.Text));
}

async function getRangePageNumber(range: any): Promise<number> {
  const infoFn = (await safeRead(() => range?.Information)) ?? (await safeRead(() => range?.information));
  if (typeof infoFn === "function") {
    const result = await safeRead(() => infoFn.call(range, WD_INFO_ACTIVE_END_PAGE_NUMBER));
    const page = Number(result || 0);
    if (Number.isFinite(page) && page > 0) return page;
  }
  return 0;
}

async function getRangeStartPageNumber(range: any): Promise<number> {
  if (!range) return 0;
  const duplicated =
    (await safeRead(() => range?.Duplicate)) ??
    (await safeRead(() => range?.duplicate)) ??
    (await safeRead(() => range?.Duplicate?.())) ??
    (await safeRead(() => range?.duplicate?.()));
  if (!duplicated) return getRangePageNumber(range);
  await safeWrite(() => duplicated?.Collapse?.(WD_COLLAPSE_START));
  await safeWrite(() => duplicated?.collapse?.(WD_COLLAPSE_START));
  return getRangePageNumber(duplicated);
}

async function resolveStyleObject(activeDocument: any, styleName: string): Promise<any> {
  return (
    (await safeRead(() => activeDocument?.Styles?.Item?.(styleName))) ??
    (await safeRead(() => activeDocument?.Styles?.item?.(styleName))) ??
    (await safeRead(() => activeDocument?.Styles?.[styleName]))
  );
}

async function applyStyleToRange(range: any, styleObject: any, styleName: string): Promise<boolean> {
  if (!range) return false;
  try {
    if (styleObject !== null && styleObject !== undefined) {
      range.Style = styleObject;
    } else {
      range.Style = styleName;
    }
    return true;
  } catch {
    try {
      range.Style = styleName;
      return true;
    } catch {
      return false;
    }
  }
}

function containsQuoteCharacter(text: string): boolean {
  for (const char of text) {
    if (QUOTE_CHARACTERS.has(char)) return true;
  }
  return false;
}

async function applyFontNameToRange(range: any, fontName: string): Promise<boolean> {
  const font = (await safeRead(() => range?.Font)) ?? (await safeRead(() => range?.font));
  if (!font) return false;
  let updated = false;
  if (await setFirstWritableProperty(font, ["NameFarEast", "NameFarEastBi", "nameFarEast"], fontName)) updated = true;
  if (await setFirstWritableProperty(font, ["NameAscii", "nameAscii"], fontName)) updated = true;
  if (await setFirstWritableProperty(font, ["Name", "name"], fontName)) updated = true;
  if (await setFirstWritableProperty(font, ["NameBi", "nameBi"], fontName)) updated = true;
  return updated;
}

async function applyQuoteFontToRange(range: any, fontName: string): Promise<{ matched: number; updated: number }> {
  const characters = (await safeRead(() => range?.Characters)) ?? (await safeRead(() => range?.characters));
  const count = Number((await safeRead(() => characters?.Count)) || (await safeRead(() => characters?.count)) || 0);
  if (!characters || !Number.isFinite(count) || count <= 0) {
    return { matched: 0, updated: 0 };
  }

  let matched = 0;
  let updated = 0;
  for (let index = 1; index <= count; index += 1) {
    const characterRange =
      (await safeRead(() => characters?.Item?.(index))) ??
      (await safeRead(() => characters?.item?.(index))) ??
      (await safeRead(() => characters?.[index]));
    if (!characterRange) continue;
    const text = String((await safeRead(() => characterRange?.Text)) || "");
    if (!QUOTE_CHARACTERS.has(text)) continue;
    matched += 1;
    if (await applyFontNameToRange(characterRange, fontName)) updated += 1;
  }
  return { matched, updated };
}

export async function listAvailableStyles(app: any): Promise<DocumentStyleOption[]> {
  const activeDocument = await getDocument(app);
  const styles = await safeRead(() => activeDocument?.Styles);
  if (!styles) return [];

  const count = Number((await safeRead(() => styles?.Count)) || 0);
  const results: DocumentStyleOption[] = [];
  for (let index = 1; index <= count; index += 1) {
    const style =
      (await safeRead(() => styles?.Item?.(index))) ??
      (await safeRead(() => styles?.item?.(index))) ??
      (await safeRead(() => styles?.[index]));
    if (!style) continue;
    const name =
      normalizeText(await safeRead(() => style?.NameLocal)) ||
      normalizeText(await safeRead(() => style?.Name)) ||
      normalizeText(await safeRead(() => style?.nameLocal)) ||
      normalizeText(await safeRead(() => style?.name));
    if (!name) continue;
    results.push({ name });
  }

  return Array.from(new Map(results.map((item) => [item.name, item])).values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export interface ApplyNaturalLanguageStyleSetDetail {
  level: number;
  requestedName: string;
  appliedName: string;
  created: boolean;
  numberingBound: boolean;
}

export interface ApplyNaturalLanguageStyleSetResult {
  mode: "heading" | "named-style";
  parsed: StructuredStyleSet;
  parsedGeneric?: StructuredGenericStyleSpec[];
  details: ApplyNaturalLanguageStyleSetDetail[];
}

export async function applyNaturalLanguageStyleSet(app: any, input: string): Promise<ApplyNaturalLanguageStyleSetResult> {
  const text = String(input || "").trim();
  if (!text) {
    throw new Error("请先输入样式要求。");
  }

  const genericParsed = parseGenericStylesFromNaturalLanguage(text);
  if (genericParsed.nonHeadingSections.length) {
    return applyNamedStyleSetByNaturalLanguage(app, genericParsed.explicitSections);
  }

  const parsed = buildStructuredStyleSetFromNaturalLanguage(text);
  if (!parsed.styles.length) {
    if (genericParsed.explicitSections.length) {
      return applyNamedStyleSetByNaturalLanguage(app, genericParsed.explicitSections);
    }
    throw new Error("未识别到可应用的样式，请检查输入。");
  }

  const activeDocument = await getDocument(app);
  const listTemplate = await resolveOrCreateHeadingListTemplate(activeDocument, app);
  if (!listTemplate) {
    throw new Error("当前 WPS 环境不支持创建标题编号模板。");
  }

  const details: ApplyNaturalLanguageStyleSetDetail[] = [];
  for (const styleSpec of parsed.styles) {
    const resolved = await resolveOrCreateHeadingStyle(activeDocument, styleSpec);
    await applyHeadingStyleProperties(app, resolved.style, styleSpec);

    const levelConfigured = await configureHeadingListLevel(listTemplate, styleSpec, resolved.appliedName);
    if (!levelConfigured) {
      throw new Error(`标题样式“${resolved.appliedName}”的编号级别配置失败。`);
    }

    const numberingBound = await bindStyleToListTemplate(resolved.style, listTemplate, styleSpec.level);
    if (!numberingBound) {
      throw new Error(`标题样式“${resolved.appliedName}”绑定多级编号失败。`);
    }

    details.push({
      level: styleSpec.level,
      requestedName: styleSpec.name,
      appliedName: resolved.appliedName,
      created: resolved.created,
      numberingBound,
    });
  }

  return { mode: "heading", parsed, details };
}

async function applyNamedStyleSetByNaturalLanguage(
  app: any,
  styles: StructuredGenericStyleSpec[]
): Promise<ApplyNaturalLanguageStyleSetResult> {
  const activeDocument = await getDocument(app);
  let listTemplate: any = null;
  const details: ApplyNaturalLanguageStyleSetDetail[] = [];

  for (const styleSpec of styles) {
    const resolved = await resolveOrCreateNamedStyle(activeDocument, styleSpec);
    await applyNamedStyleProperties(app, resolved.style, styleSpec);

    let numberingBound = false;
    if (styleSpec.styleType === "paragraph" && styleSpec.numbering.enabled === false) {
      await clearStyleNumberingBinding(resolved.style);
    }
    if (styleSpec.styleType === "paragraph" && styleSpec.numbering.enabled === true && styleSpec.numbering.level && styleSpec.numbering.level > 0) {
      listTemplate = listTemplate || (await resolveOrCreateHeadingListTemplate(activeDocument, app));
      if (listTemplate) {
        const headingLike = buildHeadingLikeStyleSpecForNumbering(styleSpec, resolved.appliedName);
        const levelConfigured = await configureHeadingListLevel(listTemplate, headingLike, resolved.appliedName);
        if (levelConfigured) {
          numberingBound = await bindStyleToListTemplate(resolved.style, listTemplate, headingLike.level);
        }
      }
    }

    details.push({
      level: styleSpec.numbering.level || 0,
      requestedName: styleSpec.name,
      appliedName: resolved.appliedName,
      created: resolved.created,
      numberingBound,
    });
  }

  return {
    mode: "named-style",
    parsed: { styles: [] },
    parsedGeneric: styles,
    details,
  };
}

function mapGenericStyleTypeToWd(styleType: StructuredGenericStyleSpec["styleType"]): number {
  if (styleType === "character") return WD_STYLE_TYPE_CHARACTER;
  return WD_STYLE_TYPE_PARAGRAPH;
}

async function resolveOrCreateNamedStyle(
  activeDocument: any,
  styleSpec: StructuredGenericStyleSpec
): Promise<{ style: any; created: boolean; appliedName: string }> {
  const targetName = normalizeText(styleSpec.name);
  if (!targetName) {
    throw new Error("样式名称不能为空。");
  }
  const existing = await resolveStyleObject(activeDocument, targetName);
  if (existing) {
    const appliedName = (await resolveStyleName(existing)) || targetName;
    return { style: existing, created: false, appliedName };
  }

  const stylesRoot = await safeRead(() => activeDocument?.Styles);
  if (!stylesRoot) {
    throw new Error("当前文档不支持样式集合访问。");
  }

  const styleType = mapGenericStyleTypeToWd(styleSpec.styleType);
  const createdStyle =
    (await safeRead(() => stylesRoot?.Add?.(targetName, styleType))) ??
    (await safeRead(() => stylesRoot?.add?.(targetName, styleType))) ??
    (await safeRead(() => stylesRoot?.Add?.(targetName))) ??
    (await safeRead(() => stylesRoot?.add?.(targetName)));

  if (!createdStyle) {
    throw new Error(`样式“${targetName}”创建失败。`);
  }

  const appliedName = (await resolveStyleName(createdStyle)) || targetName;
  return { style: createdStyle, created: true, appliedName };
}

async function setPropertyWhenDefined(target: any, propertyNames: string[], value: unknown): Promise<void> {
  if (value === null || value === undefined) return;
  await setFirstWritableProperty(target, propertyNames, value);
}

function parseHexColorToWdValue(hexColor: string): number | null {
  const normalized = normalizeText(hexColor);
  const match = /^#?([0-9a-fA-F]{6})$/.exec(normalized);
  if (!match) return null;
  const raw = match[1];
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if (![r, g, b].every((item) => Number.isFinite(item))) return null;
  return (b << 16) + (g << 8) + r;
}

function mapGenericAlignment(value: GenericParagraphAlignment): number | null {
  if (value === "left") return WD_ALIGN_PARAGRAPH_LEFT;
  if (value === "center") return WD_ALIGN_PARAGRAPH_CENTER;
  if (value === "right") return WD_ALIGN_PARAGRAPH_RIGHT;
  if (value === "justify") return WD_ALIGN_PARAGRAPH_JUSTIFY;
  if (value === "distribute") return WD_ALIGN_PARAGRAPH_DISTRIBUTE;
  return null;
}

function fallbackFirstLineIndentPointsFromChars(chars: number, fontSizePt: number | null): number {
  const size = Number.isFinite(fontSizePt || NaN) && (fontSizePt || 0) > 0 ? (fontSizePt as number) : 12;
  return chars * size;
}

function fallbackIndentPointsFromChars(chars: number, fontSizePt: number | null): number {
  const size = Number.isFinite(fontSizePt || NaN) && (fontSizePt || 0) > 0 ? (fontSizePt as number) : 12;
  return chars * size;
}

function resolvePoints(primary: LengthValue | null, fallbackPt: number | null): number | null {
  if (primary && primary.unit !== "char") {
    const converted = convertLengthToPoints(primary);
    if (Number.isFinite(converted || NaN)) return converted as number;
  }
  return Number.isFinite(fallbackPt || NaN) ? (fallbackPt as number) : null;
}

async function applyGenericLineSpacing(app: any, paragraphFormat: any, styleSpec: StructuredGenericStyleSpec): Promise<void> {
  const rule = styleSpec.paragraph.lineSpacingRule;
  if (rule === "single") {
    await setFirstWritableProperty(paragraphFormat, ["LineSpacingRule", "lineSpacingRule"], WD_LINE_SPACE_SINGLE);
    return;
  }
  if (rule === "onePointFive") {
    await setFirstWritableProperty(paragraphFormat, ["LineSpacingRule", "lineSpacingRule"], WD_LINE_SPACE_1PT5);
    return;
  }
  if (rule === "double") {
    await setFirstWritableProperty(paragraphFormat, ["LineSpacingRule", "lineSpacingRule"], WD_LINE_SPACE_DOUBLE);
    return;
  }
  if (rule === "multiple" && Number.isFinite(styleSpec.paragraph.lineSpacing || NaN) && (styleSpec.paragraph.lineSpacing || 0) > 0) {
    await applyLineSpacing(app, paragraphFormat, styleSpec.paragraph.lineSpacing as number);
    return;
  }
  if (rule === "exactly" && Number.isFinite(styleSpec.paragraph.lineSpacingPt || NaN)) {
    await setFirstWritableProperty(paragraphFormat, ["LineSpacingRule", "lineSpacingRule"], WD_LINE_SPACE_EXACTLY);
    await setFirstWritableProperty(paragraphFormat, ["LineSpacing", "lineSpacing"], styleSpec.paragraph.lineSpacingPt as number);
    return;
  }
  if (rule === "atLeast" && Number.isFinite(styleSpec.paragraph.lineSpacingPt || NaN)) {
    await setFirstWritableProperty(paragraphFormat, ["LineSpacingRule", "lineSpacingRule"], WD_LINE_SPACE_AT_LEAST);
    await setFirstWritableProperty(paragraphFormat, ["LineSpacing", "lineSpacing"], styleSpec.paragraph.lineSpacingPt as number);
  }
}

async function applyNamedStyleProperties(app: any, styleObject: any, styleSpec: StructuredGenericStyleSpec): Promise<void> {
  if (!styleObject) {
    throw new Error(`样式“${styleSpec.name}”对象无效。`);
  }

  if (styleSpec.basedOn === null) {
    await clearStyleBaseStyle(styleObject);
  } else if (styleSpec.basedOn && styleSpec.basedOn !== "unknown") {
    await safeWrite(() => {
      styleObject.BaseStyle = styleSpec.basedOn;
    });
  }

  const font = (await safeRead(() => styleObject?.Font)) ?? (await safeRead(() => styleObject?.font));
  if (font) {
    await setPropertyWhenDefined(font, ["NameFarEast", "NameFarEastBi", "nameFarEast"], styleSpec.font.eastAsia);
    await setPropertyWhenDefined(font, ["NameAscii", "nameAscii"], styleSpec.font.ascii);
    await setPropertyWhenDefined(font, ["Name", "name"], styleSpec.font.hAnsi || styleSpec.font.ascii);
    await setPropertyWhenDefined(font, ["NameBi", "nameBi"], styleSpec.font.cs);
    await setPropertyWhenDefined(font, ["Size", "size"], styleSpec.font.sizePt);
    if (styleSpec.font.bold !== null) {
      await setFirstWritableProperty(font, ["Bold", "bold"], styleSpec.font.bold ? 1 : 0);
    }
    if (styleSpec.font.italic !== null) {
      await setFirstWritableProperty(font, ["Italic", "italic"], styleSpec.font.italic ? 1 : 0);
    }
    if (styleSpec.font.underline !== null) {
      await setFirstWritableProperty(font, ["Underline", "underline"], styleSpec.font.underline ? 1 : 0);
    }
    if (styleSpec.font.strikeThrough !== null) {
      await setFirstWritableProperty(font, ["StrikeThrough", "strikeThrough"], styleSpec.font.strikeThrough ? 1 : 0);
    }
    if (styleSpec.font.doubleStrikeThrough !== null) {
      await setFirstWritableProperty(font, ["DoubleStrikeThrough", "doubleStrikeThrough"], styleSpec.font.doubleStrikeThrough ? 1 : 0);
    }
    const wdColor = styleSpec.font.color ? parseHexColorToWdValue(styleSpec.font.color) : null;
    if (wdColor !== null) {
      await setFirstWritableProperty(font, ["Color", "color"], wdColor);
      const textColor = (await safeRead(() => font?.TextColor)) ?? (await safeRead(() => font?.textColor));
      if (textColor) {
        await setFirstWritableProperty(textColor, ["RGB", "rgb"], wdColor);
      }
    }
  }

  if (styleSpec.styleType !== "paragraph") return;

  const paragraphFormat =
    (await safeRead(() => styleObject?.ParagraphFormat)) ??
    (await safeRead(() => styleObject?.paragraphFormat)) ??
    (await safeRead(() => styleObject?.Paragraphs?.Item?.(1)?.Range?.ParagraphFormat));
  if (!paragraphFormat) return;

  await applyGenericLineSpacing(app, paragraphFormat, styleSpec);
  await setPropertyWhenDefined(
    paragraphFormat,
    ["SpaceBefore", "spaceBefore"],
    resolvePoints(styleSpec.paragraph.before, styleSpec.paragraph.beforePt)
  );
  await setPropertyWhenDefined(
    paragraphFormat,
    ["SpaceAfter", "spaceAfter"],
    resolvePoints(styleSpec.paragraph.after, styleSpec.paragraph.afterPt)
  );

  const leftLength =
    styleSpec.paragraph.leftIndentValue ||
    (styleSpec.paragraph.leftIndentChars !== null
      ? ({ value: styleSpec.paragraph.leftIndentChars, unit: "char" } as LengthValue)
      : null);
  if (leftLength?.unit === "char") {
    const writtenLeftChars = await setFirstWritableProperty(
      paragraphFormat,
      ["CharacterUnitLeftIndent", "characterUnitLeftIndent"],
      leftLength.value
    );
    if (!writtenLeftChars) {
      const fallbackPt = fallbackIndentPointsFromChars(leftLength.value, styleSpec.font.sizePt);
      await setPropertyWhenDefined(paragraphFormat, ["LeftIndent", "leftIndent"], fallbackPt);
    }
  } else {
    await setPropertyWhenDefined(
      paragraphFormat,
      ["LeftIndent", "leftIndent"],
      resolvePoints(leftLength, styleSpec.paragraph.leftIndent)
    );
  }

  const rightLength =
    styleSpec.paragraph.rightIndentValue ||
    (styleSpec.paragraph.rightIndentChars !== null
      ? ({ value: styleSpec.paragraph.rightIndentChars, unit: "char" } as LengthValue)
      : null);
  if (rightLength?.unit === "char") {
    const writtenRightChars = await setFirstWritableProperty(
      paragraphFormat,
      ["CharacterUnitRightIndent", "characterUnitRightIndent"],
      rightLength.value
    );
    if (!writtenRightChars) {
      const fallbackPt = fallbackIndentPointsFromChars(rightLength.value, styleSpec.font.sizePt);
      await setPropertyWhenDefined(paragraphFormat, ["RightIndent", "rightIndent"], fallbackPt);
    }
  } else {
    await setPropertyWhenDefined(
      paragraphFormat,
      ["RightIndent", "rightIndent"],
      resolvePoints(rightLength, styleSpec.paragraph.rightIndent)
    );
  }

  const firstLineLength =
    styleSpec.paragraph.firstLineIndentValue ||
    (styleSpec.paragraph.firstLineIndentChars !== null
      ? ({ value: styleSpec.paragraph.firstLineIndentChars, unit: "char" } as LengthValue)
      : null);
  if (firstLineLength?.unit === "char" || styleSpec.paragraph.firstLineIndentChars !== null) {
    const chars = firstLineLength?.unit === "char" ? firstLineLength.value : (styleSpec.paragraph.firstLineIndentChars as number);
    const writtenCharIndent = await setFirstWritableProperty(
      paragraphFormat,
      ["CharacterUnitFirstLineIndent", "characterUnitFirstLineIndent"],
      chars
    );
    if (!writtenCharIndent) {
      const fallbackPt = fallbackFirstLineIndentPointsFromChars(chars, styleSpec.font.sizePt);
      await setFirstWritableProperty(paragraphFormat, ["FirstLineIndent", "firstLineIndent"], fallbackPt);
    }
  } else {
    const hangingPt = resolvePoints(styleSpec.paragraph.hangingIndentValue, null);
    const firstPt = resolvePoints(firstLineLength, styleSpec.paragraph.firstLineIndent);
    const resolvedFirstIndent = hangingPt !== null ? -Math.abs(hangingPt) : firstPt;
    await setPropertyWhenDefined(paragraphFormat, ["FirstLineIndent", "firstLineIndent"], resolvedFirstIndent);
  }
  const alignment = mapGenericAlignment(styleSpec.paragraph.alignment);
  if (alignment !== null) {
    await setFirstWritableProperty(paragraphFormat, ["Alignment", "alignment"], alignment);
  }
  if (styleSpec.paragraph.snapToGrid !== null) {
    await setFirstWritableProperty(paragraphFormat, ["SnapToGrid", "snapToGrid"], styleSpec.paragraph.snapToGrid ? 1 : 0);
    if (styleSpec.paragraph.snapToGrid) {
      await setFirstWritableProperty(paragraphFormat, ["DisableLineHeightGrid", "disableLineHeightGrid"], 0);
    }
  }
}

function buildHeadingLikeStyleSpecForNumbering(styleSpec: StructuredGenericStyleSpec, appliedName: string): StructuredHeadingStyle {
  const rawLevel = styleSpec.numbering.level || 1;
  const level = Math.max(1, Math.min(4, rawLevel));
  return {
    name: appliedName,
    level: level as 1 | 2 | 3 | 4,
    basedOn: null,
    font: {
      eastAsia: styleSpec.font.eastAsia || "宋体",
      ascii: styleSpec.font.ascii || "Times New Roman",
      hAnsi: styleSpec.font.hAnsi || styleSpec.font.ascii || "Times New Roman",
      cs: styleSpec.font.cs || styleSpec.font.ascii || "Times New Roman",
      sizePt: styleSpec.font.sizePt || 12,
      bold: styleSpec.font.bold === true,
    },
    paragraph: {
      lineSpacing: styleSpec.paragraph.lineSpacing || 1.5,
      beforePt: styleSpec.paragraph.beforePt || 0,
      afterPt: styleSpec.paragraph.afterPt || 0,
      leftIndent: styleSpec.paragraph.leftIndent || 0,
      rightIndent: styleSpec.paragraph.rightIndent || 0,
      firstLineIndent: styleSpec.paragraph.firstLineIndent || 0,
      snapToGrid: styleSpec.paragraph.snapToGrid === true,
    },
    numbering: {
      format: styleSpec.numbering.format || "decimal",
      levelText:
        styleSpec.numbering.levelText ||
        Array.from({ length: level }, (_, idx) => `%${idx + 1}`).join("."),
      align: "left",
      leftIndent: 0,
      textIndent: 0,
      hanging: 0,
      suffix: styleSpec.numbering.suffix || "space",
    },
  };
}

async function clearStyleNumberingBinding(styleObject: any): Promise<boolean> {
  if (!styleObject) return false;
  let success = false;
  const attempts = [
    () => styleObject?.LinkToListTemplate?.(null),
    () => styleObject?.linkToListTemplate?.(null),
    () => styleObject?.LinkToListTemplate?.(null, 0),
    () => styleObject?.linkToListTemplate?.(null, 0),
    () => styleObject?.LinkToListTemplate?.("", 0),
    () => styleObject?.linkToListTemplate?.("", 0),
  ];
  for (const attempt of attempts) {
    if (await safeWrite(() => attempt())) {
      success = true;
    }
  }
  return success;
}

async function resolveOrCreateHeadingStyle(
  activeDocument: any,
  styleSpec: StructuredHeadingStyle
): Promise<{ style: any; created: boolean; appliedName: string }> {
  const candidates = uniqueStyleNames(styleSpec.level, styleSpec.name);
  for (const name of candidates) {
    const existing = await resolveStyleObject(activeDocument, name);
    if (!existing) continue;
    const appliedName = (await resolveStyleName(existing)) || name;
    return { style: existing, created: false, appliedName };
  }

  const stylesRoot = await safeRead(() => activeDocument?.Styles);
  if (!stylesRoot) {
    throw new Error("当前文档不支持样式集合访问。");
  }

  const createName = candidates[0] || styleSpec.name || defaultHeadingName(styleSpec.level);
  const createdStyle =
    (await safeRead(() => stylesRoot?.Add?.(createName, WD_STYLE_TYPE_PARAGRAPH))) ??
    (await safeRead(() => stylesRoot?.add?.(createName, WD_STYLE_TYPE_PARAGRAPH))) ??
    (await safeRead(() => stylesRoot?.Add?.(createName))) ??
    (await safeRead(() => stylesRoot?.add?.(createName)));

  if (!createdStyle) {
    throw new Error(`样式“${createName}”创建失败。`);
  }

  const appliedName = (await resolveStyleName(createdStyle)) || createName;
  return { style: createdStyle, created: true, appliedName };
}

async function applyHeadingStyleProperties(app: any, styleObject: any, styleSpec: StructuredHeadingStyle): Promise<void> {
  if (!styleObject) {
    throw new Error(`样式“${styleSpec.name}”对象无效。`);
  }

  if (styleSpec.basedOn === null) {
    await clearStyleBaseStyle(styleObject);
  } else if (styleSpec.basedOn) {
    await safeWrite(() => {
      styleObject.BaseStyle = styleSpec.basedOn;
    });
  }

  const font = (await safeRead(() => styleObject?.Font)) ?? (await safeRead(() => styleObject?.font));
  if (font) {
    await setFirstWritableProperty(font, ["NameAscii", "nameAscii"], styleSpec.font.ascii);
    await setFirstWritableProperty(font, ["Name", "name"], styleSpec.font.ascii);
    await setFirstWritableProperty(font, ["NameFarEast", "NameFarEastBi", "nameFarEast"], styleSpec.font.eastAsia);
    await setFirstWritableProperty(font, ["NameBi", "nameBi"], styleSpec.font.cs);
    await setFirstWritableProperty(font, ["Size", "size"], styleSpec.font.sizePt);
    await setFirstWritableProperty(font, ["Bold", "bold"], styleSpec.font.bold ? 1 : 0);
  }

  const paragraphFormat =
    (await safeRead(() => styleObject?.ParagraphFormat)) ??
    (await safeRead(() => styleObject?.paragraphFormat)) ??
    (await safeRead(() => styleObject?.Paragraphs?.Item?.(1)?.Range?.ParagraphFormat));

  if (!paragraphFormat) {
    return;
  }

  await applyLineSpacing(app, paragraphFormat, styleSpec.paragraph.lineSpacing);
  await setFirstWritableProperty(paragraphFormat, ["SpaceBefore", "spaceBefore"], styleSpec.paragraph.beforePt);
  await setFirstWritableProperty(paragraphFormat, ["SpaceAfter", "spaceAfter"], styleSpec.paragraph.afterPt);
  await setFirstWritableProperty(paragraphFormat, ["LeftIndent", "leftIndent"], styleSpec.paragraph.leftIndent);
  await setFirstWritableProperty(paragraphFormat, ["RightIndent", "rightIndent"], styleSpec.paragraph.rightIndent);
  await setFirstWritableProperty(paragraphFormat, ["FirstLineIndent", "firstLineIndent"], styleSpec.paragraph.firstLineIndent);
  await setFirstWritableProperty(paragraphFormat, ["OutlineLevel", "outlineLevel"], styleSpec.level);
  await setFirstWritableProperty(paragraphFormat, ["SnapToGrid", "snapToGrid"], styleSpec.paragraph.snapToGrid ? 1 : 0);
  if (styleSpec.paragraph.snapToGrid) {
    await setFirstWritableProperty(paragraphFormat, ["DisableLineHeightGrid", "disableLineHeightGrid"], 0);
  }
}

async function applyLineSpacing(app: any, paragraphFormat: any, lineSpacingMultiplier: number): Promise<void> {
  if (!Number.isFinite(lineSpacingMultiplier) || lineSpacingMultiplier <= 0) return;
  if (Math.abs(lineSpacingMultiplier - 1.5) < 0.001) {
    await setFirstWritableProperty(paragraphFormat, ["LineSpacingRule", "lineSpacingRule"], WD_LINE_SPACE_1PT5);
    return;
  }

  await setFirstWritableProperty(paragraphFormat, ["LineSpacingRule", "lineSpacingRule"], WD_LINE_SPACE_MULTIPLE);
  let lineSpacingPoints = lineSpacingMultiplier * 12;
  const linesToPoints =
    (await safeRead(() => app?.LinesToPoints)) ??
    (await safeRead(() => app?.linesToPoints)) ??
    (await safeRead(() => app?.Application?.LinesToPoints));
  if (typeof linesToPoints === "function") {
    const converted = Number(await safeRead(() => linesToPoints.call(app, lineSpacingMultiplier)));
    if (Number.isFinite(converted) && converted > 0) {
      lineSpacingPoints = converted;
    }
  }
  await setFirstWritableProperty(paragraphFormat, ["LineSpacing", "lineSpacing"], lineSpacingPoints);
}

async function clearStyleBaseStyle(styleObject: any): Promise<void> {
  const values = [null, "", "No Style", "无样式"];
  for (const value of values) {
    const written = await safeWrite(() => {
      styleObject.BaseStyle = value;
    });
    if (written) return;
  }
}

async function setFirstWritableProperty(target: any, propertyNames: string[], value: unknown): Promise<boolean> {
  for (const name of propertyNames) {
    const success = await safeWrite(() => {
      target[name] = value;
    });
    if (success) return true;
  }
  return false;
}

async function resolveOrCreateHeadingListTemplate(activeDocument: any, app: any): Promise<any> {
  const listTemplates = await safeRead(() => activeDocument?.ListTemplates);
  const templateName = "CodexHeadingMultilevel";
  if (listTemplates) {
    const count = Number((await safeRead(() => listTemplates?.Count)) || 0);
    for (let index = 1; index <= count; index += 1) {
      const item =
        (await safeRead(() => listTemplates?.Item?.(index))) ??
        (await safeRead(() => listTemplates?.item?.(index))) ??
        (await safeRead(() => listTemplates?.[index]));
      const name = normalizeText(await safeRead(() => item?.Name));
      if (name === templateName) return item;
    }
  }

  const createdFromDocument =
    (await safeRead(() => listTemplates?.Add?.(true, templateName))) ??
    (await safeRead(() => listTemplates?.add?.(true, templateName))) ??
    (await safeRead(() => listTemplates?.Add?.(templateName, true))) ??
    (await safeRead(() => listTemplates?.add?.(templateName, true))) ??
    (await safeRead(() => listTemplates?.Add?.(true))) ??
    (await safeRead(() => listTemplates?.add?.(true)));
  if (createdFromDocument) return createdFromDocument;

  const galleries =
    (await safeRead(() => app?.ListGalleries)) ??
    (await safeRead(() => app?.listGalleries)) ??
    (await safeRead(() => activeDocument?.Application?.ListGalleries));
  const outlineGallery =
    (await safeRead(() => galleries?.Item?.(WD_OUTLINE_NUMBER_GALLERY))) ??
    (await safeRead(() => galleries?.item?.(WD_OUTLINE_NUMBER_GALLERY))) ??
    (await safeRead(() => galleries?.[WD_OUTLINE_NUMBER_GALLERY]));
  return (
    (await safeRead(() => outlineGallery?.ListTemplates?.Item?.(1))) ??
    (await safeRead(() => outlineGallery?.ListTemplates?.item?.(1))) ??
    (await safeRead(() => outlineGallery?.ListTemplates?.[1])) ??
    null
  );
}

async function configureHeadingListLevel(listTemplate: any, styleSpec: StructuredHeadingStyle, styleName: string): Promise<boolean> {
  const listLevels = (await safeRead(() => listTemplate?.ListLevels)) ?? (await safeRead(() => listTemplate?.listLevels));
  if (!listLevels) return false;

  const listLevel =
    (await safeRead(() => listLevels?.Item?.(styleSpec.level))) ??
    (await safeRead(() => listLevels?.item?.(styleSpec.level))) ??
    (await safeRead(() => listLevels?.[styleSpec.level]));
  if (!listLevel) return false;

  const textPosition = Number.isFinite(styleSpec.numbering.textIndent)
    ? styleSpec.numbering.textIndent
    : styleSpec.numbering.leftIndent + styleSpec.numbering.hanging;

  await setFirstWritableProperty(listLevel, ["NumberStyle", "numberStyle"], mapListNumberStyle(styleSpec.numbering.format));
  await setFirstWritableProperty(listLevel, ["NumberFormat", "numberFormat"], styleSpec.numbering.levelText);
  await setFirstWritableProperty(listLevel, ["Alignment", "alignment"], WD_LIST_LEVEL_ALIGN_LEFT);
  await setFirstWritableProperty(listLevel, ["NumberPosition", "numberPosition"], styleSpec.numbering.leftIndent);
  await setFirstWritableProperty(listLevel, ["TextPosition", "textPosition"], textPosition);
  await setFirstWritableProperty(listLevel, ["TabPosition", "tabPosition"], textPosition);
  await setFirstWritableProperty(listLevel, ["StartAt", "startAt"], 1);
  await setFirstWritableProperty(listLevel, ["ResetOnHigher", "resetOnHigher"], styleSpec.level > 1 ? styleSpec.level - 1 : 0);
  await setFirstWritableProperty(listLevel, ["TrailingCharacter", "trailingCharacter"], mapTrailingCharacter(styleSpec.numbering.suffix));
  await setFirstWritableProperty(listLevel, ["LinkedStyle", "linkedStyle"], styleName);
  return true;
}

function mapListNumberStyle(value: StructuredHeadingStyle["numbering"]["format"]): number {
  if (value === "numberInCircle") return WD_LIST_NUMBER_STYLE_NUMBER_IN_CIRCLE;
  if (value === "parenthesizedNumber") return WD_LIST_NUMBER_STYLE_GB_NUM2;
  if (value === "parenthesizedArabic") return WD_LIST_NUMBER_STYLE_ARABIC1;
  if (value === "lowerLetter") return WD_LIST_NUMBER_STYLE_LOWERCASE_LETTER;
  if (value === "upperLetter") return WD_LIST_NUMBER_STYLE_UPPERCASE_LETTER;
  if (value === "lowerRoman") return WD_LIST_NUMBER_STYLE_LOWERCASE_ROMAN;
  if (value === "upperRoman") return WD_LIST_NUMBER_STYLE_UPPERCASE_ROMAN;
  return WD_LIST_NUMBER_STYLE_ARABIC;
}

async function bindStyleToListTemplate(styleObject: any, listTemplate: any, level: number): Promise<boolean> {
  const bindAttempts = [
    () => styleObject?.LinkToListTemplate?.(listTemplate, level),
    () => styleObject?.linkToListTemplate?.(listTemplate, level),
    () => styleObject?.LinkToListTemplate?.(listTemplate, level, true),
    () => styleObject?.linkToListTemplate?.(listTemplate, level, true),
  ];
  for (const attempt of bindAttempts) {
    if (await safeWrite(() => attempt())) return true;
  }
  return false;
}

function mapTrailingCharacter(value: string): number {
  if (value === "tab") return WD_TRAILING_TAB;
  if (value === "nothing") return WD_TRAILING_NONE;
  return WD_TRAILING_SPACE;
}

function uniqueStyleNames(level: number, preferredName: string): string[] {
  const values = [preferredName, ...headingStyleCandidates(level)];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter(Boolean)
    )
  );
}

function headingStyleCandidates(level: number): string[] {
  const canonical = defaultHeadingName(level);
  return [canonical, `Heading ${level}`, `标题 ${level}`, `标题${level}`];
}

function defaultHeadingName(level: number): string {
  if (level === 1) return "一级标题";
  if (level === 2) return "二级标题";
  if (level === 3) return "三级标题";
  if (level === 4) return "四级标题";
  return `标题 ${level}`;
}

export async function applyStyleByPageRange(
  app: any,
  options: ApplyStyleByPageRangeOptions
): Promise<ApplyStyleByPageRangeResult> {
  const activeDocument = await getDocument(app);
  const styleObject = await resolveStyleObject(activeDocument, options.styleName);
  if (!styleObject && !options.styleName.trim()) {
    throw new Error("样式名称不能为空。");
  }

  if (options.targetType === "image-paragraph") {
    return applyStyleToImageParagraphs(activeDocument, styleObject, options.styleName, options.pageFrom, options.pageTo);
  }
  if (options.targetType === "image-caption") {
    return applyStyleToImageCaptions(activeDocument, styleObject, options.styleName, options.pageFrom, options.pageTo);
  }
  if (options.targetType === "table-text") {
    return applyStyleToTableText(activeDocument, styleObject, options.styleName, options.pageFrom, options.pageTo);
  }
  return applyStyleToOtherText(activeDocument, styleObject, options.styleName, options.pageFrom, options.pageTo);
}

export async function applyQuoteFontByPageRange(
  app: any,
  options: ApplyQuoteFontByPageRangeOptions
): Promise<ApplyStyleByPageRangeResult> {
  const activeDocument = await getDocument(app);
  const fontName = normalizeText(options.fontName);
  if (!fontName) {
    throw new Error("引号字体名称不能为空。");
  }

  const paragraphsRoot = await safeRead(() => activeDocument?.Paragraphs);
  const count = Number((await safeRead(() => paragraphsRoot?.Count)) || 0);
  if (!paragraphsRoot || !Number.isFinite(count) || count <= 0) {
    return { matched: 0, updated: 0, skipped: 0 };
  }

  let matched = 0;
  let updated = 0;
  for (let index = 1; index <= count; index += 1) {
    const paragraph =
      (await safeRead(() => paragraphsRoot?.Item?.(index))) ??
      (await safeRead(() => paragraphsRoot?.item?.(index))) ??
      (await safeRead(() => paragraphsRoot?.[index]));
    if (!paragraph) continue;

    const paragraphRange = await safeRead(() => paragraph?.Range);
    if (!paragraphRange) continue;
    const page = await getRangePageNumber(paragraphRange);
    if (page < options.pageFrom || page > options.pageTo) continue;

    const text = await getRangeText(paragraphRange);
    if (!text || !containsQuoteCharacter(text)) continue;

    const result = await applyQuoteFontToRange(paragraphRange, fontName);
    matched += result.matched;
    updated += result.updated;
  }
  return { matched, updated, skipped: matched - updated };
}

async function applyStyleToImageParagraphs(
  activeDocument: any,
  styleObject: any,
  styleName: string,
  pageFrom: number,
  pageTo: number
): Promise<ApplyStyleByPageRangeResult> {
  const seenParagraphs = new Set<string>();
  let matched = 0;
  let updated = 0;

  const inlineShapes = await collectIndexedItems(activeDocument?.InlineShapes);
  for (const shape of inlineShapes) {
    const range = (await safeRead(() => shape?.Range)) ?? (await safeRead(() => shape?.range));
    const page = await getRangePageNumber(range);
    if (page < pageFrom || page > pageTo) continue;
    const paragraph = await firstParagraphFromRange(range);
    const paragraphRange = paragraph ? await safeRead(() => paragraph?.Range) : null;
    const start = Number((await safeRead(() => paragraphRange?.Start)) || 0);
    if (!paragraphRange || !start || seenParagraphs.has(String(start))) continue;
    seenParagraphs.add(String(start));
    matched += 1;
    if (await applyStyleToRange(paragraphRange, styleObject, styleName)) updated += 1;
  }

  const shapes = await collectIndexedItems(activeDocument?.Shapes);
  for (const shape of shapes) {
    const anchor =
      (await safeRead(() => shape?.Anchor)) ??
      (await safeRead(() => shape?.anchor)) ??
      (await safeRead(() => shape?.TextFrame?.TextRange));
    const page = await getRangePageNumber(anchor);
    if (page < pageFrom || page > pageTo) continue;
    const paragraph = await firstParagraphFromRange(anchor);
    const paragraphRange = paragraph ? await safeRead(() => paragraph?.Range) : null;
    const start = Number((await safeRead(() => paragraphRange?.Start)) || 0);
    if (!paragraphRange || !start || seenParagraphs.has(String(start))) continue;
    seenParagraphs.add(String(start));
    matched += 1;
    if (await applyStyleToRange(paragraphRange, styleObject, styleName)) updated += 1;
  }

  return { matched, updated, skipped: matched - updated };
}

async function applyStyleToTableText(
  activeDocument: any,
  styleObject: any,
  styleName: string,
  pageFrom: number,
  pageTo: number
): Promise<ApplyStyleByPageRangeResult> {
  let matched = 0;
  let updated = 0;
  let sawInRangeTable = false;
  const tables = await collectIndexedItems(activeDocument?.Tables);

  for (const table of tables) {
    const tableRange = (await safeRead(() => table?.Range)) ?? (await safeRead(() => table?.range));
    if (!tableRange) continue;

    const tableStartPage = await getRangeStartPageNumber(tableRange);
    const tableEndPage = await getRangePageNumber(tableRange);
    const hasTablePageInfo = tableStartPage > 0 && tableEndPage > 0;
    if (hasTablePageInfo && tableEndPage < pageFrom) continue;
    if (hasTablePageInfo && tableStartPage > pageTo) {
      if (sawInRangeTable) break;
      continue;
    }
    if (hasTablePageInfo) sawInRangeTable = true;

    const tableFullyInRange = hasTablePageInfo && tableStartPage >= pageFrom && tableEndPage <= pageTo;
    const cells = await collectIndexedItems((await safeRead(() => tableRange?.Cells)) ?? (await safeRead(() => tableRange?.cells)));
    for (const cell of cells) {
      const cellRange = (await safeRead(() => cell?.Range)) ?? (await safeRead(() => cell?.range));
      if (!tableFullyInRange) {
        const page = await getRangePageNumber(cellRange);
        if (page < pageFrom || page > pageTo) continue;
      }
      const text = normalizeText(await safeRead(() => cellRange?.Text));
      if (!text) continue;
      matched += 1;
      if (await applyStyleToRange(cellRange, styleObject, styleName)) updated += 1;
    }
  }

  return { matched, updated, skipped: matched - updated };
}

async function applyStyleToImageCaptions(
  activeDocument: any,
  styleObject: any,
  styleName: string,
  pageFrom: number,
  pageTo: number
): Promise<ApplyStyleByPageRangeResult> {
  const imageParagraphStarts = await collectImageParagraphStarts(activeDocument, pageFrom, pageTo);
  if (!imageParagraphStarts.size) {
    return { matched: 0, updated: 0, skipped: 0 };
  }

  const paragraphsRoot = await safeRead(() => activeDocument?.Paragraphs);
  const count = Number((await safeRead(() => paragraphsRoot?.Count)) || 0);
  if (!paragraphsRoot || !Number.isFinite(count) || count <= 0) {
    return { matched: 0, updated: 0, skipped: 0 };
  }

  const appliedCaptionStarts = new Set<number>();
  let matched = 0;
  let updated = 0;

  for (let index = 1; index < count; index += 1) {
    const paragraph =
      (await safeRead(() => paragraphsRoot?.Item?.(index))) ??
      (await safeRead(() => paragraphsRoot?.item?.(index))) ??
      (await safeRead(() => paragraphsRoot?.[index]));
    if (!paragraph) continue;

    const paragraphRange = await safeRead(() => paragraph?.Range);
    const start = Number((await safeRead(() => paragraphRange?.Start)) || 0);
    if (!start || !imageParagraphStarts.has(start)) continue;

    const nextParagraph =
      (await safeRead(() => paragraphsRoot?.Item?.(index + 1))) ??
      (await safeRead(() => paragraphsRoot?.item?.(index + 1))) ??
      (await safeRead(() => paragraphsRoot?.[index + 1]));
    if (!nextParagraph) continue;

    const nextRange = await safeRead(() => nextParagraph?.Range);
    const nextStart = Number((await safeRead(() => nextRange?.Start)) || 0);
    if (!nextRange || !nextStart || appliedCaptionStarts.has(nextStart)) continue;

    appliedCaptionStarts.add(nextStart);
    matched += 1;
    if (await applyStyleToRange(nextRange, styleObject, styleName)) updated += 1;
  }

  return { matched, updated, skipped: matched - updated };
}

async function applyStyleToOtherText(
  activeDocument: any,
  styleObject: any,
  styleName: string,
  pageFrom: number,
  pageTo: number
): Promise<ApplyStyleByPageRangeResult> {
  let matched = 0;
  let updated = 0;
  let enteredRange = false;
  const excludedImageParagraphStarts = await collectImageParagraphStarts(activeDocument, pageFrom, pageTo);
  const excludedTableParagraphStarts = await collectTableParagraphStarts(activeDocument, pageFrom, pageTo);
  const paragraphsRoot = await safeRead(() => activeDocument?.Paragraphs);
  const count = Number((await safeRead(() => paragraphsRoot?.Count)) || 0);
  if (!paragraphsRoot || !Number.isFinite(count) || count <= 0) {
    return { matched: 0, updated: 0, skipped: 0 };
  }

  for (let index = 1; index <= count; index += 1) {
    const paragraph =
      (await safeRead(() => paragraphsRoot?.Item?.(index))) ??
      (await safeRead(() => paragraphsRoot?.item?.(index))) ??
      (await safeRead(() => paragraphsRoot?.[index]));
    if (!paragraph) continue;

    const paragraphRange = await safeRead(() => paragraph?.Range);
    if (!paragraphRange) continue;

    const page = await getRangePageNumber(paragraphRange);
    if (page < pageFrom) continue;
    if (page > pageTo) {
      if (enteredRange) break;
      continue;
    }
    enteredRange = true;

    const start = Number((await safeRead(() => paragraphRange?.Start)) || 0);
    if (!start || excludedImageParagraphStarts.has(start) || excludedTableParagraphStarts.has(start)) continue;

    const outlineLevel = Number((await safeRead(() => paragraph?.OutlineLevel)) || 10);
    if (Number.isFinite(outlineLevel) && outlineLevel >= 1 && outlineLevel <= 9) continue;

    const text = await getRangeText(paragraphRange);
    if (!text) continue;

    matched += 1;
    if (await applyStyleToRange(paragraphRange, styleObject, styleName)) updated += 1;
  }

  return { matched, updated, skipped: matched - updated };
}

async function collectTableParagraphStarts(activeDocument: any, pageFrom: number, pageTo: number): Promise<Set<number>> {
  const starts = new Set<number>();
  const tables = await collectIndexedItems(activeDocument?.Tables);
  let sawInRangeTable = false;

  for (const table of tables) {
    const tableRange = (await safeRead(() => table?.Range)) ?? (await safeRead(() => table?.range));
    if (!tableRange) continue;

    const tableStartPage = await getRangeStartPageNumber(tableRange);
    const tableEndPage = await getRangePageNumber(tableRange);
    const hasTablePageInfo = tableStartPage > 0 && tableEndPage > 0;
    if (hasTablePageInfo && tableEndPage < pageFrom) continue;
    if (hasTablePageInfo && tableStartPage > pageTo) {
      if (sawInRangeTable) break;
      continue;
    }
    if (hasTablePageInfo) sawInRangeTable = true;

    const tableFullyInRange = hasTablePageInfo && tableStartPage >= pageFrom && tableEndPage <= pageTo;
    const tableParagraphs = await getParagraphCollection(tableRange);
    if (!tableParagraphs?.length) continue;

    for (const paragraph of tableParagraphs) {
      const paragraphRange = await safeRead(() => paragraph?.Range);
      if (!paragraphRange) continue;
      if (!tableFullyInRange) {
        const page = await getRangePageNumber(paragraphRange);
        if (page < pageFrom || page > pageTo) continue;
      }
      const start = Number((await safeRead(() => paragraphRange?.Start)) || 0);
      if (start) starts.add(start);
    }
  }

  return starts;
}

async function collectImageParagraphStarts(activeDocument: any, pageFrom: number, pageTo: number): Promise<Set<number>> {
  const starts = new Set<number>();

  const inlineShapes = await collectIndexedItems(activeDocument?.InlineShapes);
  for (const shape of inlineShapes) {
    const range = (await safeRead(() => shape?.Range)) ?? (await safeRead(() => shape?.range));
    const page = await getRangePageNumber(range);
    if (page < pageFrom || page > pageTo) continue;
    const paragraph = await firstParagraphFromRange(range);
    const paragraphRange = paragraph ? await safeRead(() => paragraph?.Range) : null;
    const start = Number((await safeRead(() => paragraphRange?.Start)) || 0);
    if (!start) continue;
    starts.add(start);
  }

  const shapes = await collectIndexedItems(activeDocument?.Shapes);
  for (const shape of shapes) {
    const anchor =
      (await safeRead(() => shape?.Anchor)) ??
      (await safeRead(() => shape?.anchor)) ??
      (await safeRead(() => shape?.TextFrame?.TextRange));
    const page = await getRangePageNumber(anchor);
    if (page < pageFrom || page > pageTo) continue;
    const paragraph = await firstParagraphFromRange(anchor);
    const paragraphRange = paragraph ? await safeRead(() => paragraph?.Range) : null;
    const start = Number((await safeRead(() => paragraphRange?.Start)) || 0);
    if (!start) continue;
    starts.add(start);
  }

  return starts;
}

async function isRangeInTable(range: any): Promise<boolean> {
  if (!range) return false;

  const infoFn = (await safeRead(() => range?.Information)) ?? (await safeRead(() => range?.information));
  if (typeof infoFn === "function") {
    const result = await safeRead(() => infoFn.call(range, WD_INFO_WITHIN_TABLE));
    if (typeof result === "boolean") return result;
    const numeric = Number(result || 0);
    if (Number.isFinite(numeric) && numeric > 0) return true;
  }

  const tables = (await safeRead(() => range?.Tables)) ?? (await safeRead(() => range?.tables));
  const tableCount = Number((await safeRead(() => tables?.Count)) || (await safeRead(() => tables?.count)) || 0);
  return Number.isFinite(tableCount) && tableCount > 0;
}

function isHeadingStyleName(styleName: string): boolean {
  return parseHeadingLevelFromStyleName(styleName) > 0;
}

async function resolveStyleName(styleRef: any): Promise<string> {
  if (typeof styleRef === "string") return normalizeText(styleRef);
  if (!styleRef) return "";
  return (
    normalizeText(await safeRead(() => styleRef?.NameLocal)) ||
    normalizeText(await safeRead(() => styleRef?.Name)) ||
    normalizeText(await safeRead(() => styleRef?.nameLocal)) ||
    normalizeText(await safeRead(() => styleRef?.name))
  );
}

async function resolveParagraphHeadingLevel(paragraph: any, paragraphRange: any): Promise<number> {
  const outlineLevel = Number((await safeRead(() => paragraph?.OutlineLevel)) || 10);
  if (Number.isFinite(outlineLevel) && outlineLevel >= 1 && outlineLevel <= 9) return outlineLevel;

  const styleRef = (await safeRead(() => paragraph?.Style)) ?? (await safeRead(() => paragraphRange?.Style));
  const styleName = await resolveStyleName(styleRef);
  return parseHeadingLevelFromStyleName(styleName);
}

async function isHeadingParagraph(paragraph: any, paragraphRange: any): Promise<boolean> {
  return (await resolveParagraphHeadingLevel(paragraph, paragraphRange)) > 0;
}

async function firstParagraphFromRange(range: any): Promise<any | null> {
  if (!range) return null;
  const paragraphs = await safeRead(() => range?.Paragraphs);
  if (!paragraphs) return null;
  return (
    (await safeRead(() => paragraphs?.Item?.(1))) ??
    (await safeRead(() => paragraphs?.item?.(1))) ??
    (await safeRead(() => paragraphs?.[1])) ??
    null
  );
}

async function collectIndexedItems(collection: any): Promise<any[]> {
  if (!collection) return [];
  const count = Number((await safeRead(() => collection?.Count)) || 0);
  if (!Number.isFinite(count) || count <= 0) return [];
  const items: any[] = [];
  for (let index = 1; index <= count; index += 1) {
    const item =
      (await safeRead(() => collection?.Item?.(index))) ??
      (await safeRead(() => collection?.item?.(index))) ??
      (await safeRead(() => collection?.[index]));
    if (item) items.push(item);
  }
  return items;
}

interface SplitHeadingMarker {
  start: number;
  headingLevel: number;
  title: string;
}

function normalizeHeadingFileName(headingText: string, headingIndex: number): string {
  const sanitized = sanitizeFileNamePart(headingText);
  const shortened = sanitized.length > 80 ? sanitized.slice(0, 80).trim() : sanitized;
  return `${String(headingIndex).padStart(3, "0")}_${shortened || `章节_${headingIndex}`}.docx`;
}

async function closeDocumentSilently(document: any): Promise<void> {
  await safeWrite(() => document?.Close?.(WD_DO_NOT_SAVE_CHANGES));
  await safeWrite(() => document?.close?.(WD_DO_NOT_SAVE_CHANGES));
}

async function saveDocumentAsDocx(document: any, filePath: string): Promise<boolean> {
  if (await safeWrite(() => document?.SaveAs2?.(filePath, WD_FORMAT_DOCUMENT_DEFAULT))) return true;
  if (await safeWrite(() => document?.saveAs2?.(filePath, WD_FORMAT_DOCUMENT_DEFAULT))) return true;
  if (await safeWrite(() => document?.SaveAs?.(filePath, WD_FORMAT_DOCUMENT_DEFAULT))) return true;
  if (await safeWrite(() => document?.saveAs?.(filePath, WD_FORMAT_DOCUMENT_DEFAULT))) return true;
  return false;
}

async function getDocumentContentRange(document: any): Promise<any | null> {
  return (
    (await safeRead(() => document?.Content)) ??
    (await safeRead(() => document?.content)) ??
    (await safeRead(() => document?.Range?.())) ??
    (await safeRead(() => document?.range?.())) ??
    null
  );
}

async function clearDocumentContent(document: any): Promise<void> {
  const contentRange = await getDocumentContentRange(document);
  if (!contentRange) return;
  await safeWrite(() => {
    (contentRange as { Text?: string }).Text = "";
  });
}

async function documentHasVisibleContent(document: any): Promise<boolean> {
  const contentRange = await getDocumentContentRange(document);
  const text = String((await safeRead(() => contentRange?.Text)) || "").replace(/[\r\n\s]/g, "");
  return text.length > 0;
}

async function pasteClipboardToDocument(targetDocument: any): Promise<boolean> {
  await clearDocumentContent(targetDocument);
  const insertionRange =
    (await safeRead(() => targetDocument?.Range?.(0, 0))) ??
    (await safeRead(() => targetDocument?.range?.(0, 0))) ??
    (await safeRead(() => targetDocument?.Content)) ??
    (await safeRead(() => targetDocument?.content));
  if (!insertionRange) return false;

  await safeWrite(() => insertionRange?.Collapse?.(WD_COLLAPSE_START));
  await safeWrite(() => insertionRange?.collapse?.(WD_COLLAPSE_START));
  if (await safeWrite(() => insertionRange?.Paste?.())) return true;
  if (await safeWrite(() => insertionRange?.paste?.())) return true;
  return documentHasVisibleContent(targetDocument);
}

async function writePlainTextToDocument(text: string, targetDocument: any): Promise<boolean> {
  await clearDocumentContent(targetDocument);
  const contentRange = await getDocumentContentRange(targetDocument);
  if (!contentRange || !text.length) return false;
  return safeWrite(() => {
    (contentRange as { Text?: string }).Text = text;
  });
}

export async function splitDocumentByHeadingRange(
  app: any,
  options: SplitDocumentByHeadingOptions
): Promise<SplitDocumentByHeadingResult> {
  const pageFrom = Number(options.pageFrom);
  const pageTo = Number(options.pageTo);
  const headingLevel = Number(options.headingLevel);
  const outputDirectory = normalizeOutputDirectory(String(options.outputDirectory || ""));

  if (!Number.isFinite(pageFrom) || pageFrom <= 0 || !Number.isFinite(pageTo) || pageTo <= 0) {
    throw new Error("页码范围无效。");
  }
  if (pageTo < pageFrom) {
    throw new Error("结束页码不能小于起始页码。");
  }
  if (!Number.isFinite(headingLevel) || headingLevel < 1 || headingLevel > 9) {
    throw new Error("标题级别必须在 1 到 9 之间。");
  }
  if (!outputDirectory) {
    throw new Error("导出目录不能为空。");
  }

  const activeDocument = await getDocument(app);
  const contentRange =
    (await safeRead(() => activeDocument?.Content)) ??
    (await safeRead(() => activeDocument?.Range?.())) ??
    (await safeRead(() => activeDocument?.range?.()));
  const documentEnd = Number((await safeRead(() => contentRange?.End)) || 0);
  if (!Number.isFinite(documentEnd) || documentEnd <= 0) {
    throw new Error("无法读取当前文档内容范围。");
  }

  const paragraphsRoot = await safeRead(() => activeDocument?.Paragraphs);
  const paragraphCount = Number((await safeRead(() => paragraphsRoot?.Count)) || 0);
  if (!paragraphsRoot || !Number.isFinite(paragraphCount) || paragraphCount <= 0) {
    return { totalSections: 0, exported: 0, skipped: 0, files: [] };
  }

  const emitProgress = async (progress: SplitDocumentProgress): Promise<void> => {
    try {
      await options.onProgress?.(progress);
    } catch {
      // Ignore UI callback errors to avoid interrupting export.
    }
  };

  const markers: SplitHeadingMarker[] = [];
  const candidateMarkerIndexes: number[] = [];
  let exportUpperBound = documentEnd;
  let scanned = 0;

  await emitProgress({
    phase: "scan",
    scanned: 0,
    scanTotal: paragraphCount,
    current: 0,
    total: 0,
    exported: 0,
    skipped: 0,
    currentTitle: "",
  });

  for (let index = 1; index <= paragraphCount; index += 1) {
    scanned += 1;
    if (scanned % 25 === 0) {
      await emitProgress({
        phase: "scan",
        scanned,
        scanTotal: paragraphCount,
        current: 0,
        total: 0,
        exported: 0,
        skipped: 0,
        currentTitle: "",
      });
    }
    const paragraph =
      (await safeRead(() => paragraphsRoot?.Item?.(index))) ??
      (await safeRead(() => paragraphsRoot?.item?.(index))) ??
      (await safeRead(() => paragraphsRoot?.[index]));
    if (!paragraph) continue;

    const paragraphRange = await safeRead(() => paragraph?.Range);
    if (!paragraphRange) continue;

    const start = Number((await safeRead(() => paragraphRange?.Start)) || 0);
    if (!Number.isFinite(start) || start <= 0 || start >= documentEnd) continue;

    let page = await getRangePageNumber(paragraphRange);
    if (page <= 0) {
      page = await getRangeStartPageNumber(paragraphRange);
    }
    if (page <= 0) continue;

    if (page > pageTo) {
      exportUpperBound = Math.min(exportUpperBound, start);
      await emitProgress({
        phase: "scan",
        scanned,
        scanTotal: paragraphCount,
        current: 0,
        total: 0,
        exported: 0,
        skipped: 0,
        currentTitle: "",
      });
      break;
    }
    if (page < pageFrom) {
      continue;
    }

    const resolvedLevel = await resolveParagraphHeadingLevel(paragraph, paragraphRange);
    if (resolvedLevel < 1 || resolvedLevel > headingLevel) continue;

    const marker: SplitHeadingMarker = {
      start,
      headingLevel: resolvedLevel,
      title: resolvedLevel === headingLevel ? await getRangeText(paragraphRange) : "",
    };
    const markerIndex = markers.push(marker) - 1;
    if (resolvedLevel === headingLevel) {
      candidateMarkerIndexes.push(markerIndex);
    }

    if (scanned === paragraphCount) {
      await emitProgress({
        phase: "scan",
        scanned,
        scanTotal: paragraphCount,
        current: 0,
        total: 0,
        exported: 0,
        skipped: 0,
        currentTitle: "",
      });
    }
  }

  if (scanned < paragraphCount) {
    await emitProgress({
      phase: "scan",
      scanned,
      scanTotal: paragraphCount,
      current: 0,
      total: 0,
      exported: 0,
      skipped: 0,
      currentTitle: "",
    });
  }

  if (!candidateMarkerIndexes.length) {
    throw new Error(`在第 ${pageFrom}~${pageTo} 页内未找到 ${headingLevel} 级标题。`);
  }

  const usedFileNames = new Set<string>();
  const files: string[] = [];
  let exported = 0;
  let skipped = 0;
  const total = candidateMarkerIndexes.length;

  await emitProgress({
    phase: "export",
    scanned,
    scanTotal: paragraphCount,
    current: 0,
    total,
    exported,
    skipped,
    currentTitle: "",
  });

  for (let index = 0; index < candidateMarkerIndexes.length; index += 1) {
    const markerIndex = candidateMarkerIndexes[index];
    const heading = markers[markerIndex];
    let sectionEnd = exportUpperBound;
    for (let nextIndex = markerIndex + 1; nextIndex < markers.length; nextIndex += 1) {
      const nextMarker = markers[nextIndex];
      if (nextMarker.headingLevel <= headingLevel) {
        sectionEnd = Math.min(sectionEnd, nextMarker.start);
        break;
      }
    }

    if (!Number.isFinite(sectionEnd) || sectionEnd <= heading.start) {
      skipped += 1;
      await emitProgress({
        phase: "export",
        scanned,
        scanTotal: paragraphCount,
        current: index + 1,
        total,
        exported,
        skipped,
        currentTitle: heading.title,
      });
      continue;
    }

    const sectionRange =
      (await safeRead(() => activeDocument?.Range?.(heading.start, sectionEnd))) ??
      (await safeRead(() => activeDocument?.range?.(heading.start, sectionEnd)));
    if (!sectionRange) {
      skipped += 1;
      await emitProgress({
        phase: "export",
        scanned,
        scanTotal: paragraphCount,
        current: index + 1,
        total,
        exported,
        skipped,
        currentTitle: heading.title,
      });
      continue;
    }

    const logicalIndex = index + 1;
    const baseName = normalizeHeadingFileName(heading.title || `章节_${logicalIndex}`, logicalIndex);
    let fileName = baseName;
    let suffix = 2;
    while (usedFileNames.has(fileName.toLowerCase())) {
      fileName = baseName.replace(/\.docx$/i, `_${suffix}.docx`);
      suffix += 1;
    }
    usedFileNames.add(fileName.toLowerCase());
    const filePath = buildPathUnderDirectory(outputDirectory, fileName);
    const copiedToClipboard = (await safeWrite(() => sectionRange?.Copy?.())) || (await safeWrite(() => sectionRange?.copy?.()));

    const newDocument =
      (await safeRead(() => app?.Documents?.Add?.())) ??
      (await safeRead(() => app?.documents?.add?.()));
    if (!newDocument) {
      throw new Error("当前 WPS 环境不支持创建新文档，无法执行拆分导出。");
    }

    try {
      const copied = copiedToClipboard ? await pasteClipboardToDocument(newDocument) : false;
      if (!copied) {
        const text = String((await safeRead(() => sectionRange?.Text)) || "");
        if (!(await writePlainTextToDocument(text, newDocument))) {
          skipped += 1;
          await emitProgress({
            phase: "export",
            scanned,
            scanTotal: paragraphCount,
            current: index + 1,
            total,
            exported,
            skipped,
            currentTitle: heading.title,
          });
          continue;
        }
      }

      const saved = await saveDocumentAsDocx(newDocument, filePath);
      if (!saved) {
        throw new Error(`保存失败：${filePath}`);
      }

      files.push(filePath);
      exported += 1;
      await emitProgress({
        phase: "export",
        scanned,
        scanTotal: paragraphCount,
        current: index + 1,
        total,
        exported,
        skipped,
        currentTitle: heading.title,
      });
    } finally {
      await closeDocumentSilently(newDocument);
    }
  }

  await emitProgress({
    phase: "done",
    scanned,
    scanTotal: paragraphCount,
    current: total,
    total,
    exported,
    skipped,
    currentTitle: "",
  });

  return {
    totalSections: total,
    exported,
    skipped,
    files,
  };
}

export async function getSelectionText(app: any): Promise<string> {
  const range = await getSelectionRange(app);
  return getRangeText(range);
}

export async function getCurrentParagraphText(app: any): Promise<string> {
  const range = await getSelectionRange(app);
  const paragraphs = await getParagraphCollection(range);
  const paragraphRange = paragraphs?.length ? await safeRead(() => paragraphs[0]?.Range) : null;
  return (paragraphRange ? await getRangeText(paragraphRange) : "") || getSelectionText(app);
}

export async function getSelectionOrParagraphText(app: any): Promise<string> {
  const selectionText = await getSelectionText(app);
  return selectionText || getCurrentParagraphText(app);
}

export async function describeSelectionStyle(app: any): Promise<SelectionStyleDescriptionResult> {
  const raw = await readSelectionStyleRaw(app);
  const structured = convertRawSelectionStyleSnapshot(raw);
  const comparison = compareParagraphStyles(structured.paragraphs);
  return buildSelectionStyleDescription(structured, comparison);
}

export async function inspectCurrentStyle(app: any): Promise<SelectionStyleDescriptionResult> {
  return describeSelectionStyle(app);
}

export async function getDocumentText(app: any, limit = 6000): Promise<{ text: string; truncated: boolean }> {
  const activeDocument = await getDocument(app);

  const contentRange =
    (await safeRead(() => activeDocument?.Content)) ??
    (await safeRead(() => activeDocument?.Range?.()));
  const text = contentRange ? await getRangeText(contentRange) : "";
  if (!text) return { text: "", truncated: false };
  return text.length > limit ? { text: text.slice(0, limit), truncated: true } : { text, truncated: false };
}

export async function getHeadingSectionText(
  app: any,
  limit = 6000
): Promise<{ text: string; heading: string; truncated: boolean }> {
  const activeDocument = await safeRead(() => getDocument(app));
  const selectionRange = await getSelectionRange(app);
  if (!activeDocument) {
    return { text: await getCurrentParagraphText(app), heading: "", truncated: false };
  }

  const paragraphsRoot = await safeRead(() => activeDocument?.Paragraphs);
  const count = Number((await safeRead(() => paragraphsRoot?.Count)) || 0);
  if (!paragraphsRoot || !Number.isFinite(count) || count <= 0) {
    return { text: await getCurrentParagraphText(app), heading: "", truncated: false };
  }

  const selectionStart = Number((await safeRead(() => selectionRange?.Start)) || 0);
  const blocks: Array<{ start: number; text: string; outlineLevel: number }> = [];

  for (let index = 1; index <= count; index += 1) {
    const paragraph =
      (await safeRead(() => paragraphsRoot?.Item?.(index))) ??
      (await safeRead(() => paragraphsRoot?.item?.(index))) ??
      (await safeRead(() => paragraphsRoot?.[index]));
    if (!paragraph) continue;
    const range = await safeRead(() => paragraph?.Range);
    const text = range ? await getRangeText(range) : "";
    if (!text) continue;
    const start = Number((await safeRead(() => range?.Start)) || 0);
    const outlineLevel = Number((await safeRead(() => paragraph?.OutlineLevel)) || 10);
    blocks.push({ start, text, outlineLevel });
  }

  if (!blocks.length) {
    return { text: await getCurrentParagraphText(app), heading: "", truncated: false };
  }

  let currentIndex = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    if (blocks[index].start <= selectionStart) currentIndex = index;
    else break;
  }

  let headingIndex = -1;
  for (let index = currentIndex; index >= 0; index -= 1) {
    if (blocks[index].outlineLevel >= 1 && blocks[index].outlineLevel <= 9) {
      headingIndex = index;
      break;
    }
  }

  if (headingIndex < 0) {
    return { text: await getCurrentParagraphText(app), heading: "", truncated: false };
  }

  const headingLevel = blocks[headingIndex].outlineLevel;
  const sectionParts: string[] = [];
  for (let index = headingIndex; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (index > headingIndex && block.outlineLevel >= 1 && block.outlineLevel <= headingLevel) break;
    sectionParts.push(block.text);
  }

  const text = normalizeText(sectionParts.join("\n"));
  if (!text) {
    return { text: await getCurrentParagraphText(app), heading: "", truncated: false };
  }
  return text.length > limit
    ? { text: text.slice(0, limit), heading: blocks[headingIndex].text, truncated: true }
    : { text, heading: blocks[headingIndex].text, truncated: false };
}

export async function replaceSelection(app: any, text: string): Promise<void> {
  const range = await getSelectionRange(app);
  range.Text = text;
}

export async function insertAfterSelection(app: any, text: string): Promise<void> {
  const range = await getSelectionRange(app);
  await range.InsertAfter(text);
}

export async function replaceSelectionWithTable(app: any, rows: string[][]): Promise<void> {
  const range = await getSelectionRange(app);
  await insertTableAtRange(app, range, rows, true);
}

export async function insertTableAfterSelection(app: any, rows: string[][]): Promise<void> {
  const range = await getSelectionRange(app);
  try {
    if (typeof range?.Collapse === "function") {
      await range.Collapse(0);
    }
  } catch {
    // Ignore collapse failures and try insertion directly.
  }
  await insertTableAtRange(app, range, rows, false);
}

async function insertTableAtRange(app: any, range: any, rows: string[][], replaceExisting: boolean): Promise<void> {
  if (!rows.length || rows.some((row) => !row.length)) {
    throw new Error("表格数据为空，无法插入。");
  }

  const activeDocument = await getDocument(app);
  const rowCount = rows.length;
  const columnCount = rows[0].length;

  if (replaceExisting) {
    try {
      range.Text = "";
    } catch {
      // Continue and let Tables.Add try on the existing range.
    }
  }

  const table =
    (await safeRead(() => activeDocument?.Tables?.Add?.(range, rowCount, columnCount))) ??
    (await safeRead(() => activeDocument?.Tables?.add?.(range, rowCount, columnCount)));

  if (!table) {
    throw new Error("当前 WPS 环境不支持通过加载项插入表格。");
  }

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const cell =
        (await safeRead(() => table?.Cell?.(rowIndex + 1, columnIndex + 1))) ??
        (await safeRead(() => table?.cell?.(rowIndex + 1, columnIndex + 1)));
      const cellRange = cell
        ? (await safeRead(() => cell?.Range)) ?? (await safeRead(() => cell?.range))
        : null;
      if (!cellRange) continue;
      cellRange.Text = rows[rowIndex][columnIndex] || "";
    }
  }

  try {
    const tableRows = (await safeRead(() => table?.Rows)) ?? (await safeRead(() => table?.rows));
    if (tableRows) {
      (tableRows as { Alignment?: number }).Alignment = 1;
    }
    await safeRead(() => table?.AutoFitBehavior?.(1));
  } catch {
    // Formatting is best-effort only.
  }
}

export async function insertImageAfterSelection(app: any, imagePath: string): Promise<void> {
  const selection = await getSelection(app);
  const range = await selection.Range;
  const activeDocument = await getDocument(app);

  try {
    if (typeof range?.Collapse === "function") {
      await range.Collapse(0);
    }
  } catch {
    // Some WPS builds expose Range as a property bag; insertion can still work without collapse.
  }

  const attempts = [
    async () => activeDocument?.InlineShapes?.AddPicture(imagePath, false, true, range),
    async () => selection?.InlineShapes?.AddPicture(imagePath, false, true),
    async () => activeDocument?.Shapes?.AddPicture(imagePath, false, true),
  ];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result !== undefined) return;
    } catch {
      // Try the next object-model variant.
    }
  }

  throw new Error(`图片插入失败，已生成文件：${imagePath}`);
}
