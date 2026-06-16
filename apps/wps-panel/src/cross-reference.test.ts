import assert from "node:assert/strict";
import {
  buildCaptionReferenceBookmarkName,
  captionReferenceResultMatches,
  extractCaptionReferencePrefix,
  extractCaptionReferencePrefixDetails,
  isLikelyFigureReferenceText,
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
}

function testExtractsCaptionPrefixes(): void {
  assert.equal(extractCaptionReferencePrefix("图2-1 既有道路还原方法技术方案"), "图2-1");
  assert.equal(extractCaptionReferencePrefix("表 2-1 路基处理方案"), "表2-1");
  assert.equal(extractCaptionReferencePrefix("表\u00132-1\u0015 路基处理方案"), "表2-1");
  assert.equal(extractCaptionReferencePrefix("Figure 3-2 Example caption"), "Figure 3-2");
  assert.deepEqual(extractCaptionReferencePrefixDetails("  图\u00132\u0015-1 既有道路还原方法技术方案"), {
    referenceText: "图2-1",
    referenceStartOffset: 2,
    referenceLength: 6,
  });

  const fieldCaption = "图\u0013 SEQ 图 \\* ARABIC \u00142-1\u0015 既有道路还原方法技术方案";
  const fieldCaptionMatch = extractCaptionReferencePrefixDetails(fieldCaption);
  assert.equal(fieldCaptionMatch?.referenceText, "图2-1");
  assert.equal(fieldCaptionMatch?.referenceStartOffset, 0);
  assert.equal(fieldCaption.slice(fieldCaptionMatch?.referenceStartOffset, fieldCaptionMatch?.referenceLength), "图\u0013 SEQ 图 \\* ARABIC \u00142-1\u0015");

  const splitFieldCaption = "图 \u0013 STYLEREF 1 \\s \u00143\u0015 - \u0013 SEQ 图 \\* ARABIC \\s 1 \u00142\u0015 老路信息整合与可视化";
  const splitFieldCaptionMatch = extractCaptionReferencePrefixDetails(splitFieldCaption);
  assert.equal(splitFieldCaptionMatch?.referenceText, "图3-2");
  assert.equal(splitFieldCaptionMatch?.referenceStartOffset, 0);
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
  let bookmarkRangeText = "";
  let directRangeText = "UOTE";
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
  assert.equal(bookmarkRangeText, "图3-2");
  assert.equal(result.bookmarkCreated, true);

  bookmarkRangeText = "";
  directRangeText = "开发了";
  const secondResult = await insertCaptionReferenceOption(app, option);
  assert.equal(bookmarkRangeText, "图3-2");
  assert.equal(secondResult.bookmarkCreated, true);
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

  console.log("cross-reference tests passed");
}

void main();
