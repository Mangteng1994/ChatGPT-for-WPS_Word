import assert from "node:assert/strict";
import {
  applyAllCaptionReferenceFontSize,
  applyCaptionReferenceFontSize,
  buildCaptionReferenceFieldCodeText,
  buildCaptionReferenceBookmarkName,
  captionReferenceResultMatches,
  extractCaptionReferenceBookmarkNameFromFieldCode,
  extractCaptionReferencePrefix,
  extractCaptionReferencePrefixDetails,
  isLikelyFigureReferenceText,
  isCaptionReferenceBookmarkName,
  isLikelyTableReferenceText,
  insertCaptionReferenceOption,
  listAllCaptionReferenceOptions,
  listCaptionReferenceOptions,
  normalizeCaptionReferenceResultText,
  normalizeCaptionReferenceSearchText,
} from "./wps-adapter";

function testBookmarkNames(): void {
  assert.equal(buildCaptionReferenceBookmarkName("figure", 1), "FigRef_001");
  assert.equal(buildCaptionReferenceBookmarkName("figure", 12), "FigRef_012");
  assert.equal(buildCaptionReferenceBookmarkName("table", 7), "TblRef_007");
  assert.equal(isCaptionReferenceBookmarkName("FigRef_001", "figure"), true);
  assert.equal(isCaptionReferenceBookmarkName("TblRef_007", "table"), true);
  assert.equal(isCaptionReferenceBookmarkName("TblRef_007", "figure"), false);
  assert.equal(extractCaptionReferenceBookmarkNameFromFieldCode(" REF TblRef_007 \\h "), "TblRef_007");
  assert.equal(extractCaptionReferenceBookmarkNameFromFieldCode(" PAGE "), "");
  assert.equal(buildCaptionReferenceFieldCodeText("FigRef_001"), " REF FigRef_001 \\* MERGEFORMAT ");
  assert.equal(buildCaptionReferenceFieldCodeText("TblRef_007", " REF TblRef_007 \\h "), " REF TblRef_007 \\h \\* MERGEFORMAT ");
}

function testExtractsCaptionPrefixes(): void {
  assert.equal(extractCaptionReferencePrefix("图2-1 既有道路还原方法技术方案"), "图2-1");
  assert.equal(extractCaptionReferencePrefix("表 2-1 路基处理方案"), "表2-1");
  assert.equal(extractCaptionReferencePrefix("表\u00132-1\u0015 路基处理方案"), "表2-1");
  assert.equal(extractCaptionReferencePrefix("Figure 3-2 Example caption"), "Figure 3-2");
  const compactFieldCaptionMatch = extractCaptionReferencePrefixDetails("  图\u0013 SEQ 图 \\* ARABIC \u00142\u0015-1 既有道路还原方法技术方案");
  assert.equal(compactFieldCaptionMatch?.referenceText, "图2-1");
  assert.equal(compactFieldCaptionMatch?.referenceStartOffset, 2);
  assert.equal(
    "  图\u0013 SEQ 图 \\* ARABIC \u00142\u0015-1".slice(compactFieldCaptionMatch?.referenceStartOffset, compactFieldCaptionMatch?.referenceStartOffset + (compactFieldCaptionMatch?.referenceLength || 0)),
    "图\u0013 SEQ 图 \\* ARABIC \u00142\u0015-1"
  );
  assert.deepEqual(compactFieldCaptionMatch?.referenceParts.map((part) => ({ text: part.text, isField: part.isField })), [
    { text: "图", isField: false },
    { text: "2", isField: true },
    { text: "-1", isField: false },
  ]);

  const fieldCaption = "图\u0013 SEQ 图 \\* ARABIC \u00142-1\u0015 既有道路还原方法技术方案";
  const fieldCaptionMatch = extractCaptionReferencePrefixDetails(fieldCaption);
  assert.equal(fieldCaptionMatch?.referenceText, "图2-1");
  assert.equal(fieldCaptionMatch?.referenceStartOffset, 0);
  assert.equal(fieldCaption.slice(fieldCaptionMatch?.referenceStartOffset, fieldCaptionMatch?.referenceLength), "图\u0013 SEQ 图 \\* ARABIC \u00142-1\u0015");

  const splitFieldCaption = "图 \u0013 STYLEREF 1 \\s \u00143\u0015 - \u0013 SEQ 图 \\* ARABIC \\s 1 \u00142\u0015 老路信息整合与可视化";
  const splitFieldCaptionMatch = extractCaptionReferencePrefixDetails(splitFieldCaption);
  assert.equal(splitFieldCaptionMatch?.referenceText, "图3-2");
  assert.equal(splitFieldCaptionMatch?.referenceStartOffset, 0);
  assert.deepEqual(splitFieldCaptionMatch?.referenceParts.map((part) => ({ text: part.text, isField: part.isField })), [
    { text: "图 ", isField: false },
    { text: "3", isField: true },
    { text: " - ", isField: false },
    { text: "2", isField: true },
  ]);
  assert.equal(
    splitFieldCaption.slice(splitFieldCaptionMatch?.referenceStartOffset, splitFieldCaptionMatch?.referenceLength),
    "图 \u0013 STYLEREF 1 \\s \u00143\u0015 - \u0013 SEQ 图 \\* ARABIC \\s 1 \u00142\u0015"
  );

  const chapterFieldCaption = "图 \u0013 STYLEREF 1 \\s \u0014第3章\u0015-\u0013 SEQ 图 \\* ARABIC \\s 1 \u00142\u0015 章节样式编号";
  assert.equal(extractCaptionReferencePrefix(chapterFieldCaption), "图3-2");
}

function testRecognizesCaptionReferences(): void {
  assert.equal(isLikelyFigureReferenceText("图2-1 既有道路还原方法技术方案"), true);
  assert.equal(isLikelyFigureReferenceText("Figure 3-2 Example caption"), true);
  assert.equal(isLikelyFigureReferenceText("图示说明"), false);
  assert.equal(isLikelyTableReferenceText("表2-1 路基处理方案"), true);
  assert.equal(isLikelyTableReferenceText("Table 4-1 Example caption"), true);
  assert.equal(isLikelyTableReferenceText("表明本研究具有可行性"), false);
}

function testNormalizesSearchText(): void {
  assert.equal(normalizeCaptionReferenceSearchText("  图2-1   既有道路  "), "图2-1 既有道路");
  assert.equal(normalizeCaptionReferenceSearchText("FIGURE   3-2"), "figure 3-2");
  assert.equal(normalizeCaptionReferenceSearchText("表\u00132-1\u0015   路基处理方案"), "表2-1 路基处理方案");
}

function testValidatesInsertedReferenceResults(): void {
  assert.equal(normalizeCaptionReferenceResultText("图\u00133\u0015-34"), "图3-34");
  assert.equal(normalizeCaptionReferenceResultText("图\u0013 SEQ 图 \\* ARABIC \u00142-1\u0015"), "图2-1");
  assert.equal(normalizeCaptionReferenceResultText("图 \u0013 STYLEREF 1 \\s \u00143\u0015 - \u0013 SEQ 图 \\* ARABIC \\s 1 \u00142\u0015"), "图3-2");
  assert.equal(normalizeCaptionReferenceResultText("图 \u0013 STYLEREF 1 \\s \u0014第3章\u0015-\u0013 SEQ 图 \\* ARABIC \\s 1 \u00142\u0015"), "图3-2");
  assert.deepEqual(captionReferenceResultMatches("图3-34", "图3-34"), { matched: true, text: "图3-34" });
  assert.deepEqual(captionReferenceResultMatches("表 2 - 1", "表2-1"), { matched: true, text: "表2-1" });
  assert.equal(captionReferenceResultMatches("", "图3-34").matched, false);
  assert.equal(captionReferenceResultMatches("图", "图3-34").matched, false);
  assert.equal(captionReferenceResultMatches("表", "表2-1").matched, false);
}

async function testListsCaptionReferencesWithoutRangeValidation(): Promise<void> {
  let rangeCallCount = 0;
  const paragraphTexts = [
    "图2-1 既有道路还原方法技术方案\r",
    "图\u0013 SEQ 图 \\* ARABIC \u00142-2\u0015 路基处理方案\r",
    "图 \u0013 STYLEREF 1 \\s \u00143\u0015 - \u0013 SEQ 图 \\* ARABIC \\s 1 \u00142\u0015 手工域标题\r",
    "普通段落\r",
    "表2-1 主要技术指标\r",
    "表\u0013 SEQ 表 \\* ARABIC \u00142-2\u0015 参数统计\r",
    "表 \u0013 STYLEREF 1 \\s \u00143\u0015 - \u0013 SEQ 表 \\* ARABIC \\s 1 \u00142\u0015 手工域表题\r",
  ];
  const paragraphs = paragraphTexts.map((text, index) => ({
    Range: {
      Start: index * 100,
      Text: text,
    },
  }));
  const app = {
    ActiveDocument: {
      Paragraphs: {
        Count: paragraphs.length,
        Item(index: number) {
          return paragraphs[index - 1];
        },
      },
      Range() {
        rangeCallCount += 1;
        throw new Error("扫描阶段不应反读 Range。");
      },
    },
  };

  const figures = await listCaptionReferenceOptions(app, "figure");
  const tables = await listCaptionReferenceOptions(app, "table");
  assert.deepEqual(figures.map((item) => item.referenceText), ["图2-1", "图2-2", "图3-2"]);
  assert.deepEqual(tables.map((item) => item.referenceText), ["表2-1", "表2-2", "表3-2"]);
  assert.equal(rangeCallCount, 0);
}

async function testListsCaptionReferencesFromArrayLikeParagraphs(): Promise<void> {
  const app = {
    ActiveDocument: {
      Paragraphs: {
        Count: 3,
        0: { Range: { Start: 0, Text: "表2-1 主要技术指标\r" } },
        1: { Range: { Start: 100, Text: "普通段落\r" } },
        2: { Range: { Start: 200, Text: "表2-2 参数统计\r" } },
      },
    },
  };

  const tables = await listCaptionReferenceOptions(app, "table");
  assert.deepEqual(tables.map((item) => item.referenceText), ["表2-1", "表2-2"]);
}

async function testListsCaptionReferencesFromTablesAndStories(): Promise<void> {
  const tableParagraphs = [
    { Range: { Start: 300, Text: "表3-1 表格内题注\r" } },
  ];
  const storyParagraphs = [
    { Range: { Start: 500, Text: "图4-1 页眉题注\r" } },
    { Range: { Start: 0, Text: "图2-1 正文题注\r" } },
  ];
  const app = {
    ActiveDocument: {
      Paragraphs: {
        Count: 1,
        Item(index: number) {
          return [{ Range: { Start: 0, Text: "图2-1 正文题注\r" } }][index - 1];
        },
      },
      Tables: {
        Count: 1,
        Item() {
          return {
            Range: {
              Paragraphs: {
                Count: tableParagraphs.length,
                Item(index: number) {
                  return tableParagraphs[index - 1];
                },
              },
            },
          };
        },
      },
      StoryRanges: {
        Paragraphs: {
          Count: storyParagraphs.length,
          Item(index: number) {
            return storyParagraphs[index - 1];
          },
        },
      },
    },
  };

  const figures = await listCaptionReferenceOptions(app, "figure");
  const tables = await listCaptionReferenceOptions(app, "table");
  assert.deepEqual(figures.map((item) => item.referenceText), ["图2-1", "图4-1"]);
  assert.deepEqual(tables.map((item) => item.referenceText), ["表3-1"]);
}

async function testListsCaptionReferencesFromStoryRangeCollection(): Promise<void> {
  const app = {
    ActiveDocument: {
      StoryRanges: {
        Count: 2,
        Item(index: number) {
          return [
            { Paragraphs: { Count: 1, Item: () => ({ Range: { Start: 100, Text: "图5-1 页眉图题\r" } }) } },
            { Paragraphs: { Count: 1, Item: () => ({ Range: { Start: 200, Text: "表5-1 页脚表题\r" } }) } },
          ][index - 1];
        },
      },
    },
  };

  const result = await listAllCaptionReferenceOptions(app);
  assert.deepEqual(result.figures.map((item) => item.referenceText), ["图5-1"]);
  assert.deepEqual(result.tables.map((item) => item.referenceText), ["表5-1"]);
}

async function testListsAllCaptionReferencesInOneScan(): Promise<void> {
  let paragraphItemCalls = 0;
  const app = {
    ActiveDocument: {
      Paragraphs: {
        Count: 3,
        Item(index: number) {
          paragraphItemCalls += 1;
          return [
            { Range: { Start: 0, Text: "图2-1 路线图\r" } },
            { Range: { Start: 100, Text: "表2-1 指标表\r" } },
            { Range: { Start: 200, Text: "普通段落\r" } },
          ][index - 1];
        },
      },
    },
  };

  const result = await listAllCaptionReferenceOptions(app);
  assert.deepEqual(result.figures.map((item) => item.referenceText), ["图2-1"]);
  assert.deepEqual(result.tables.map((item) => item.referenceText), ["表2-1"]);
  assert.equal(paragraphItemCalls, 3);
}

async function testFallsBackToFindWhenFieldOffsetHitsCodeText(): Promise<void> {
  const captionText = "图 \u0013 STYLEREF 1 \\s \u00143\u0015 - \u0013 SEQ 图 \\* ARABIC \\s 1 \u00142\u0015 老路信息整合与可视化\r";
  let directRangeRead = false;
  let bookmarkRangeText = "";
  let fieldCount = 0;
  const fieldResultRange = { Text: "图3-2", Font: {} };
  const fields = {
    get Count() {
      return fieldCount;
    },
    Add() {
      fieldCount += 1;
      return {
        Result: fieldResultRange,
        Update() {
          return true;
        },
      };
    },
  };
  const app = {
    ActiveDocument: {
      Paragraphs: {
        Count: 1,
        Item() {
          return { Range: { Start: 100, End: 200, Text: captionText } };
        },
      },
      ActiveWindow: {
        Selection: {
          Range: {
            Fields: fields,
            Font: {},
            Collapse() {
              return true;
            },
            Duplicate() {
              return { Font: {} };
            },
          },
        },
      },
      Bookmarks: {
        Item(name: string) {
          if (!bookmarkRangeText) throw new Error(`${name} missing`);
          return { Range: { Text: bookmarkRangeText } };
        },
        Add(arg1: unknown, arg2?: unknown) {
          const range = arg2 ?? (arg1 as { Range?: unknown }).Range;
          bookmarkRangeText = String((range as { Text?: string }).Text || "");
          return true;
        },
      },
      Range(start: number, end: number) {
        if (start === 100 && end === 200) {
          return {
            Text: captionText,
            Duplicate() {
              const searchRange = {
                Text: captionText,
                Find: {
                  Text: "",
                  Execute() {
                    searchRange.Text = "图3-2";
                    return true;
                  },
                },
                Font: {},
              };
              return searchRange;
            },
          };
        }

        directRangeRead = true;
        return { Text: "UOTE", Font: {} };
      },
    },
  };

  const [option] = await listCaptionReferenceOptions(app, "figure");
  assert.equal(option.referenceText, "图3-2");
  const result = await insertCaptionReferenceOption(app, option);
  assert.equal(directRangeRead, true);
  assert.equal(bookmarkRangeText, "图3-2");
  assert.equal(result.bookmarkCreated, true);
}

async function testFallsBackToFieldResultRangesWhenFindMissesFieldText(): Promise<void> {
  const captionText = "图 \u0013 QUOTE \"一九一一年一月{ STYLEREF 1 \\s }日\" \\@ \"d\" \u00143\u0015-\u0013 SEQ 图 \\* ARABIC \\s 1 \u00142\u0015 手工域标题\r";
  const bookmarkNames: string[] = [];
  const bookmarkStore: Record<string, { Text: string }> = {};
  const insertedParts: string[] = [];
  let directRangeText = "UOTE";
  let fieldCount = 0;
  const fields = {
    get Count() {
      return fieldCount;
    },
    Add(_range: unknown, _type: number, text: string) {
      fieldCount += 1;
      insertedParts.push(text);
      const expectedText = text.includes("_P02") ? "3" : "2";
      return {
        Code: { Text: text, Font: {} },
        Result: { Text: expectedText, Font: {} },
        Update() {
          return true;
        },
      };
    },
  };
  const paragraphFields = {
    Count: 2,
    Item(index: number) {
      return [
        { Result: { Text: "3", Start: 102, End: 106 } },
        { Result: { Text: "2", Start: 107, End: 111 } },
      ][index - 1];
    },
  };
  const app = {
    ActiveDocument: {
      Paragraphs: {
        Count: 1,
        Item() {
          return { Range: { Start: 100, End: 200, Text: captionText, Fields: paragraphFields } };
        },
      },
      ActiveWindow: {
        Selection: {
          Range: {
            Fields: fields,
            Font: {},
            Collapse() {
              return true;
            },
            Duplicate() {
              return { Font: {} };
            },
          },
          TypeText(text: string) {
            insertedParts.push(text);
            return true;
          },
        },
      },
      Bookmarks: {
        Item(name: string) {
          const range = bookmarkStore[name];
          if (!range) throw new Error(`${name} missing`);
          return { Range: range };
        },
        Add(arg1: unknown, arg2?: unknown) {
          const name = typeof arg1 === "string" ? arg1 : String((arg1 as { Name?: string }).Name || "");
          const range = arg2 ?? (arg1 as { Range?: unknown }).Range;
          const text = String((range as { Text?: string }).Text || "");
          bookmarkStore[name] = { Text: text };
          bookmarkNames.push(`${name}:${text}`);
          return true;
        },
      },
      Range(start: number, end: number) {
        if (start === 100 && end === 200) {
          return {
            Text: captionText,
            Fields: paragraphFields,
            Duplicate() {
              const searchRange = {
                Text: captionText,
                Find: {
                  Text: "",
                  Execute() {
                    return false;
                  },
                },
                Font: {},
              };
              return searchRange;
            },
          };
        }
        if (start === 100 && end === 102) {
          return { Text: "图 " };
        }
        if (start === 100 && end === 111) {
          return { Text: "图3-2", Font: {} };
        }
        return { Text: directRangeText, Font: {} };
      },
    },
  };

  const [option] = await listCaptionReferenceOptions(app, "figure");
  assert.equal(option.referenceText, "图3-2");
  const result = await insertCaptionReferenceOption(app, option);
  assert.equal(result.mode, "parts");
  assert.equal(result.bookmarkCreated, true);
  assert.deepEqual(bookmarkNames, ["FigRef_001_P02:3", "FigRef_001_P04:2"]);
  assert.deepEqual(insertedParts, ["图", " REF FigRef_001_P02 \\* MERGEFORMAT ", "-", " REF FigRef_001_P04 \\* MERGEFORMAT "]);

  bookmarkNames.length = 0;
  insertedParts.length = 0;
  directRangeText = "开发了";
  const secondResult = await insertCaptionReferenceOption(app, option);
  assert.equal(secondResult.mode, "parts");
  assert.equal(secondResult.bookmarkCreated, false);
  assert.deepEqual(bookmarkNames, []);
  assert.deepEqual(insertedParts, ["图", " REF FigRef_001_P02 \\* MERGEFORMAT ", "-", " REF FigRef_001_P04 \\* MERGEFORMAT "]);
}

function createMovableMockRange(text: string): any {
  let start = 0;
  let end = text.length;
  return {
    Start: 100 + start,
    End: 100 + end,
    get Text() {
      return text.slice(start, end);
    },
    Collapse() {
      start = 0;
      end = 0;
      this.Start = 100;
      this.End = 100;
      return true;
    },
    MoveEnd(_unit: number, count: number) {
      end += count;
      this.End = 100 + end;
      return count;
    },
    MoveStart(_unit: number, count: number) {
      start += count;
      this.Start = 100 + start;
      return count;
    },
    Duplicate() {
      return createMovableMockRange(text);
    },
    Font: {},
  };
}

async function testFallsBackToParagraphOffsetWhenDocumentRangeDrifts(): Promise<void> {
  const captionText = "图1-1 “高精度数字底图”二期提供了系统\r";
  let bookmarkRangeText = "";
  let fieldCount = 0;
  const fields = {
    get Count() {
      return fieldCount;
    },
    Add() {
      fieldCount += 1;
      return {
        Code: { Text: " REF FigRef_001 \\* MERGEFORMAT ", Font: {} },
        Result: { Text: "图1-1", Font: {} },
        Update() {
          return true;
        },
      };
    },
  };
  const app = {
    ActiveDocument: {
      Paragraphs: {
        Count: 1,
        Item() {
          return { Range: { Start: 100, End: 150, Text: captionText, Duplicate: () => createMovableMockRange(captionText) } };
        },
      },
      ActiveWindow: {
        Selection: {
          Range: {
            Fields: fields,
            Font: {},
            Collapse() {
              return true;
            },
            Duplicate() {
              return { Font: {} };
            },
          },
        },
      },
      Bookmarks: {
        Item(name: string) {
          if (!bookmarkRangeText) throw new Error(`${name} missing`);
          return { Range: { Text: bookmarkRangeText } };
        },
        Add(arg1: unknown, arg2?: unknown) {
          const range = arg2 ?? (arg1 as { Range?: unknown }).Range;
          bookmarkRangeText = String((range as { Text?: string }).Text || "");
          return true;
        },
      },
      Range() {
        return { Text: "供了系统", Font: {} };
      },
    },
  };

  const [option] = await listCaptionReferenceOptions(app, "figure");
  assert.equal(option.referenceText, "图1-1");
  const result = await insertCaptionReferenceOption(app, option);
  assert.equal(result.bookmarkCreated, true);
  assert.equal(bookmarkRangeText, "图1-1");
}

async function testInsertsManualFieldCaptionAsStableReferenceParts(): Promise<void> {
  const captionText = "图\u0013 STYLEREF 1 \\s \u00143\u0015-\u0013 SEQ 图 \\* ARABIC \\s 1 \u00142\u0015 手工域标题\r";
  const insertedParts: string[] = [];
  const bookmarkNames: string[] = [];
  const bookmarkStore: Record<string, { Text: string }> = {};
  const sourceFields = {
    Count: 2,
    Item(index: number) {
      const text = index === 1 ? "3" : "2";
      const resultRange = {
        Text: text,
        Font: {},
        Duplicate() {
          return {
            Text: text,
            Font: {},
            MoveEnd() {
              return true;
            },
          };
        },
      };
      return { Result: resultRange };
    },
  };
  const fields = {
    Count: 0,
    Add(_range: unknown, _type: number, text: string) {
      this.Count += 1;
      insertedParts.push(text);
      const expectedText = text.includes("_P02") ? "3" : "2";
      return {
        Code: { Text: text, Font: {} },
        Result: { Text: expectedText, Font: {} },
        Update() {
          return true;
        },
      };
    },
  };
  const selectionRange = {
    Fields: fields,
    Font: {},
    Collapse() {
      return true;
    },
    Duplicate() {
      return { Font: {} };
    },
  };
  const app = {
    ActiveDocument: {
      Paragraphs: {
        Count: 1,
        Item() {
          return { Range: { Start: 100, End: 200, Text: captionText, Fields: sourceFields } };
        },
      },
      ActiveWindow: {
        Selection: {
          Range: selectionRange,
          TypeText(text: string) {
            insertedParts.push(text);
            return true;
          },
        },
      },
      Bookmarks: {
        Item(name: string) {
          const range = bookmarkStore[name];
          if (!range) throw new Error(`${name} missing`);
          return { Range: range };
        },
        Add(arg1: unknown, arg2?: unknown) {
          const name = typeof arg1 === "string" ? arg1 : String((arg1 as { Name?: string }).Name || "");
          const range = (arg2 ?? (arg1 as { Range?: unknown }).Range) as { Text?: string | (() => string) };
          const rawText = typeof range.Text === "function" ? range.Text() : range.Text;
          const text = String(rawText || "");
          bookmarkStore[name] = { Text: text };
          bookmarkNames.push(`${name}:${text}`);
          return true;
        },
      },
      Range(start: number, end: number) {
        if (start === 100 && end === 200) {
          return { Text: captionText, Start: 100, End: 200, Fields: sourceFields };
        }
        return { Text: "错误范围", Start: start, End: end, Font: {} };
      },
    },
  };

  const [option] = await listCaptionReferenceOptions(app, "figure");
  assert.equal(option.referenceText, "图3-2");
  assert.deepEqual(option.referenceParts.map((part) => ({ text: part.text, isField: part.isField })), [
    { text: "图", isField: false },
    { text: "3", isField: true },
    { text: "-", isField: false },
    { text: "2", isField: true },
  ]);

  const result = await insertCaptionReferenceOption(app, option);
  assert.equal(result.bookmarkCreated, true);
  assert.deepEqual(bookmarkNames, ["FigRef_001_P02:3", "FigRef_001_P04:2"]);
  assert.deepEqual(insertedParts, ["图", " REF FigRef_001_P02 \\* MERGEFORMAT ", "-", " REF FigRef_001_P04 \\* MERGEFORMAT "]);
}

async function testDetectsManualFieldPartsFromWpsResultText(): Promise<void> {
  const captionText = "图1-1  新旧道路融合分解结构\r";
  const insertedParts: string[] = [];
  const bookmarkNames: string[] = [];
  const bookmarkStore: Record<string, { Text: string }> = {};
  const sourceFields = {
    Count: 2,
    Item(index: number) {
      const text = index === 1 ? "1" : "1";
      const start = index === 1 ? 101 : 103;
      return { Result: { Text: text, Start: start, End: start + 1, Font: {} } };
    },
  };
  const fields = {
    Count: 0,
    Add(_range: unknown, _type: number, text: string) {
      this.Count += 1;
      insertedParts.push(text);
      return {
        Code: { Text: text, Font: {} },
        Result: { Text: "1", Font: {} },
        Update() {
          return true;
        },
      };
    },
  };
  const app = {
    ActiveDocument: {
      Paragraphs: {
        count() {
          return 1;
        },
        item() {
          return {
            Range: {
              Start: 100,
              End: 130,
              Text: captionText,
              Fields: sourceFields,
              Duplicate: () => {
                const duplicate = createMovableMockRange(captionText);
                duplicate.Fields = { Count: 0 };
                return duplicate;
              },
            },
          };
        },
      },
      ActiveWindow: {
        Selection: {
          Range: {
            Fields: fields,
            Font: {},
            Collapse() {
              return true;
            },
            Duplicate() {
              return { Font: {} };
            },
          },
          TypeText(text: string) {
            insertedParts.push(text);
            return true;
          },
        },
      },
      Bookmarks: {
        Item(name: string) {
          const range = bookmarkStore[name];
          if (!range) throw new Error(`${name} missing`);
          return { Range: range };
        },
        Add(arg1: unknown, arg2?: unknown) {
          const name = typeof arg1 === "string" ? arg1 : String((arg1 as { Name?: string }).Name || "");
          const range = (arg2 ?? (arg1 as { Range?: unknown }).Range) as { Text?: string | (() => string) };
          const rawText = typeof range.Text === "function" ? range.Text() : range.Text;
          const text = String(rawText || "");
          bookmarkStore[name] = { Text: text };
          bookmarkNames.push(`${name}:${text}`);
          return true;
        },
      },
      Range() {
        return { Text: "供了系统", Font: {} };
      },
    },
  };

  const [option] = await listCaptionReferenceOptions(app, "figure");
  assert.equal(option.referenceText, "图1-1");
  assert.deepEqual(option.referenceParts.map((part) => ({ text: part.text, isField: part.isField, fieldIndex: part.fieldIndex })), [
    { text: "图", isField: false, fieldIndex: 0 },
    { text: "1", isField: true, fieldIndex: 1 },
    { text: "-", isField: false, fieldIndex: 0 },
    { text: "1", isField: true, fieldIndex: 2 },
  ]);

  const result = await insertCaptionReferenceOption(app, option);
  assert.equal(result.bookmarkCreated, true);
  assert.deepEqual(bookmarkNames, ["FigRef_001_P02:1", "FigRef_001_P04:1"]);
  assert.deepEqual(insertedParts, ["图", " REF FigRef_001_P02 \\* MERGEFORMAT ", "-", " REF FigRef_001_P04 \\* MERGEFORMAT "]);
}

async function testDetectsManualFieldPartsFromCallableWpsMembers(): Promise<void> {
  const captionText = "图1-1  新旧道路融合分解结构\r";
  const insertedParts: string[] = [];
  const bookmarkNames: string[] = [];
  const bookmarkStore: Record<string, { Text: string }> = {};
  const sourceFields = {
    count() {
      return 2;
    },
    item(index: number) {
      const text = index === 1 ? "1" : "1";
      return {
        result() {
          return {
            Text() {
              return text;
            },
            Font: {},
          };
        },
      };
    },
  };
  const insertedFields = {
    fieldCount: 0,
    count() {
      return this.fieldCount;
    },
    item(index: number) {
      const text = index === 1 ? "1" : "1";
      return {
        code() {
          return { Text: insertedParts[index - 1], Font: {} };
        },
        result() {
          return { Text: text, Font: {} };
        },
        update() {
          return true;
        },
      };
    },
    Add(_range: unknown, _type: number, text: string) {
      this.fieldCount += 1;
      insertedParts.push(text);
      return this.item(this.fieldCount);
    },
  };
  const app = {
    ActiveDocument: {
      Paragraphs: {
        Count: 1,
        Item() {
          return {
            Range: {
              Start: 100,
              End: 130,
              Text() {
                return captionText;
              },
              fields() {
                return sourceFields;
              },
              Duplicate: () => createMovableMockRange(captionText),
            },
          };
        },
      },
      ActiveWindow: {
        Selection: {
          Range: {
            fields() {
              return insertedFields;
            },
            Font: {},
            Collapse() {
              return true;
            },
            Duplicate() {
              return { Font: {} };
            },
          },
          TypeText(text: string) {
            insertedParts.push(text);
            return true;
          },
        },
      },
      Bookmarks: {
        Item(name: string) {
          const range = bookmarkStore[name];
          if (!range) throw new Error(`${name} missing`);
          return { Range: range };
        },
        Add(arg1: unknown, arg2?: unknown) {
          const name = typeof arg1 === "string" ? arg1 : String((arg1 as { Name?: string }).Name || "");
          const range = (arg2 ?? (arg1 as { Range?: unknown }).Range) as { Text?: string | (() => string) };
          const rawText = typeof range.Text === "function" ? range.Text() : range.Text;
          const text = String(rawText || "");
          bookmarkStore[name] = { Text: text };
          bookmarkNames.push(`${name}:${text}`);
          return true;
        },
      },
      Range() {
        return { Text: "供了系统", Font: {} };
      },
    },
  };

  const [option] = await listCaptionReferenceOptions(app, "figure");
  assert.equal(option.referenceText, "图1-1");
  const result = await insertCaptionReferenceOption(app, option);
  assert.equal(result.mode, "parts");
  assert.deepEqual(bookmarkNames, ["FigRef_001_P02:1", "FigRef_001_P04:1"]);
  assert.deepEqual(insertedParts, ["图", " REF FigRef_001_P02 \\* MERGEFORMAT ", "-", " REF FigRef_001_P04 \\* MERGEFORMAT "]);
}

async function testAppliesCaptionReferenceFontSizeByKind(): Promise<void> {
  const sizes: number[] = [];
  const codeTexts = [" REF TblRef_001 \\h ", " REF FigRef_002 \\h ", " PAGE "];
  const fields = {
    Count: 3,
    Item(index: number) {
      return [
        {
          Code: {
            get Text() {
              return codeTexts[0];
            },
            set Text(value: string) {
              codeTexts[0] = value;
            },
            Font: { set Size(value: number) { sizes.push(value + 10); } },
          },
          Result: { Text: "表3-1", Font: { set Size(value: number) { sizes.push(value); } } },
          Update() {
            return true;
          },
        },
        {
          Code: {
            get Text() {
              return codeTexts[1];
            },
            set Text(value: string) {
              codeTexts[1] = value;
            },
            Font: { set Size(value: number) { sizes.push(value + 20); } },
          },
          Result: { Text: "图3-2", Font: { set Size(value: number) { sizes.push(value + 100); } } },
          Update() {
            return true;
          },
        },
        {
          Code: { Text: " PAGE " },
          Result: { Text: "1", Font: { set Size(_value: number) {} } },
          Update() {
            return true;
          },
        },
      ][index - 1];
    },
  };
  const app = {
    ActiveDocument: {
      Fields: fields,
    },
  };

  const tableResult = await applyCaptionReferenceFontSize(app, "table", 10.5);
  assert.deepEqual(tableResult, { kind: "table", fontSize: 10.5, matched: 1, updated: 1 });
  assert.equal(codeTexts[0], " REF TblRef_001 \\h \\* MERGEFORMAT ");
  assert.deepEqual(sizes, [20.5, 10.5]);

  const figureResult = await applyCaptionReferenceFontSize(app, "figure", 9);
  assert.deepEqual(figureResult, { kind: "figure", fontSize: 9, matched: 1, updated: 1 });
  assert.equal(codeTexts[1], " REF FigRef_002 \\h \\* MERGEFORMAT ");
  assert.deepEqual(sizes, [20.5, 10.5, 29, 109]);
}

async function testAppliesCaptionReferenceFontSizeForAllKinds(): Promise<void> {
  const sizes: number[] = [];
  const fields = {
    Count: 4,
    Item(index: number) {
      return [
        {
          Code: { Text: " REF TblRef_001 \\h " },
          Result: { Text: "表3-1", Font: { set Size(value: number) { sizes.push(value); } } },
          Update() {
            return true;
          },
        },
        {
          Code: { Text: " REF FigRef_002 \\h " },
          Result: { Text: "图3-2", Font: { set Size(value: number) { sizes.push(value + 100); } } },
          Update() {
            return true;
          },
        },
        {
          Code: { Text: " REF TblRef_003 \\h " },
          Result: { Text: "表3-3", Font: { set Size(value: number) { sizes.push(value + 200); } } },
          Update() {
            return true;
          },
        },
        {
          Code: { Text: " DATE " },
          Result: { Text: "2026-06-16", Font: { set Size(_value: number) {} } },
          Update() {
            return true;
          },
        },
      ][index - 1];
    },
  };
  const app = {
    ActiveDocument: {
      Fields: fields,
    },
  };

  const result = await applyAllCaptionReferenceFontSize(app, 10.5);
  assert.deepEqual(result, {
    fontSize: 10.5,
    totalMatched: 3,
    totalUpdated: 3,
    figures: { kind: "figure", fontSize: 10.5, matched: 1, updated: 1 },
    tables: { kind: "table", fontSize: 10.5, matched: 2, updated: 2 },
  });
  assert.deepEqual(sizes, [110.5, 10.5, 210.5]);
}

async function main(): Promise<void> {
  testBookmarkNames();
  testExtractsCaptionPrefixes();
  testRecognizesCaptionReferences();
  testNormalizesSearchText();
  testValidatesInsertedReferenceResults();
  await testListsCaptionReferencesWithoutRangeValidation();
  await testListsCaptionReferencesFromArrayLikeParagraphs();
  await testListsCaptionReferencesFromTablesAndStories();
  await testListsCaptionReferencesFromStoryRangeCollection();
  await testListsAllCaptionReferencesInOneScan();
  await testFallsBackToFindWhenFieldOffsetHitsCodeText();
  await testFallsBackToFieldResultRangesWhenFindMissesFieldText();
  await testFallsBackToParagraphOffsetWhenDocumentRangeDrifts();
  await testInsertsManualFieldCaptionAsStableReferenceParts();
  await testDetectsManualFieldPartsFromWpsResultText();
  await testDetectsManualFieldPartsFromCallableWpsMembers();
  await testAppliesCaptionReferenceFontSizeByKind();
  await testAppliesCaptionReferenceFontSizeForAllKinds();

  console.log("cross-reference tests passed");
}

void main();
