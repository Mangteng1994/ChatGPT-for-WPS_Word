import type {
  RawFontInfo,
  RawNumberingInfo,
  RawParagraphInfo,
  RawParagraphStyleSnapshot,
  RawSelectionStyleSnapshot,
  RawStyleInfo,
} from "./style-inspector-types";

function normalizeText(value: unknown): string {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u0007/g, "")
    .trim();
}

function toFiniteNumber(value: unknown): number | null {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) return null;
  return resolved;
}

async function safeRead<T>(factory: () => Promise<T> | T): Promise<T | null> {
  try {
    return await factory();
  } catch {
    return null;
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
  const activeDocument = await getDocument(app);
  const activeWindow = await activeDocument?.ActiveWindow;
  const selection = (await activeWindow?.Selection) || (await app?.Selection);
  if (!selection) {
    throw new Error("未找到可用选区，请先激活文档窗口。");
  }
  return selection;
}

async function getParagraphCollection(range: any): Promise<any[]> {
  const paragraphs = await safeRead(() => range?.Paragraphs);
  if (!paragraphs) return [];
  const count = Number((await safeRead(() => paragraphs?.Count)) || 0);
  if (!Number.isFinite(count) || count <= 0) return [];

  const items: any[] = [];
  for (let index = 1; index <= count; index += 1) {
    const item =
      (await safeRead(() => paragraphs?.Item?.(index))) ??
      (await safeRead(() => paragraphs?.item?.(index))) ??
      (await safeRead(() => paragraphs?.[index]));
    if (item) items.push(item);
  }
  return items;
}

async function resolveStyleObject(activeDocument: any, styleRef: any): Promise<any | null> {
  if (styleRef && typeof styleRef === "object") return styleRef;
  if (typeof styleRef !== "string") return null;
  const styleName = normalizeText(styleRef);
  if (!styleName) return null;
  return (
    (await safeRead(() => activeDocument?.Styles?.Item?.(styleName))) ??
    (await safeRead(() => activeDocument?.Styles?.item?.(styleName))) ??
    (await safeRead(() => activeDocument?.Styles?.[styleName])) ??
    null
  );
}

async function resolveStyleName(styleRef: any): Promise<string | null> {
  if (typeof styleRef === "string") {
    const text = normalizeText(styleRef);
    return text || null;
  }
  if (!styleRef || typeof styleRef !== "object") return null;
  const name =
    normalizeText(await safeRead(() => styleRef?.NameLocal)) ||
    normalizeText(await safeRead(() => styleRef?.Name)) ||
    normalizeText(await safeRead(() => styleRef?.nameLocal)) ||
    normalizeText(await safeRead(() => styleRef?.name));
  return name || null;
}

async function resolveBasedOnStyleName(styleObject: any): Promise<string | null | "unknown"> {
  if (!styleObject) return "unknown";
  const baseStyleRef = (await safeRead(() => styleObject?.BaseStyle)) ?? (await safeRead(() => styleObject?.baseStyle));
  if (baseStyleRef === null || baseStyleRef === undefined) return "unknown";
  const baseStyleName = await resolveStyleName(baseStyleRef);
  if (baseStyleName) return baseStyleName;
  if (typeof baseStyleRef === "string") {
    const text = normalizeText(baseStyleRef);
    return text || null;
  }
  return "unknown";
}

async function readFontInfo(fontSource: any): Promise<RawFontInfo> {
  const font = (await safeRead(() => fontSource?.Font)) ?? (await safeRead(() => fontSource?.font));
  if (!font) {
    return {
      eastAsia: null,
      ascii: null,
      hAnsi: null,
      cs: null,
      sizePt: null,
      bold: null,
      italic: null,
      color: null,
      underline: null,
      strikeThrough: null,
      doubleStrikeThrough: null,
    };
  }

  const colorValue =
    (await safeRead(() => font?.Color)) ??
    (await safeRead(() => font?.color)) ??
    (await safeRead(() => font?.TextColor?.RGB)) ??
    (await safeRead(() => font?.textColor?.rgb));

  return {
    eastAsia:
      normalizeText(await safeRead(() => font?.NameFarEast)) ||
      normalizeText(await safeRead(() => font?.NameFarEastBi)) ||
      normalizeText(await safeRead(() => font?.nameFarEast)) ||
      null,
    ascii: normalizeText(await safeRead(() => font?.NameAscii)) || normalizeText(await safeRead(() => font?.nameAscii)) || null,
    hAnsi:
      normalizeText(await safeRead(() => font?.NameOther)) ||
      normalizeText(await safeRead(() => font?.nameOther)) ||
      normalizeText(await safeRead(() => font?.Name)) ||
      normalizeText(await safeRead(() => font?.name)) ||
      null,
    cs:
      normalizeText(await safeRead(() => font?.NameBi)) ||
      normalizeText(await safeRead(() => font?.nameBi)) ||
      normalizeText(await safeRead(() => font?.NameComplexScript)) ||
      normalizeText(await safeRead(() => font?.nameComplexScript)) ||
      null,
    sizePt: toFiniteNumber((await safeRead(() => font?.Size)) ?? (await safeRead(() => font?.size))),
    bold: (await safeRead(() => font?.Bold)) ?? (await safeRead(() => font?.bold)),
    italic: (await safeRead(() => font?.Italic)) ?? (await safeRead(() => font?.italic)),
    color: (colorValue as number | string | null) ?? null,
    underline: (await safeRead(() => font?.Underline)) ?? (await safeRead(() => font?.underline)),
    strikeThrough: (await safeRead(() => font?.StrikeThrough)) ?? (await safeRead(() => font?.strikeThrough)),
    doubleStrikeThrough:
      (await safeRead(() => font?.DoubleStrikeThrough)) ?? (await safeRead(() => font?.doubleStrikeThrough)),
  };
}

async function readParagraphInfo(paragraphRange: any): Promise<RawParagraphInfo> {
  const paragraphFormat =
    (await safeRead(() => paragraphRange?.ParagraphFormat)) ??
    (await safeRead(() => paragraphRange?.paragraphFormat)) ??
    (await safeRead(() => paragraphRange?.Paragraphs?.Item?.(1)?.Range?.ParagraphFormat));

  if (!paragraphFormat) {
    return {
      lineSpacingRule: null,
      lineSpacing: null,
      beforePt: null,
      afterPt: null,
      leftIndent: null,
      rightIndent: null,
      firstLineIndent: null,
      firstLineIndentChars: null,
      alignment: null,
      snapToGrid: null,
    };
  }

  return {
    lineSpacingRule: toFiniteNumber((await safeRead(() => paragraphFormat?.LineSpacingRule)) ?? (await safeRead(() => paragraphFormat?.lineSpacingRule))),
    lineSpacing: toFiniteNumber((await safeRead(() => paragraphFormat?.LineSpacing)) ?? (await safeRead(() => paragraphFormat?.lineSpacing))),
    beforePt: toFiniteNumber((await safeRead(() => paragraphFormat?.SpaceBefore)) ?? (await safeRead(() => paragraphFormat?.spaceBefore))),
    afterPt: toFiniteNumber((await safeRead(() => paragraphFormat?.SpaceAfter)) ?? (await safeRead(() => paragraphFormat?.spaceAfter))),
    leftIndent: toFiniteNumber((await safeRead(() => paragraphFormat?.LeftIndent)) ?? (await safeRead(() => paragraphFormat?.leftIndent))),
    rightIndent: toFiniteNumber((await safeRead(() => paragraphFormat?.RightIndent)) ?? (await safeRead(() => paragraphFormat?.rightIndent))),
    firstLineIndent: toFiniteNumber(
      (await safeRead(() => paragraphFormat?.FirstLineIndent)) ?? (await safeRead(() => paragraphFormat?.firstLineIndent))
    ),
    firstLineIndentChars: toFiniteNumber(
      (await safeRead(() => paragraphFormat?.CharacterUnitFirstLineIndent)) ??
        (await safeRead(() => paragraphFormat?.characterUnitFirstLineIndent))
    ),
    alignment: toFiniteNumber((await safeRead(() => paragraphFormat?.Alignment)) ?? (await safeRead(() => paragraphFormat?.alignment))),
    snapToGrid: (await safeRead(() => paragraphFormat?.SnapToGrid)) ?? (await safeRead(() => paragraphFormat?.snapToGrid)),
  };
}

async function resolveListLevel(listFormat: any, level: number | null): Promise<any | null> {
  const directListLevel = (await safeRead(() => listFormat?.ListLevel)) ?? (await safeRead(() => listFormat?.listLevel));
  if (directListLevel) return directListLevel;
  if (!level || level <= 0) return null;

  const listTemplate = (await safeRead(() => listFormat?.ListTemplate)) ?? (await safeRead(() => listFormat?.listTemplate));
  if (!listTemplate) return null;

  const listLevels = (await safeRead(() => listTemplate?.ListLevels)) ?? (await safeRead(() => listTemplate?.listLevels));
  if (!listLevels) return null;

  return (
    (await safeRead(() => listLevels?.Item?.(level))) ??
    (await safeRead(() => listLevels?.item?.(level))) ??
    (await safeRead(() => listLevels?.[level])) ??
    null
  );
}

async function readNumberingInfo(paragraphRange: any): Promise<RawNumberingInfo> {
  const listFormat = (await safeRead(() => paragraphRange?.ListFormat)) ?? (await safeRead(() => paragraphRange?.listFormat));
  if (!listFormat) {
    return {
      listType: null,
      listValue: null,
      level: null,
      listString: null,
      levelText: null,
      align: null,
      numberPosition: null,
      textPosition: null,
      tabPosition: null,
      trailingCharacter: null,
      linkedStyle: null,
    };
  }

  const listType = toFiniteNumber((await safeRead(() => listFormat?.ListType)) ?? (await safeRead(() => listFormat?.listType)));
  const listValue = toFiniteNumber((await safeRead(() => listFormat?.ListValue)) ?? (await safeRead(() => listFormat?.listValue)));
  const level = toFiniteNumber(
    (await safeRead(() => listFormat?.ListLevelNumber)) ?? (await safeRead(() => listFormat?.listLevelNumber))
  );
  const listLevel = await resolveListLevel(listFormat, level);

  const linkedStyleName = await resolveStyleName(
    (await safeRead(() => listLevel?.LinkedStyle)) ?? (await safeRead(() => listLevel?.linkedStyle))
  );

  return {
    listType,
    listValue,
    level,
    listString:
      normalizeText((await safeRead(() => listFormat?.ListString)) ?? (await safeRead(() => listFormat?.listString))) || null,
    levelText:
      normalizeText((await safeRead(() => listLevel?.NumberFormat)) ?? (await safeRead(() => listLevel?.numberFormat))) || null,
    align: toFiniteNumber((await safeRead(() => listLevel?.Alignment)) ?? (await safeRead(() => listLevel?.alignment))),
    numberPosition: toFiniteNumber(
      (await safeRead(() => listLevel?.NumberPosition)) ?? (await safeRead(() => listLevel?.numberPosition))
    ),
    textPosition: toFiniteNumber((await safeRead(() => listLevel?.TextPosition)) ?? (await safeRead(() => listLevel?.textPosition))),
    tabPosition: toFiniteNumber((await safeRead(() => listLevel?.TabPosition)) ?? (await safeRead(() => listLevel?.tabPosition))),
    trailingCharacter: toFiniteNumber(
      (await safeRead(() => listLevel?.TrailingCharacter)) ?? (await safeRead(() => listLevel?.trailingCharacter))
    ),
    linkedStyle: linkedStyleName,
  };
}

async function readParagraphStyleSnapshot(
  activeDocument: any,
  paragraph: any,
  paragraphIndex: number,
  preferredFontSource: any | null
): Promise<RawParagraphStyleSnapshot | null> {
  const paragraphRange = (await safeRead(() => paragraph?.Range)) ?? (await safeRead(() => paragraph?.range));
  if (!paragraphRange) return null;

  const styleRef = (await safeRead(() => paragraph?.Style)) ?? (await safeRead(() => paragraphRange?.Style));
  const styleObject = await resolveStyleObject(activeDocument, styleRef);
  const styleName = (await resolveStyleName(styleObject)) || (await resolveStyleName(styleRef));
  const basedOn = await resolveBasedOnStyleName(styleObject);
  const styleType = toFiniteNumber((await safeRead(() => styleObject?.Type)) ?? (await safeRead(() => styleObject?.type)));

  const font = await readFontInfo(preferredFontSource || paragraphRange);
  const paragraphInfo = await readParagraphInfo(paragraphRange);
  const numberingInfo = await readNumberingInfo(paragraphRange);

  const rangeStart = toFiniteNumber((await safeRead(() => paragraphRange?.Start)) ?? (await safeRead(() => paragraphRange?.start)));
  const rangeEnd = toFiniteNumber((await safeRead(() => paragraphRange?.End)) ?? (await safeRead(() => paragraphRange?.end)));

  const styleInfo: RawStyleInfo = {
    name:
      styleName ||
      normalizeText(await safeRead(() => styleObject?.Name)) ||
      normalizeText(await safeRead(() => styleObject?.name)) ||
      null,
    nameLocal:
      normalizeText(await safeRead(() => styleObject?.NameLocal)) ||
      normalizeText(await safeRead(() => styleObject?.nameLocal)) ||
      styleName ||
      null,
    type: styleType,
    basedOn,
  };

  return {
    paragraphIndex,
    paragraphText: normalizeText(await safeRead(() => paragraphRange?.Text)),
    rangeStart,
    rangeEnd,
    style: styleInfo,
    font,
    paragraph: paragraphInfo,
    numbering: numberingInfo,
  };
}

function dropSelectionArtifactParagraphs(
  snapshots: RawParagraphStyleSnapshot[],
  selectionCollapsed: boolean,
  selectionEnd: number | null
): RawParagraphStyleSnapshot[] {
  if (selectionCollapsed || snapshots.length <= 1 || selectionEnd === null) return snapshots;
  const next = snapshots.slice();
  const last = next[next.length - 1];
  if (!last) return next;
  if (last.paragraphText) return next;
  if (last.rangeStart === null) return next;
  if (last.rangeStart >= selectionEnd) {
    next.pop();
  }
  return next;
}

export async function readSelectionStyleRaw(app: any): Promise<RawSelectionStyleSnapshot> {
  const activeDocument = await getDocument(app);
  const selection = await getSelection(app);
  const range = await selection?.Range;
  if (!range) {
    throw new Error("未找到选区 Range。");
  }

  const selectionStart = toFiniteNumber((await safeRead(() => range?.Start)) ?? (await safeRead(() => range?.start)));
  const selectionEnd = toFiniteNumber((await safeRead(() => range?.End)) ?? (await safeRead(() => range?.end)));
  const selectionCollapsed = selectionStart !== null && selectionEnd !== null ? selectionStart === selectionEnd : false;

  const paragraphs = await getParagraphCollection(range);
  if (!paragraphs.length) {
    throw new Error("当前选区未读取到段落。");
  }

  const useSelectionFont = !selectionCollapsed && paragraphs.length === 1;
  const paragraphSnapshots: RawParagraphStyleSnapshot[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const snapshot = await readParagraphStyleSnapshot(activeDocument, paragraph, index + 1, useSelectionFont ? range : null);
    if (snapshot) paragraphSnapshots.push(snapshot);
  }

  const normalized = dropSelectionArtifactParagraphs(paragraphSnapshots, selectionCollapsed, selectionEnd);
  if (!normalized.length) {
    throw new Error("当前选区未读取到可用段落样式。");
  }

  return {
    target: selectionCollapsed ? "cursorParagraph" : "selection",
    selectionCollapsed,
    selectionStart,
    selectionEnd,
    paragraphs: normalized,
  };
}
