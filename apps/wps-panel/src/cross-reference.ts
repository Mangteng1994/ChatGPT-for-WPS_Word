const WD_FIELD_EMPTY = -1;
const WD_FIELD_REF = 3;
const WD_REFERENCE_TYPE_BOOKMARK = 2;
const WD_REFERENCE_KIND_CONTENT_TEXT = -1;
const WD_CHARACTER = 1;
const WD_COLLAPSE_START = 1;

const CAPTION_GAP_PATTERN = /^[\s\u3000\u0007\u0013\u0014\u0015\u200B\u200C\u200D\uFEFF]$/;
const CAPTION_CONTROL_PATTERN = /[\r\u0007\u0013\u0014\u0015\u200B\u200C\u200D\uFEFF]/g;

export type CaptionReferenceType = "figure" | "table";

export interface CaptionReferenceOption {
  index: number;
  kind: CaptionReferenceType;
  captionText: string;
  referenceText: string;
  bookmarkName: string;
  referenceParts: CaptionReferencePart[];
  referencePartsAreFieldBacked: boolean;
  searchText: string;
  referenceStart: number;
  referenceEnd: number;
  paragraphStart: number;
  paragraphEnd: number;
  paragraphIndex: number;
  paragraphRange?: any;
}

export interface CaptionReferencePart {
  text: string;
  bookmarkName: string;
  referenceStart: number;
  referenceEnd: number;
  isField: boolean;
  fieldIndex: number;
}

export interface CaptionReferenceInsertResult {
  option: CaptionReferenceOption;
  bookmarkCreated: boolean;
  mode: "parts" | "single";
}

export interface CaptionReferenceFontSizeResult {
  fontSize: number;
  kind: CaptionReferenceType;
  matched: number;
  updated: number;
}

export interface CaptionReferenceFontSizeBatchResult {
  fontSize: number;
  totalMatched: number;
  totalUpdated: number;
  figures: CaptionReferenceFontSizeResult;
  tables: CaptionReferenceFontSizeResult;
}

export interface CaptionReferenceScanResult {
  figures: CaptionReferenceOption[];
  tables: CaptionReferenceOption[];
}

export interface CaptionReferencePrefixMatch {
  referenceText: string;
  referenceStartOffset: number;
  referenceLength: number;
  referenceParts: CaptionReferencePrefixPart[];
}

export interface CaptionReferencePrefixPart {
  text: string;
  referenceStartOffset: number;
  referenceLength: number;
  isField: boolean;
  fieldIndex: number;
}

export interface CaptionReferenceInsertAttemptResult {
  matched: boolean;
  text: string;
}

interface CaptionParagraphEntry {
  paragraphIndex: number;
  start: number;
  end: number;
  range: any;
  text: string;
  rawText: string;
}

interface ParagraphCollectionContext {
  paragraphs: any;
}

interface CaptionMappedText {
  text: string;
  startOffsets: number[];
  endOffsets: number[];
  rangeStartOffsets: number[];
  rangeEndOffsets: number[];
  fieldFlags: boolean[];
  fieldIndexes: number[];
}

interface CaptionReferenceRangePart {
  text: string;
  referenceStart: number;
  referenceEnd: number;
  isField: boolean;
  fieldIndex: number;
}

interface CaptionReferenceFieldResultPart {
  text: string;
  referenceStart: number | null;
  referenceEnd: number | null;
  fieldIndex: number;
}

function stripCaptionControlCharacters(value: string): string {
  return String(value || "").replace(CAPTION_CONTROL_PATTERN, "");
}

function isCaptionControlCharacter(character: string): boolean {
  return stripCaptionControlCharacters(character) === "";
}

function normalizeCaptionReferenceVisibleText(value: string): string {
  return buildCaptionMappedText(String(value || "")).text
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCaptionReferenceNumberText(value: unknown): string {
  return normalizeCaptionReferenceVisibleText(String(value || ""))
    .replace(/第\s*([0-9０-９一二三四五六七八九十百千零〇]+)\s*[章节]/g, "$1")
    .replace(/\s*([-.．—－‐‑‒–~～/])\s*/g, "$1")
    .replace(/^(图|表)\s+/, "$1");
}

function buildCaptionMappedText(value: string): CaptionMappedText {
  const source = String(value || "");
  const characters: string[] = [];
  const startOffsets: number[] = [];
  const endOffsets: number[] = [];
  const rangeStartOffsets: number[] = [];
  const rangeEndOffsets: number[] = [];
  const fieldFlags: boolean[] = [];
  const fieldIndexes: number[] = [];

  let index = 0;
  let fieldIndex = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "\u0013") {
      const fieldStart = index;
      const separatorIndex = source.indexOf("\u0014", index + 1);
      const fieldEnd = separatorIndex >= 0 ? source.indexOf("\u0015", separatorIndex + 1) : -1;
      if (separatorIndex >= 0 && fieldEnd >= 0) {
        fieldIndex += 1;
        for (let resultIndex = separatorIndex + 1; resultIndex < fieldEnd; resultIndex += 1) {
          const resultCharacter = source[resultIndex];
          if (isCaptionControlCharacter(resultCharacter)) continue;
          characters.push(resultCharacter);
          startOffsets.push(resultIndex === separatorIndex + 1 ? fieldStart : resultIndex);
          endOffsets.push(fieldEnd + 1);
          rangeStartOffsets.push(fieldStart);
          rangeEndOffsets.push(fieldEnd + 1);
          fieldFlags.push(true);
          fieldIndexes.push(fieldIndex);
        }
        index = fieldEnd + 1;
        continue;
      }
    }

    if (isCaptionControlCharacter(character)) {
      index += 1;
      continue;
    }

    characters.push(character);
    startOffsets.push(index);
    endOffsets.push(index + 1);
    rangeStartOffsets.push(index);
    rangeEndOffsets.push(index + 1);
    fieldFlags.push(false);
    fieldIndexes.push(0);
    index += 1;
  }

  return {
    text: characters.join(""),
    startOffsets,
    endOffsets,
    rangeStartOffsets,
    rangeEndOffsets,
    fieldFlags,
    fieldIndexes,
  };
}

export function normalizeCaptionReferenceSearchText(value: unknown): string {
  return normalizeCaptionReferenceVisibleText(String(value || ""))
    .toLowerCase();
}

export function normalizeCaptionReferenceResultText(value: unknown): string {
  return normalizeCaptionReferenceNumberText(value);
}

export function captionReferenceResultMatches(actualText: unknown, expectedText: string): CaptionReferenceInsertAttemptResult {
  const normalizedActual = normalizeCaptionReferenceResultText(actualText);
  const normalizedExpected = normalizeCaptionReferenceResultText(expectedText);
  return {
    matched: Boolean(normalizedExpected) && normalizedActual === normalizedExpected,
    text: normalizedActual,
  };
}

export function buildCaptionReferenceBookmarkName(kind: CaptionReferenceType, index: number): string {
  const prefix = kind === "figure" ? "FigRef" : "TblRef";
  return `${prefix}_${String(index).padStart(3, "0")}`;
}

function buildCaptionReferencePartBookmarkName(bookmarkName: string, partIndex: number): string {
  return `${bookmarkName}_P${String(partIndex + 1).padStart(2, "0")}`;
}

function toCaptionReferenceParts(
  bookmarkName: string,
  parts: CaptionReferenceRangePart[]
): CaptionReferencePart[] {
  return parts.map((part, partIndex) => ({
    text: normalizeCaptionReferenceVisibleText(part.text),
    bookmarkName: buildCaptionReferencePartBookmarkName(bookmarkName, partIndex),
    referenceStart: part.referenceStart,
    referenceEnd: part.referenceEnd,
    isField: part.isField,
    fieldIndex: part.fieldIndex,
  }));
}

export function isCaptionReferenceBookmarkName(bookmarkName: unknown, kind?: CaptionReferenceType): boolean {
  const normalized = String(bookmarkName || "").trim();
  if (!normalized) return false;
  if (kind === "figure") return /^FigRef_\d+(?:_P\d+)?$/i.test(normalized);
  if (kind === "table") return /^TblRef_\d+(?:_P\d+)?$/i.test(normalized);
  return /^(?:FigRef|TblRef)_\d+(?:_P\d+)?$/i.test(normalized);
}

export function extractCaptionReferenceBookmarkNameFromFieldCode(fieldCodeText: unknown): string {
  const normalized = String(fieldCodeText || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const match = normalized.match(/\bREF\s+([A-Za-z0-9_]+)/i);
  const bookmarkName = match?.[1] || "";
  return isCaptionReferenceBookmarkName(bookmarkName) ? bookmarkName : "";
}

export function buildCaptionReferenceFieldCodeText(bookmarkName: string, existingFieldCodeText = ""): string {
  const normalizedBookmarkName = String(bookmarkName || "").trim();
  if (!isCaptionReferenceBookmarkName(normalizedBookmarkName)) return "";
  const existing = String(existingFieldCodeText || "").replace(/\s+/g, " ").trim();
  const hyperlinkSwitch = /\s\\h(?:\s|$)/i.test(` ${existing} `) ? " \\h" : "";
  return ` REF ${normalizedBookmarkName}${hyperlinkSwitch} \\* MERGEFORMAT `;
}

function isCaptionGapChar(character: string): boolean {
  return CAPTION_GAP_PATTERN.test(character);
}

function isCaptionConnectorChar(character: string): boolean {
  return "-.．—－‐‑‒–~～/".includes(character);
}

function isCaptionAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isCaptionFullWidthDigit(character: string): boolean {
  const codePoint = character.codePointAt(0) || 0;
  return codePoint >= 0xff10 && codePoint <= 0xff19;
}

function isCaptionAsciiLetter(character: string): boolean {
  return (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
}

function isCaptionFullWidthLetter(character: string): boolean {
  const codePoint = character.codePointAt(0) || 0;
  return (codePoint >= 0xff21 && codePoint <= 0xff3a) || (codePoint >= 0xff41 && codePoint <= 0xff5a);
}

function isCaptionChineseNumeral(character: string): boolean {
  return "一二三四五六七八九十百千零〇甲乙丙丁子丑寅卯上下".includes(character);
}

function isCaptionOrdinalWrapperChar(character: string): boolean {
  return "第章节".includes(character);
}

function isCaptionTokenChar(character: string): boolean {
  return (
    isCaptionAsciiDigit(character) ||
    isCaptionFullWidthDigit(character) ||
    isCaptionAsciiLetter(character) ||
    isCaptionFullWidthLetter(character) ||
    isCaptionChineseNumeral(character) ||
    isCaptionOrdinalWrapperChar(character)
  );
}

function isCaptionNumericLikeChar(character: string): boolean {
  return isCaptionAsciiDigit(character) || isCaptionFullWidthDigit(character) || isCaptionChineseNumeral(character);
}

function readCaptionLabel(source: string, startIndex: number): { text: string; length: number } | null {
  const remaining = source.slice(startIndex);
  if (!remaining) return null;

  if (remaining.startsWith("图")) {
    return { text: "图", length: 1 };
  }
  if (remaining.startsWith("表")) {
    return { text: "表", length: 1 };
  }

  const lower = remaining.toLowerCase();
  if (lower.startsWith("figure")) {
    return { text: remaining.slice(0, 6), length: 6 };
  }
  if (lower.startsWith("table")) {
    return { text: remaining.slice(0, 5), length: 5 };
  }

  return null;
}

function readCaptionToken(source: string, startIndex: number): { end: number; hasNumericLike: boolean } | null {
  let index = startIndex;
  let length = 0;
  let hasNumericLike = false;

  while (index < source.length) {
    const character = source[index];
    if (isCaptionGapChar(character) || isCaptionConnectorChar(character)) break;
    if (!isCaptionTokenChar(character)) break;
    if (isCaptionNumericLikeChar(character)) hasNumericLike = true;
    index += 1;
    length += 1;
  }

  if (!length) return null;
  return { end: index, hasNumericLike };
}

function buildCaptionReferencePrefixParts(
  mappedText: CaptionMappedText,
  displayStart: number,
  displayEnd: number
): CaptionReferencePrefixPart[] {
  const parts: CaptionReferencePrefixPart[] = [];
  for (let index = displayStart; index < displayEnd; index += 1) {
    const text = mappedText.text[index] || "";
    const referenceStartOffset = mappedText.rangeStartOffsets[index];
    const referenceEndOffset = mappedText.rangeEndOffsets[index];
    const isField = Boolean(mappedText.fieldFlags[index]);
    const fieldIndex = Number(mappedText.fieldIndexes[index] || 0);
    if (!text || referenceStartOffset === undefined || referenceEndOffset === undefined) continue;

    const previous = parts[parts.length - 1];
    const canMerge =
      previous &&
      previous.isField === isField &&
      previous.fieldIndex === fieldIndex &&
      previous.referenceStartOffset + previous.referenceLength === referenceStartOffset;
    const sameField =
      previous &&
      isField &&
      previous.fieldIndex === fieldIndex &&
      previous.referenceStartOffset === referenceStartOffset &&
      previous.referenceStartOffset + previous.referenceLength === referenceEndOffset;

    if (canMerge || sameField) {
      previous.text += text;
      if (!sameField) {
        previous.referenceLength = referenceEndOffset - previous.referenceStartOffset;
      }
      continue;
    }

    parts.push({
      text,
      referenceStartOffset,
      referenceLength: referenceEndOffset - referenceStartOffset,
      isField,
      fieldIndex,
    });
  }
  return parts;
}

export function extractCaptionReferencePrefixDetails(text: string): CaptionReferencePrefixMatch | null {
  const source = String(text || "");
  if (!source) return null;
  const mappedText = buildCaptionMappedText(source);
  const displayText = mappedText.text;
  if (!displayText) return null;

  let index = 0;
  while (index < displayText.length && isCaptionGapChar(displayText[index])) index += 1;
  const referenceDisplayStart = index;
  const referenceStartOffset = mappedText.startOffsets[referenceDisplayStart];
  if (referenceStartOffset === undefined) return null;

  const label = readCaptionLabel(displayText, index);
  if (!label) return null;
  index += label.length;

  while (index < displayText.length && isCaptionGapChar(displayText[index])) index += 1;

  const firstToken = readCaptionToken(displayText, index);
  if (!firstToken || !firstToken.hasNumericLike) return null;

  let rawEnd = firstToken.end;
  index = firstToken.end;

  while (index < displayText.length) {
    while (index < displayText.length && isCaptionGapChar(displayText[index])) index += 1;
    if (index >= displayText.length || !isCaptionConnectorChar(displayText[index])) break;

    index += 1;
    while (index < displayText.length && isCaptionGapChar(displayText[index])) index += 1;

    const nextToken = readCaptionToken(displayText, index);
    if (!nextToken || !nextToken.hasNumericLike) break;

    rawEnd = nextToken.end;
    index = nextToken.end;
  }

  const referenceText = normalizeCaptionReferenceNumberText(displayText.slice(referenceDisplayStart, rawEnd));
  if (!referenceText) return null;
  const referenceEndOffset = mappedText.endOffsets[rawEnd - 1];
  if (referenceEndOffset === undefined || referenceEndOffset <= referenceStartOffset) return null;

  return {
    referenceText,
    referenceStartOffset,
    referenceLength: referenceEndOffset - referenceStartOffset,
    referenceParts: buildCaptionReferencePrefixParts(mappedText, referenceDisplayStart, rawEnd),
  };
}

export function extractCaptionReferencePrefix(text: string): string {
  return extractCaptionReferencePrefixDetails(text)?.referenceText || "";
}

export function isLikelyFigureReferenceText(text: string): boolean {
  return extractCaptionReferencePrefix(text).startsWith("图") || extractCaptionReferencePrefix(text).toLowerCase().startsWith("figure");
}

export function isLikelyTableReferenceText(text: string): boolean {
  return extractCaptionReferencePrefix(text).startsWith("表") || extractCaptionReferencePrefix(text).toLowerCase().startsWith("table");
}

function captionReferenceMatchesKind(referenceText: string, kind: CaptionReferenceType): boolean {
  const normalized = normalizeCaptionReferenceResultText(referenceText);
  const lower = normalized.toLowerCase();
  return kind === "figure" ? normalized.startsWith("图") || lower.startsWith("figure") : normalized.startsWith("表") || lower.startsWith("table");
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

async function getDocument(app: any): Promise<any> {
  const activeDocument = await app?.ActiveDocument;
  if (!activeDocument) {
    throw new Error("未找到活动文档，请先在 WPS 中打开一个 Word 文档。");
  }
  return activeDocument;
}

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

async function getParagraphByIndex(paragraphs: any, index: number): Promise<any | null> {
  return getCollectionItem(paragraphs, index);
}

async function getCollectionCount(collection: any): Promise<number> {
  const count = Number((await readCallableOrValue(collection, ["Count", "count", "Length", "length"])) ?? 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

async function getCollectionItem(collection: any, index: number): Promise<any | null> {
  const arrayIndex = index - 1;
  return (
    (await safeRead(() => collection?.Item?.(index))) ??
    (await safeRead(() => collection?.item?.(index))) ??
    (await safeRead(() => collection?.[arrayIndex])) ??
    (await safeRead(() => collection?.[index])) ??
    null
  );
}

async function readParagraphEntriesFromCollection(
  context: ParagraphCollectionContext,
  seenRanges: Set<string>
): Promise<CaptionParagraphEntry[]> {
  const paragraphs = context.paragraphs;
  const count = await getCollectionCount(paragraphs);
  if (!Number.isFinite(count) || count <= 0) return [];

  const items: CaptionParagraphEntry[] = [];
  for (let index = 1; index <= count; index += 1) {
    const paragraph = await getParagraphByIndex(paragraphs, index);
    if (!paragraph) continue;

    const range = (await safeRead(() => paragraph?.Range)) ?? (await safeRead(() => paragraph?.range));
    if (!range) continue;

    const startValue = await readCallableOrValue(range, ["Start", "start"]);
    if (startValue === null || startValue === undefined) continue;
    const start = Number(startValue);
    if (!Number.isFinite(start) || start < 0) continue;

    const rawText = String((await readCallableOrValue(range, ["Text", "text"])) || "");
    const endValue = await readCallableOrValue(range, ["End", "end"]);
    const end = endValue === null || endValue === undefined ? start + rawText.length : Number(endValue);
    if (!Number.isFinite(end) || end <= start) continue;

    const key = `${start}:${rawText}`;
    if (seenRanges.has(key)) continue;
    seenRanges.add(key);

    const text = normalizeCaptionReferenceVisibleText(rawText);
    items.push({ paragraphIndex: index, start, end, range, text, rawText });
  }

  return items;
}

async function collectTableParagraphContexts(activeDocument: any): Promise<ParagraphCollectionContext[]> {
  const tables = (await safeRead(() => activeDocument?.Tables)) ?? (await safeRead(() => activeDocument?.tables));
  const tableCount = await getCollectionCount(tables);
  if (!tables || !Number.isFinite(tableCount) || tableCount <= 0) return [];

  const contexts: ParagraphCollectionContext[] = [];
  for (let tableIndex = 1; tableIndex <= tableCount; tableIndex += 1) {
    const table = await getCollectionItem(tables, tableIndex);
    const range = (await safeRead(() => table?.Range)) ?? (await safeRead(() => table?.range));
    const paragraphs = (await safeRead(() => range?.Paragraphs)) ?? (await safeRead(() => range?.paragraphs));
    if (paragraphs) contexts.push({ paragraphs });
  }

  return contexts;
}

async function collectStoryParagraphContexts(activeDocument: any): Promise<ParagraphCollectionContext[]> {
  const contexts: ParagraphCollectionContext[] = [];
  const storyRanges = (await safeRead(() => activeDocument?.StoryRanges)) ?? (await safeRead(() => activeDocument?.storyRanges));
  const storyCount = await getCollectionCount(storyRanges);
  if (storyRanges && Number.isFinite(storyCount) && storyCount > 0) {
    for (let storyIndex = 1; storyIndex <= storyCount; storyIndex += 1) {
      const storyRange = await getCollectionItem(storyRanges, storyIndex);
      const paragraphs = (await safeRead(() => storyRange?.Paragraphs)) ?? (await safeRead(() => storyRange?.paragraphs));
      if (paragraphs) contexts.push({ paragraphs });
    }
    return contexts;
  }

  let storyRange = storyRanges;
  let guard = 0;

  while (storyRange && guard < 64) {
    guard += 1;
    const paragraphs = (await safeRead(() => storyRange?.Paragraphs)) ?? (await safeRead(() => storyRange?.paragraphs));
    if (paragraphs) contexts.push({ paragraphs });

    storyRange =
      (await safeRead(() => storyRange?.NextStoryRange)) ??
      (await safeRead(() => storyRange?.nextStoryRange)) ??
      (await safeRead(() => storyRange?.NextStoryRange?.())) ??
      (await safeRead(() => storyRange?.nextStoryRange?.()));
  }

  return contexts;
}

async function collectShapeParagraphContexts(activeDocument: any): Promise<ParagraphCollectionContext[]> {
  const shapes = (await safeRead(() => activeDocument?.Shapes)) ?? (await safeRead(() => activeDocument?.shapes));
  const shapeCount = await getCollectionCount(shapes);
  if (!shapes || !Number.isFinite(shapeCount) || shapeCount <= 0) return [];

  const contexts: ParagraphCollectionContext[] = [];
  for (let shapeIndex = 1; shapeIndex <= shapeCount; shapeIndex += 1) {
    const shape = await getCollectionItem(shapes, shapeIndex);
    const textFrame = (await safeRead(() => shape?.TextFrame)) ?? (await safeRead(() => shape?.textFrame));
    const textRange =
      (await safeRead(() => textFrame?.TextRange)) ??
      (await safeRead(() => textFrame?.textRange)) ??
      (await safeRead(() => textFrame?.TextRange?.())) ??
      (await safeRead(() => textFrame?.textRange?.()));
    const paragraphs = (await safeRead(() => textRange?.Paragraphs)) ?? (await safeRead(() => textRange?.paragraphs));
    if (paragraphs) contexts.push({ paragraphs });
  }

  return contexts;
}

async function getDocumentParagraphEntries(activeDocument: any): Promise<CaptionParagraphEntry[]> {
  const contexts: ParagraphCollectionContext[] = [];
  const documentParagraphs = await safeRead(() => activeDocument?.Paragraphs);
  if (documentParagraphs) contexts.push({ paragraphs: documentParagraphs });

  contexts.push(...await collectTableParagraphContexts(activeDocument));
  contexts.push(...await collectStoryParagraphContexts(activeDocument));
  contexts.push(...await collectShapeParagraphContexts(activeDocument));

  const seenRanges = new Set<string>();
  const entries: CaptionParagraphEntry[] = [];
  for (const context of contexts) {
    entries.push(...await readParagraphEntriesFromCollection(context, seenRanges));
  }

  entries.sort((left, right) => left.start - right.start || left.paragraphIndex - right.paragraphIndex);
  return entries;
}

async function getBookmarkCollection(activeDocument: any): Promise<any | null> {
  return (await safeRead(() => activeDocument?.Bookmarks)) ?? null;
}

async function createDocumentRange(activeDocument: any, rangeStart: number, rangeEnd: number): Promise<any | null> {
  return (
    (await safeRead(() => activeDocument?.Range?.(rangeStart, rangeEnd))) ??
    (await safeRead(() => activeDocument?.range?.(rangeStart, rangeEnd))) ??
    null
  );
}

async function duplicateRange(range: any): Promise<any | null> {
  const duplicateValue = (await safeRead(() => range?.Duplicate)) ?? (await safeRead(() => range?.duplicate));
  if (duplicateValue && typeof duplicateValue !== "function") return duplicateValue;
  return (
    (await safeRead(() => range?.Duplicate?.())) ??
    (await safeRead(() => range?.duplicate?.())) ??
    null
  );
}

function buildCaptionReferenceFindTexts(expectedText: string): string[] {
  const normalized = normalizeCaptionReferenceResultText(expectedText);
  if (!normalized) return [];
  const candidates = new Set<string>([normalized]);
  if (/^[图表]/.test(normalized)) {
    candidates.add(`${normalized[0]} ${normalized.slice(1)}`);
  }
  candidates.add(normalized.replace(/([-.．—－‐‑‒–~～/])/g, " $1 "));
  if (/^[图表]/.test(normalized)) {
    candidates.add(`${normalized[0]} ${normalized.slice(1).replace(/([-.．—－‐‑‒–~～/])/g, " $1 ")}`);
  }
  return [...candidates].filter(Boolean);
}

async function executeFind(find: any, findText: string): Promise<boolean> {
  if (!find) return false;
  await safeWrite(() => {
    find.Text = findText;
  });
  await safeWrite(() => {
    find.Forward = true;
  });
  await safeWrite(() => {
    find.Wrap = 0;
  });

  return Boolean(
    (await safeRead(() => find?.Execute?.())) ??
    (await safeRead(() => find?.execute?.())) ??
    (await safeRead(() => find?.Execute?.(findText))) ??
    (await safeRead(() => find?.execute?.(findText))) ??
    (await safeRead(() => find?.Execute?.({ FindText: findText, Forward: true, Wrap: 0 }))) ??
    (await safeRead(() => find?.execute?.({ FindText: findText, Forward: true, Wrap: 0 }))) ??
    false
  );
}

async function getRangeFind(range: any): Promise<any | null> {
  return ((await safeRead(() => range?.Find)) ?? (await safeRead(() => range?.find))) || null;
}

async function getRangeFields(range: any): Promise<any | null> {
  return ((await readCallableOrValue(range, ["Fields", "fields"]))) || null;
}

async function getUsableRangeFields(primaryRange: any, fallbackRange?: any): Promise<any | null> {
  const primaryFields = await getRangeFields(primaryRange);
  if (primaryFields && (await getFieldCollectionCount(primaryFields)) > 0) return primaryFields;

  if (fallbackRange && fallbackRange !== primaryRange) {
    const fallbackFields = await getRangeFields(fallbackRange);
    if (fallbackFields && (await getFieldCollectionCount(fallbackFields)) > 0) return fallbackFields;
  }

  return null;
}

async function moveRangeBoundary(range: any, methodNames: string[], unit: number, count: number): Promise<boolean> {
  for (const methodName of methodNames) {
    const method = await safeRead(() => range?.[methodName]);
    if (typeof method !== "function") continue;
    if (await safeWrite(() => method.call(range, unit, count))) return true;
  }
  return false;
}

async function createRangeFromParentOffsets(parentRangeSource: any, startOffset: number, length: number): Promise<any | null> {
  if (!parentRangeSource || !Number.isFinite(startOffset) || !Number.isFinite(length) || startOffset < 0 || length <= 0) {
    return null;
  }

  const range = (await duplicateRange(parentRangeSource)) ?? parentRangeSource;
  if (!range) return null;

  const collapsed =
    (await safeWrite(() => range?.Collapse?.(WD_COLLAPSE_START))) ||
    (await safeWrite(() => range?.collapse?.(WD_COLLAPSE_START)));
  if (!collapsed) return null;

  const movedEnd = await moveRangeBoundary(range, ["MoveEnd", "moveEnd"], WD_CHARACTER, startOffset + length);
  const movedStart = await moveRangeBoundary(range, ["MoveStart", "moveStart"], WD_CHARACTER, startOffset);
  return movedEnd && movedStart ? range : null;
}

async function findCaptionReferenceRangeWithinRange(range: any, expectedText: string): Promise<any | null> {
  if (!range) return null;

  for (const findText of buildCaptionReferenceFindTexts(expectedText)) {
    const searchRange = (await duplicateRange(range)) ?? range;
    const find = await getRangeFind(searchRange);
    if (!find) continue;
    if (!(await executeFind(find, findText))) continue;

    const foundText = await readRangeText(searchRange);
    if (captionReferenceResultMatches(foundText, expectedText).matched) return searchRange;
  }

  const paragraphText = await readRangeText(range);
  const prefixDetails = extractCaptionReferencePrefixDetails(paragraphText);
  if (prefixDetails && normalizeCaptionReferenceResultText(prefixDetails.referenceText) === normalizeCaptionReferenceResultText(expectedText)) {
    const offsetRange = await createRangeFromParentOffsets(range, prefixDetails.referenceStartOffset, prefixDetails.referenceLength);
    if (await rangeMatchesExpectedText(offsetRange, expectedText)) return offsetRange;
  }

  return null;
}

async function findCaptionReferenceRangeInParagraph(
  activeDocument: any,
  paragraphRangeSource: any,
  paragraphStart: number,
  paragraphEnd: number,
  expectedText: string
): Promise<any | null> {
  if (!Number.isFinite(paragraphStart) || !Number.isFinite(paragraphEnd) || paragraphEnd <= paragraphStart) return null;
  let paragraphRange = (await duplicateRange(paragraphRangeSource)) ?? paragraphRangeSource ?? null;
  if (!paragraphRange) {
    paragraphRange = await createDocumentRange(activeDocument, paragraphStart, paragraphEnd);
  }
  if (!paragraphRange) return null;

  const paragraphResult = await findCaptionReferenceRangeWithinRange(paragraphRange, expectedText);
  if (paragraphResult) return paragraphResult;

  const fallbackRange = await createDocumentRange(activeDocument, paragraphStart, paragraphEnd);
  if (fallbackRange) return findCaptionReferenceRangeWithinRange(fallbackRange, expectedText);

  return null;
}

async function readRangeBoundary(range: any, propertyNames: string[]): Promise<number | null> {
  for (const propertyName of propertyNames) {
    const propertyValue = await safeRead(() => range?.[propertyName]);
    const value = typeof propertyValue === "function" ? await safeRead(() => propertyValue.call(range)) : propertyValue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
}

function isSafeCaptionReferenceFieldText(text: string): boolean {
  return Boolean(text) && normalizeCaptionReferenceResultText(text) === text;
}

function validateCaptionReferenceRangeParts(
  parts: CaptionReferenceRangePart[],
  expectedText: string
): CaptionReferenceRangePart[] {
  const joinedText = normalizeCaptionReferenceResultText(parts.map((part) => part.text).join(""));
  const expected = normalizeCaptionReferenceResultText(expectedText);
  if (!expected || joinedText !== expected) return [];
  if (!parts.some((part) => part.isField)) return [];
  if (!parts.every((part) => part.text && part.referenceEnd > part.referenceStart)) return [];
  if (!parts.every((part) => !part.isField || isSafeCaptionReferenceFieldText(part.text))) return [];
  return parts;
}

function alignCaptionFieldResultsToReferenceParts(
  fieldResults: CaptionReferenceFieldResultPart[],
  referenceStart: number,
  referenceEnd: number,
  expectedText: string
): CaptionReferenceRangePart[] {
  const expected = normalizeCaptionReferenceResultText(expectedText);
  if (!expected || referenceEnd <= referenceStart) return [];

  const parts: CaptionReferenceRangePart[] = [];
  let expectedCursor = 0;
  for (const fieldResult of fieldResults) {
    const fieldText = normalizeCaptionReferenceVisibleText(fieldResult.text);
    if (!isSafeCaptionReferenceFieldText(fieldText)) continue;

    const matchIndex = expected.indexOf(fieldText, expectedCursor);
    if (matchIndex < 0) continue;

    if (matchIndex > expectedCursor) {
      parts.push({
        text: expected.slice(expectedCursor, matchIndex),
        referenceStart: referenceStart + expectedCursor,
        referenceEnd: referenceStart + matchIndex,
        isField: false,
        fieldIndex: 0,
      });
    }

    const safeStart =
      fieldResult.referenceStart !== null &&
      fieldResult.referenceEnd !== null &&
      fieldResult.referenceEnd > fieldResult.referenceStart
        ? fieldResult.referenceStart
        : referenceStart + matchIndex;
    const safeEnd =
      fieldResult.referenceStart !== null &&
      fieldResult.referenceEnd !== null &&
      fieldResult.referenceEnd > fieldResult.referenceStart
        ? fieldResult.referenceEnd
        : referenceStart + matchIndex + fieldText.length;

    parts.push({
      text: fieldText,
      referenceStart: safeStart,
      referenceEnd: safeEnd,
      isField: true,
      fieldIndex: fieldResult.fieldIndex,
    });

    expectedCursor = matchIndex + fieldText.length;
    if (expectedCursor >= expected.length) break;
  }

  if (expectedCursor < expected.length) {
    parts.push({
      text: expected.slice(expectedCursor),
      referenceStart: referenceStart + expectedCursor,
      referenceEnd,
      isField: false,
      fieldIndex: 0,
    });
  }

  return validateCaptionReferenceRangeParts(parts, expectedText);
}

async function buildCaptionReferencePartsFromFields(
  paragraphRangeSource: any,
  paragraphStart: number,
  referenceStart: number,
  referenceEnd: number,
  expectedText: string
): Promise<CaptionReferenceRangePart[]> {
  const paragraphRange = (await duplicateRange(paragraphRangeSource)) ?? paragraphRangeSource ?? null;
  const fields = await getUsableRangeFields(paragraphRange, paragraphRangeSource);
  const fieldCount = await getFieldCollectionCount(fields);
  if (!fields || fieldCount <= 0) return [];

  const fieldParts: CaptionReferenceRangePart[] = [];
  const fieldResults: CaptionReferenceFieldResultPart[] = [];
  for (let fieldIndex = 1; fieldIndex <= fieldCount; fieldIndex += 1) {
    const field = await getFieldByIndex(fields, fieldIndex);
    const resultRange = await getFieldResultRange(field);
    const text = normalizeCaptionReferenceVisibleText(await readRangeText(resultRange));
    if (!text) continue;

    const start = await readRangeBoundary(resultRange, ["Start", "start"]);
    const end = await readRangeBoundary(resultRange, ["End", "end"]);
    fieldResults.push({ text, referenceStart: start, referenceEnd: end, fieldIndex });

    if (start === null || end === null || end <= start) continue;
    if (start < referenceStart || end > referenceEnd) continue;

    fieldParts.push({ text, referenceStart: start, referenceEnd: end, isField: true, fieldIndex });
  }

  fieldParts.sort((left, right) => left.referenceStart - right.referenceStart || (right.referenceEnd - left.referenceEnd));

  const selectedFieldParts: CaptionReferenceRangePart[] = [];
  let cursor = referenceStart;
  for (const part of fieldParts) {
    if (part.referenceStart < cursor) continue;
    if (part.referenceStart > cursor) {
      const literalRange = await createRangeFromParentOffsets(paragraphRange, cursor - paragraphStart, part.referenceStart - cursor);
      const literalText = normalizeCaptionReferenceVisibleText(await readRangeText(literalRange));
      if (literalText) {
        selectedFieldParts.push({
          text: literalText,
          referenceStart: cursor,
          referenceEnd: part.referenceStart,
          isField: false,
          fieldIndex: 0,
        });
      }
    }
    selectedFieldParts.push(part);
    cursor = part.referenceEnd;
  }

  if (cursor < referenceEnd) {
    const literalRange = await createRangeFromParentOffsets(paragraphRange, cursor - paragraphStart, referenceEnd - cursor);
    const literalText = normalizeCaptionReferenceVisibleText(await readRangeText(literalRange));
    if (literalText) {
      selectedFieldParts.push({
        text: literalText,
        referenceStart: cursor,
        referenceEnd,
        isField: false,
        fieldIndex: 0,
      });
    }
  }

  const validatedFieldRangeParts = validateCaptionReferenceRangeParts(selectedFieldParts, expectedText);
  if (validatedFieldRangeParts.length) return validatedFieldRangeParts;

  return alignCaptionFieldResultsToReferenceParts(fieldResults, referenceStart, referenceEnd, expectedText);
}

async function rangeMatchesExpectedText(range: any, expectedText: string): Promise<boolean> {
  if (!range) return false;
  return captionReferenceResultMatches(await readRangeText(range), expectedText).matched;
}

async function findCaptionReferenceRangeByFieldsInParagraph(
  activeDocument: any,
  paragraphRangeSource: any,
  paragraphStart: number,
  paragraphEnd: number,
  expectedText: string
): Promise<any | null> {
  const expected = normalizeCaptionReferenceResultText(expectedText);
  if (!expected || !/^[图表]/.test(expected)) return null;

  let paragraphRange = (await duplicateRange(paragraphRangeSource)) ?? paragraphRangeSource ?? null;
  let fields = await getUsableRangeFields(paragraphRange, paragraphRangeSource);
  if (!fields) {
    paragraphRange = await createDocumentRange(activeDocument, paragraphStart, paragraphEnd);
    fields = await getUsableRangeFields(paragraphRange);
  }
  const fieldCount = await getFieldCollectionCount(fields);
  if (!fields || fieldCount <= 0) return null;

  for (let fieldIndex = 1; fieldIndex <= fieldCount; fieldIndex += 1) {
    const firstField = await getFieldByIndex(fields, fieldIndex);
    const firstResultRange = await getFieldResultRange(firstField);
    const firstStart = await readRangeBoundary(firstResultRange, ["Start", "start"]);
    if (firstStart === null) continue;

    const prefixRange = await createDocumentRange(activeDocument, paragraphStart, firstStart);
    const prefixText = await readRangeText(prefixRange);
    const label = expected[0];
    const labelIndex = prefixText.lastIndexOf(label);
    if (labelIndex < 0) continue;
    const labelStart = firstStart - (prefixText.length - labelIndex);
    if (!Number.isFinite(labelStart) || labelStart < paragraphStart) continue;

    for (let lastFieldIndex = fieldIndex; lastFieldIndex <= fieldCount; lastFieldIndex += 1) {
      const lastField = await getFieldByIndex(fields, lastFieldIndex);
      const lastResultRange = await getFieldResultRange(lastField);
      const lastEnd = await readRangeBoundary(lastResultRange, ["End", "end"]);
      if (lastEnd === null || lastEnd <= labelStart) continue;

      const candidateRange = await createDocumentRange(activeDocument, labelStart, lastEnd);
      const candidateText = await readRangeText(candidateRange);
      if (captionReferenceResultMatches(candidateText, expected).matched) return candidateRange;
    }
  }

  return null;
}

async function resolvePreferredCaptionReferenceRange(
  activeDocument: any,
  referenceStart: number,
  referenceEnd: number,
  expectedText: string,
  paragraphStart: number,
  paragraphEnd: number,
  paragraphRange: any
): Promise<any | null> {
  const directRange = await createDocumentRange(activeDocument, referenceStart, referenceEnd);
  if (await rangeMatchesExpectedText(directRange, expectedText)) {
    return directRange;
  }

  const fieldAlignedRange = await findCaptionReferenceRangeByFieldsInParagraph(
    activeDocument,
    paragraphRange,
    paragraphStart,
    paragraphEnd,
    expectedText
  );
  if (await rangeMatchesExpectedText(fieldAlignedRange, expectedText)) {
    return fieldAlignedRange;
  }

  const foundRange = await findCaptionReferenceRangeInParagraph(
    activeDocument,
    paragraphRange,
    paragraphStart,
    paragraphEnd,
    expectedText
  );
  if (await rangeMatchesExpectedText(foundRange, expectedText)) {
    return foundRange;
  }

  return null;
}

async function getBookmarkByName(activeDocument: any, bookmarkName: string): Promise<any | null> {
  const bookmarks = await getBookmarkCollection(activeDocument);
  if (!bookmarks) return null;
  return (
    (await safeRead(() => bookmarks?.Item?.(bookmarkName))) ??
    (await safeRead(() => bookmarks?.item?.(bookmarkName))) ??
    (await safeRead(() => bookmarks?.[bookmarkName])) ??
    null
  );
}

async function readRangeText(range: any): Promise<string> {
  return String((await readCallableOrValue(range, ["Text", "text"])) ?? "");
}

async function getBookmarkRangeText(activeDocument: any, bookmarkName: string): Promise<string> {
  const bookmark = await getBookmarkByName(activeDocument, bookmarkName);
  const range = (await safeRead(() => bookmark?.Range)) ?? (await safeRead(() => bookmark?.range)) ?? null;
  return range ? readRangeText(range) : "";
}

async function readCallableOrValue(target: any, propertyNames: string[]): Promise<unknown> {
  if (!target) return null;
  for (const propertyName of propertyNames) {
    const value = await safeRead(() => target?.[propertyName]);
    if (value === null || value === undefined) continue;
    if (typeof value !== "function") return value;

    const calledValue = await safeRead(() => value.call(target));
    if (calledValue !== null && calledValue !== undefined) return calledValue;
  }
  return null;
}

async function bookmarkMatchesExpectedText(activeDocument: any, bookmarkName: string, expectedText: string): Promise<boolean> {
  const bookmarkText = await getBookmarkRangeText(activeDocument, bookmarkName);
  return captionReferenceResultMatches(bookmarkText, expectedText).matched;
}

async function addBookmarkAtRange(
  activeDocument: any,
  bookmarkName: string,
  referenceStart: number,
  referenceEnd: number,
  expectedText: string,
  paragraphStart: number,
  paragraphEnd: number,
  paragraphRange: any
): Promise<boolean> {
  const bookmarks = await getBookmarkCollection(activeDocument);
  if (!bookmarks) {
    throw new Error("当前文档不支持书签集合。");
  }

  const bookmarkRange = await resolvePreferredCaptionReferenceRange(
    activeDocument,
    referenceStart,
    referenceEnd,
    expectedText,
    paragraphStart,
    paragraphEnd,
    paragraphRange
  );
  if (!bookmarkRange) {
    const fallbackRange = await createDocumentRange(activeDocument, referenceStart, referenceEnd);
    const fallbackText = normalizeCaptionReferenceResultText(await readRangeText(fallbackRange));
    throw new Error(`书签“${bookmarkName}”范围不正确，当前范围文本为“${fallbackText || "空"}”。`);
  }

  const existingBookmark = await getBookmarkByName(activeDocument, bookmarkName);
  if (existingBookmark && await bookmarkMatchesExpectedText(activeDocument, bookmarkName, expectedText)) {
    return false;
  }

  if (existingBookmark) {
    await safeWrite(() => existingBookmark?.Delete?.());
    await safeWrite(() => existingBookmark?.delete?.());
  }

  const addAttempts = [
    () => bookmarks?.Add?.({ Name: bookmarkName, Range: bookmarkRange }),
    () => bookmarks?.Add?.(bookmarkName, bookmarkRange),
    () => bookmarks?.Add?.(bookmarkRange, bookmarkName),
  ];

  for (const attempt of addAttempts) {
    if (!(await safeWrite(attempt))) continue;
    if (await bookmarkMatchesExpectedText(activeDocument, bookmarkName, expectedText)) return true;
  }

  const bookmarkText = normalizeCaptionReferenceResultText(await getBookmarkRangeText(activeDocument, bookmarkName));
  throw new Error(`书签“${bookmarkName}”创建失败，当前书签文本为“${bookmarkText || "空"}”。`);
}

async function findCaptionReferenceFieldPartRange(
  paragraphRangeSource: any,
  part: CaptionReferencePart
): Promise<any | null> {
  if (!part.isField || !Number.isFinite(part.fieldIndex) || part.fieldIndex <= 0) return null;
  const paragraphRange = (await duplicateRange(paragraphRangeSource)) ?? paragraphRangeSource ?? null;
  const fields = await getUsableRangeFields(paragraphRange, paragraphRangeSource);
  if (!fields) return null;

  const field = await getFieldByIndex(fields, part.fieldIndex);
  const resultRange = await getFieldResultRange(field);
  if (!resultRange) return null;

  const extendedRange = (await duplicateRange(resultRange)) ?? null;
  if (extendedRange && await moveRangeBoundary(extendedRange, ["MoveEnd", "moveEnd"], WD_CHARACTER, 1)) {
    if (await rangeMatchesExpectedText(extendedRange, part.text)) return extendedRange;
  }

  return (await rangeMatchesExpectedText(resultRange, part.text)) ? resultRange : null;
}

async function addBookmarkForCaptionReferencePart(
  activeDocument: any,
  option: CaptionReferenceOption,
  part: CaptionReferencePart
): Promise<boolean> {
  const fieldPartRange = await findCaptionReferenceFieldPartRange(option.paragraphRange, part);
  if (fieldPartRange) {
    return addBookmarkAtResolvedRange(activeDocument, part.bookmarkName, fieldPartRange, part.text);
  }

  return addBookmarkAtRange(
    activeDocument,
    part.bookmarkName,
    part.referenceStart,
    part.referenceEnd,
    part.text,
    option.paragraphStart,
    option.paragraphEnd,
    option.paragraphRange
  );
}

async function addBookmarkAtResolvedRange(
  activeDocument: any,
  bookmarkName: string,
  bookmarkRange: any,
  expectedText: string
): Promise<boolean> {
  const bookmarks = await getBookmarkCollection(activeDocument);
  if (!bookmarks) {
    throw new Error("当前文档不支持书签集合。");
  }

  const existingBookmark = await getBookmarkByName(activeDocument, bookmarkName);
  if (existingBookmark && await bookmarkMatchesExpectedText(activeDocument, bookmarkName, expectedText)) {
    return false;
  }

  if (existingBookmark) {
    await safeWrite(() => existingBookmark?.Delete?.());
    await safeWrite(() => existingBookmark?.delete?.());
  }

  const addAttempts = [
    () => bookmarks?.Add?.({ Name: bookmarkName, Range: bookmarkRange }),
    () => bookmarks?.Add?.(bookmarkName, bookmarkRange),
    () => bookmarks?.Add?.(bookmarkRange, bookmarkName),
  ];

  for (const attempt of addAttempts) {
    if (!(await safeWrite(attempt))) continue;
    if (await bookmarkMatchesExpectedText(activeDocument, bookmarkName, expectedText)) return true;
  }

  const bookmarkText = normalizeCaptionReferenceResultText(await getBookmarkRangeText(activeDocument, bookmarkName));
  throw new Error(`书签“${bookmarkName}”创建失败，当前书签文本为“${bookmarkText || "空"}”。`);
}

function cleanupCaptionParagraphText(value: unknown): string {
  return normalizeCaptionReferenceVisibleText(String(value || ""));
}

async function getAllCaptionReferenceOptions(activeDocument: any): Promise<CaptionReferenceScanResult> {
  const entries = await getDocumentParagraphEntries(activeDocument);
  const result: CaptionReferenceScanResult = { figures: [], tables: [] };
  if (!entries.length) return result;

  let figureIndex = 0;
  let tableIndex = 0;

  for (const entry of entries) {
    const trimmedText = cleanupCaptionParagraphText(entry.text).trim();
    if (!trimmedText) continue;

    const referenceMatch = extractCaptionReferencePrefixDetails(entry.rawText);
    if (!referenceMatch) continue;

    const referenceText = referenceMatch.referenceText;
    const kind: CaptionReferenceType | null = captionReferenceMatchesKind(referenceText, "figure")
      ? "figure"
      : captionReferenceMatchesKind(referenceText, "table")
        ? "table"
        : null;
    if (!kind) continue;

    const referenceStart = entry.start + referenceMatch.referenceStartOffset;
    const referenceEnd = referenceStart + referenceMatch.referenceLength;
    if (referenceEnd <= referenceStart) continue;

    const index = kind === "figure" ? figureIndex + 1 : tableIndex + 1;
    if (kind === "figure") figureIndex = index;
    if (kind === "table") tableIndex = index;

    const bookmarkName = buildCaptionReferenceBookmarkName(kind, index);
    const rawReferenceRangeParts = referenceMatch.referenceParts.map((part) => ({
      text: part.text,
      referenceStart: entry.start + part.referenceStartOffset,
      referenceEnd: entry.start + part.referenceStartOffset + part.referenceLength,
      isField: part.isField,
      fieldIndex: part.fieldIndex,
    }));
    const fieldReferenceRangeParts = await buildCaptionReferencePartsFromFields(
      entry.range,
      entry.start,
      referenceStart,
      referenceEnd,
      referenceText
    );
    const referencePartsAreFieldBacked = fieldReferenceRangeParts.length > 0;
    const referenceParts = toCaptionReferenceParts(
      bookmarkName,
      referencePartsAreFieldBacked ? fieldReferenceRangeParts : rawReferenceRangeParts
    );
    const option = {
      index,
      kind,
      captionText: trimmedText,
      referenceText,
      bookmarkName,
      referenceParts,
      referencePartsAreFieldBacked,
      searchText: normalizeCaptionReferenceSearchText([trimmedText, referenceText, bookmarkName].join(" ")),
      referenceStart,
      referenceEnd,
      paragraphStart: entry.start,
      paragraphEnd: entry.end,
      paragraphIndex: entry.paragraphIndex,
      paragraphRange: entry.range,
    };
    if (kind === "figure") result.figures.push(option);
    if (kind === "table") result.tables.push(option);
  }

  return result;
}

async function getCaptionReferenceOptions(activeDocument: any, kind: CaptionReferenceType): Promise<CaptionReferenceOption[]> {
  const result = await getAllCaptionReferenceOptions(activeDocument);
  return kind === "figure" ? result.figures : result.tables;
}

async function readFirstAvailableProperty(target: any, propertyNames: string[]): Promise<unknown> {
  for (const name of propertyNames) {
    const value = await safeRead(() => target?.[name]);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

async function getRangeFont(range: any): Promise<any | null> {
  return ((await safeRead(() => range?.Font)) ?? (await safeRead(() => range?.font))) || null;
}

async function setFirstWritableProperty(target: any, propertyNames: string[], value: unknown): Promise<boolean> {
  if (!target || value === null || value === undefined) return false;
  for (const name of propertyNames) {
    try {
      target[name] = value;
      return true;
    } catch {
      // Try next property name.
    }
  }
  return false;
}

async function copyRangeFontFormatting(sourceRange: any, targetRange: any): Promise<boolean> {
  const sourceFont = await getRangeFont(sourceRange);
  const targetFont = await getRangeFont(targetRange);
  if (!sourceFont || !targetFont) return false;

  const propertyGroups: Array<{ source: string[]; target: string[] }> = [
    { source: ["NameFarEast", "NameFarEastBi", "nameFarEast"], target: ["NameFarEast", "NameFarEastBi", "nameFarEast"] },
    { source: ["NameAscii", "nameAscii"], target: ["NameAscii", "nameAscii"] },
    { source: ["Name", "name"], target: ["Name", "name"] },
    { source: ["NameBi", "nameBi"], target: ["NameBi", "nameBi"] },
    { source: ["NameOther", "nameOther", "NameComplexScript", "nameComplexScript"], target: ["NameOther", "nameOther", "NameComplexScript", "nameComplexScript"] },
    { source: ["Size", "size"], target: ["Size", "size"] },
    { source: ["Bold", "bold"], target: ["Bold", "bold"] },
    { source: ["Italic", "italic"], target: ["Italic", "italic"] },
    { source: ["Underline", "underline"], target: ["Underline", "underline"] },
    { source: ["StrikeThrough", "strikeThrough"], target: ["StrikeThrough", "strikeThrough"] },
    { source: ["DoubleStrikeThrough", "doubleStrikeThrough"], target: ["DoubleStrikeThrough", "doubleStrikeThrough"] },
    { source: ["Hidden", "hidden"], target: ["Hidden", "hidden"] },
    { source: ["AllCaps", "allCaps"], target: ["AllCaps", "allCaps"] },
    { source: ["SmallCaps", "smallCaps"], target: ["SmallCaps", "smallCaps"] },
    { source: ["Superscript", "superscript"], target: ["Superscript", "superscript"] },
    { source: ["Subscript", "subscript"], target: ["Subscript", "subscript"] },
    { source: ["Outline", "outline"], target: ["Outline", "outline"] },
    { source: ["Shadow", "shadow"], target: ["Shadow", "shadow"] },
    { source: ["Emboss", "emboss"], target: ["Emboss", "emboss"] },
    { source: ["Engrave", "engrave"], target: ["Engrave", "engrave"] },
    { source: ["Kerning", "kerning"], target: ["Kerning", "kerning"] },
    { source: ["Spacing", "spacing"], target: ["Spacing", "spacing"] },
    { source: ["Scaling", "scaling"], target: ["Scaling", "scaling"] },
    { source: ["Position", "position"], target: ["Position", "position"] },
    { source: ["Animation", "animation"], target: ["Animation", "animation"] },
  ];

  let updated = false;
  for (const group of propertyGroups) {
    const value = await readFirstAvailableProperty(sourceFont, group.source);
    if (value === null || value === undefined) continue;
    if (await setFirstWritableProperty(targetFont, group.target, value)) updated = true;
  }

  const colorValue = await readFirstAvailableProperty(sourceFont, ["Color", "color"]);
  if (colorValue !== null && colorValue !== undefined) {
    if (await setFirstWritableProperty(targetFont, ["Color", "color"], colorValue)) updated = true;
    const sourceTextColor = (await safeRead(() => sourceFont?.TextColor)) ?? (await safeRead(() => sourceFont?.textColor));
    const targetTextColor = (await safeRead(() => targetFont?.TextColor)) ?? (await safeRead(() => targetFont?.textColor));
    const textColorValue = (await safeRead(() => sourceTextColor?.RGB)) ?? (await safeRead(() => sourceTextColor?.rgb));
    if (targetTextColor && textColorValue !== null && textColorValue !== undefined) {
      if (await setFirstWritableProperty(targetTextColor, ["RGB", "rgb"], textColorValue)) updated = true;
    }
  }

  return updated;
}

async function getFieldResultRange(field: any): Promise<any | null> {
  return ((await readCallableOrValue(field, ["Result", "result"]))) || null;
}

async function getFieldCodeRange(field: any): Promise<any | null> {
  return ((await readCallableOrValue(field, ["Code", "code"]))) || null;
}

async function deleteField(field: any): Promise<void> {
  await safeWrite(() => field?.Delete?.());
  await safeWrite(() => field?.delete?.());
}

async function getFieldCollectionCount(fields: any): Promise<number> {
  const count = Number(
    (await readCallableOrValue(fields, ["Count", "count", "Length", "length"])) ??
    0
  );
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

async function getFieldByIndex(fields: any, index: number): Promise<any | null> {
  return (
    (await safeRead(() => fields?.Item?.(index))) ??
    (await safeRead(() => fields?.item?.(index))) ??
    (await safeRead(() => fields?.Item?.(index - 1))) ??
    (await safeRead(() => fields?.item?.(index - 1))) ??
    (await safeRead(() => fields?.[index - 1])) ??
    (await safeRead(() => fields?.[index])) ??
    null
  );
}

async function getLatestField(fields: any): Promise<any | null> {
  const count = await getFieldCollectionCount(fields);
  if (!Number.isFinite(count) || count <= 0) return null;
  return getFieldByIndex(fields, count);
}

async function getFirstAvailableFieldCollection(targets: any[]): Promise<any | null> {
  for (const target of targets) {
    const fields = await readCallableOrValue(target, ["Fields", "fields"]);
    if (fields) return fields;
  }
  return null;
}

async function readFieldResultText(field: any): Promise<string> {
  const resultRange = await getFieldResultRange(field);
  return resultRange ? readRangeText(resultRange) : "";
}

async function readFieldCodeText(field: any): Promise<string> {
  const codeRange = await getFieldCodeRange(field);
  return codeRange ? readRangeText(codeRange) : "";
}

async function ensureCaptionReferenceFieldCharFormat(field: any, bookmarkName: string): Promise<boolean> {
  const codeRange = await getFieldCodeRange(field);
  if (!codeRange) return false;

  const currentCodeText = await readRangeText(codeRange);
  const nextCodeText = buildCaptionReferenceFieldCodeText(bookmarkName, currentCodeText);
  if (!nextCodeText) return false;

  const currentNormalized = String(currentCodeText || "").replace(/\s+/g, " ").trim();
  const nextNormalized = nextCodeText.replace(/\s+/g, " ").trim();
  if (currentNormalized === nextNormalized) return true;

  return safeWrite(() => {
    codeRange.Text = nextCodeText;
  });
}

async function setRangeFontSize(range: any, fontSize: number): Promise<boolean> {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return false;
  const font = await getRangeFont(range);
  if (!font) return false;
  return setFirstWritableProperty(font, ["Size", "size"], fontSize);
}

async function validateInsertedField(
  field: any,
  expectedText: string
): Promise<CaptionReferenceInsertAttemptResult> {
  if (!(await safeWrite(() => field?.Update?.()))) {
    await safeWrite(() => field?.update?.());
  }

  const resultText = await readFieldResultText(field);
  return captionReferenceResultMatches(resultText, expectedText);
}

async function validateAndStyleInsertedField(
  field: any,
  expectedText: string,
  bookmarkName: string,
  styleSourceRange: any
): Promise<boolean> {
  await ensureCaptionReferenceFieldCharFormat(field, bookmarkName);
  const codeRange = await getFieldCodeRange(field);
  if (codeRange) await copyRangeFontFormatting(styleSourceRange, codeRange);

  const validation = await validateInsertedField(field, expectedText);
  if (!validation.matched) {
    await deleteField(field);
    return false;
  }

  const insertedRange = await getFieldResultRange(field);
  if (insertedRange) await copyRangeFontFormatting(styleSourceRange, insertedRange);
  if (codeRange) await copyRangeFontFormatting(styleSourceRange, codeRange);
  return true;
}

async function resolveInsertedFieldCandidate(
  explicitResult: any,
  fields: any,
  fieldCountIncreased: boolean
): Promise<any | null> {
  if (explicitResult && (await getFieldResultRange(explicitResult))) return explicitResult;
  if (!fieldCountIncreased) return null;
  return getLatestField(fields);
}

async function tryInsertFieldReference(
  activeDocument: any,
  selection: any,
  selectionRange: any,
  bookmarkName: string,
  expectedText: string,
  styleSourceRange: any
): Promise<boolean> {
  const fields = await getFirstAvailableFieldCollection([selectionRange, selection, activeDocument]);
  if (!fields) return false;

  const fieldCandidates = [
    { type: WD_FIELD_EMPTY, text: buildCaptionReferenceFieldCodeText(bookmarkName) },
    { type: WD_FIELD_REF, text: bookmarkName },
  ];

  for (const fieldCandidate of fieldCandidates) {
    const addAttempts = [
      () => fields?.Add?.(selectionRange, fieldCandidate.type, fieldCandidate.text, false),
      () => fields?.Add?.({ Range: selectionRange, Type: fieldCandidate.type, Text: fieldCandidate.text, PreserveFormatting: false }),
    ];

    for (const attempt of addAttempts) {
      try {
        const beforeAddFieldCount = await getFieldCollectionCount(fields);
        const fieldResult = await attempt();
        const afterAddFieldCount = await getFieldCollectionCount(fields);
        const insertedField = await resolveInsertedFieldCandidate(fieldResult, fields, afterAddFieldCount > beforeAddFieldCount);
        if (!insertedField) continue;
        if (await validateAndStyleInsertedField(insertedField, expectedText, bookmarkName, styleSourceRange)) return true;
      } catch {
        // Try the next insertion shape.
      }
    }
  }

  return false;
}

async function tryInsertBookmarkCrossReference(
  activeDocument: any,
  selection: any,
  selectionRange: any,
  bookmarkName: string,
  expectedText: string,
  styleSourceRange: any
): Promise<boolean> {
  const referenceType = WD_REFERENCE_TYPE_BOOKMARK;
  const referenceKind = WD_REFERENCE_KIND_CONTENT_TEXT;
  const fields = await getFirstAvailableFieldCollection([selectionRange, selection, activeDocument]);
  if (!fields) return false;

  const attempts = [
    () => selection?.InsertCrossReference?.(referenceType, referenceKind, bookmarkName, false, false),
    () => selectionRange?.InsertCrossReference?.(referenceType, referenceKind, bookmarkName, false, false),
    () =>
      selection?.InsertCrossReference?.({
        ReferenceType: referenceType,
        ReferenceKind: referenceKind,
        ReferenceItem: bookmarkName,
        InsertAsHyperlink: false,
        IncludePosition: false,
      }),
    () =>
      selectionRange?.InsertCrossReference?.({
        ReferenceType: referenceType,
        ReferenceKind: referenceKind,
        ReferenceItem: bookmarkName,
        InsertAsHyperlink: false,
        IncludePosition: false,
      }),
  ];

  for (const attempt of attempts) {
    try {
      const beforeAddFieldCount = await getFieldCollectionCount(fields);
      const attemptResult = await attempt();
      const afterAddFieldCount = await getFieldCollectionCount(fields);
      const insertedField = await resolveInsertedFieldCandidate(attemptResult, fields, afterAddFieldCount > beforeAddFieldCount);
      if (!insertedField) continue;

      if (await validateAndStyleInsertedField(insertedField, expectedText, bookmarkName, styleSourceRange)) return true;
    } catch {
      // Try the next insertion shape.
    }
  }

  return false;
}

async function createReusableRange(parentRange: any): Promise<any | null> {
  return duplicateRange(parentRange);
}

function shouldInsertCaptionReferenceAsParts(option: CaptionReferenceOption): boolean {
  if (!option.referencePartsAreFieldBacked) return false;
  if (!Array.isArray(option.referenceParts) || option.referenceParts.length <= 1) return false;
  if (!option.referenceParts.some((part) => part.isField)) return false;
  if (!option.referenceParts.every((part) => part.text && part.referenceEnd > part.referenceStart)) return false;
  if (!option.referenceParts.every((part) => !part.isField || isSafeCaptionReferenceFieldText(part.text))) return false;
  return normalizeCaptionReferenceResultText(option.referenceParts.map((part) => part.text).join("")) === normalizeCaptionReferenceResultText(option.referenceText);
}

async function insertLiteralCaptionReferencePart(selection: any, text: string): Promise<boolean> {
  if (!text) return true;
  if (await safeWrite(() => selection?.TypeText?.(text))) return true;
  if (await safeWrite(() => selection?.typeText?.(text))) return true;

  const selectionRange = await safeRead(() => selection?.Range);
  if (!selectionRange) return false;
  if (await safeWrite(() => {
    selectionRange.Text = text;
  })) {
    await safeWrite(() => selectionRange?.Collapse?.(0));
    await safeWrite(() => selectionRange?.collapse?.(0));
    return true;
  }
  return false;
}

async function insertCaptionReferenceField(
  app: any,
  bookmarkName: string,
  expectedText: string
): Promise<boolean> {
  const activeDocument = await getDocument(app);
  const selection = await getSelection(app);
  const selectionRange = await selection?.Range;
  if (!selectionRange) {
    throw new Error("未找到可用插入位置。");
  }

  await safeWrite(() => selectionRange?.Collapse?.(0));
  await safeWrite(() => selectionRange?.collapse?.(0));

  const styleSourceRange = (await createReusableRange(selectionRange)) ?? selectionRange;

  const fieldInserted = await tryInsertFieldReference(activeDocument, selection, selectionRange, bookmarkName, expectedText, styleSourceRange);
  if (fieldInserted) return true;

  return await tryInsertBookmarkCrossReference(activeDocument, selection, selectionRange, bookmarkName, expectedText, styleSourceRange);
}

async function insertCaptionReferenceParts(
  app: any,
  option: CaptionReferenceOption
): Promise<boolean> {
  const activeDocument = await getDocument(app);
  const selection = await getSelection(app);
  const initialSelectionRange = await selection?.Range;
  if (!initialSelectionRange) {
    throw new Error("未找到可用插入位置。");
  }

  await safeWrite(() => initialSelectionRange?.Collapse?.(0));
  await safeWrite(() => initialSelectionRange?.collapse?.(0));

  const styleSourceRange = (await createReusableRange(initialSelectionRange)) ?? initialSelectionRange;

  for (const part of option.referenceParts) {
    if (!part.isField) {
      if (!(await insertLiteralCaptionReferencePart(selection, part.text))) return false;
      continue;
    }

    const selectionRange = await selection?.Range;
    if (!selectionRange) return false;
    await safeWrite(() => selectionRange?.Collapse?.(0));
    await safeWrite(() => selectionRange?.collapse?.(0));
    if (!(await tryInsertFieldReference(activeDocument, selection, selectionRange, part.bookmarkName, part.text, styleSourceRange))) {
      return false;
    }
  }

  return true;
}

export async function listCaptionReferenceOptions(app: any, kind: CaptionReferenceType): Promise<CaptionReferenceOption[]> {
  const activeDocument = await getDocument(app);
  return getCaptionReferenceOptions(activeDocument, kind);
}

export async function listAllCaptionReferenceOptions(app: any): Promise<CaptionReferenceScanResult> {
  const activeDocument = await getDocument(app);
  return getAllCaptionReferenceOptions(activeDocument);
}

export async function insertCaptionReferenceOption(
  app: any,
  option: CaptionReferenceOption
): Promise<CaptionReferenceInsertResult> {
  if (!option || !Number.isFinite(option.index) || option.index <= 0) {
    throw new Error("请选择有效的题注序号。");
  }

  const activeDocument = await getDocument(app);
  if (shouldInsertCaptionReferenceAsParts(option)) {
    let bookmarkCreated = false;
    for (const part of option.referenceParts) {
      if (!part.isField) continue;
      const partBookmarkCreated = await addBookmarkForCaptionReferencePart(activeDocument, option, part);
      bookmarkCreated = bookmarkCreated || partBookmarkCreated;
    }

    const inserted = await insertCaptionReferenceParts(app, option);
    if (!inserted) {
      throw new Error("交叉引用插入失败，当前 WPS 环境可能不支持分段 REF 域。");
    }

    return {
      option,
      bookmarkCreated,
      mode: "parts",
    };
  }

  const bookmarkCreated = await addBookmarkAtRange(
    activeDocument,
    option.bookmarkName,
    option.referenceStart,
    option.referenceEnd,
    option.referenceText,
    option.paragraphStart,
    option.paragraphEnd,
    option.paragraphRange
  );
  const inserted = await insertCaptionReferenceField(app, option.bookmarkName, option.referenceText);
  if (!inserted) {
    throw new Error("交叉引用插入失败，当前 WPS 环境可能不支持 REF 域。");
  }

  return {
    option,
    bookmarkCreated,
    mode: "single",
  };
}

export async function insertCaptionReference(
  app: any,
  kind: CaptionReferenceType,
  index: number
): Promise<CaptionReferenceInsertResult> {
  if (!Number.isFinite(index) || index <= 0) {
    throw new Error("请选择有效的题注序号。");
  }

  const activeDocument = await getDocument(app);
  const options = await getCaptionReferenceOptions(activeDocument, kind);
  const option = options[index - 1];
  if (!option) {
    throw new Error("未找到对应题注，请重新扫描。");
  }

  return insertCaptionReferenceOption(app, option);
}

async function applyCaptionReferenceFontSizeInDocument(
  activeDocument: any,
  kind: CaptionReferenceType,
  fontSize: number
): Promise<CaptionReferenceFontSizeResult> {
  const normalizedFontSize = Number(fontSize);
  if (!Number.isFinite(normalizedFontSize) || normalizedFontSize <= 0) {
    throw new Error("请输入有效的字号。");
  }

  const fields = await getFirstAvailableFieldCollection([activeDocument]);
  if (!fields) {
    return { kind, fontSize: normalizedFontSize, matched: 0, updated: 0 };
  }

  const fieldCount = await getFieldCollectionCount(fields);
  let matched = 0;
  let updated = 0;

  for (let index = 1; index <= fieldCount; index += 1) {
    const field = await getFieldByIndex(fields, index);
    if (!field) continue;

    const bookmarkName = extractCaptionReferenceBookmarkNameFromFieldCode(await readFieldCodeText(field));
    if (!isCaptionReferenceBookmarkName(bookmarkName, kind)) continue;

    matched += 1;
    await ensureCaptionReferenceFieldCharFormat(field, bookmarkName);
    const codeRange = await getFieldCodeRange(field);
    if (codeRange) await setRangeFontSize(codeRange, normalizedFontSize);

    await safeWrite(() => field?.Update?.());
    await safeWrite(() => field?.update?.());

    const resultRange = await getFieldResultRange(field);
    if (!resultRange) continue;
    if (await setRangeFontSize(resultRange, normalizedFontSize)) updated += 1;
  }

  return {
    kind,
    fontSize: normalizedFontSize,
    matched,
    updated,
  };
}

export async function applyCaptionReferenceFontSize(
  app: any,
  kind: CaptionReferenceType,
  fontSize: number
): Promise<CaptionReferenceFontSizeResult> {
  const normalizedFontSize = Number(fontSize);
  if (!Number.isFinite(normalizedFontSize) || normalizedFontSize <= 0) {
    throw new Error("请输入有效的字号。");
  }

  const activeDocument = await getDocument(app);
  return applyCaptionReferenceFontSizeInDocument(activeDocument, kind, normalizedFontSize);
}

export async function applyAllCaptionReferenceFontSize(
  app: any,
  fontSize: number
): Promise<CaptionReferenceFontSizeBatchResult> {
  const normalizedFontSize = Number(fontSize);
  if (!Number.isFinite(normalizedFontSize) || normalizedFontSize <= 0) {
    throw new Error("请输入有效的字号。");
  }

  const activeDocument = await getDocument(app);
  const figures = await applyCaptionReferenceFontSizeInDocument(activeDocument, "figure", normalizedFontSize);
  const tables = await applyCaptionReferenceFontSizeInDocument(activeDocument, "table", normalizedFontSize);

  return {
    fontSize: normalizedFontSize,
    totalMatched: figures.matched + tables.matched,
    totalUpdated: figures.updated + tables.updated,
    figures,
    tables,
  };
}
