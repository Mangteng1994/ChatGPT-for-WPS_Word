import assert from "node:assert/strict";
import { convertRawSelectionStyleSnapshot } from "./style-inspector-converter";
import { compareParagraphStyles } from "./style-inspector-diff";
import { buildSelectionStyleDescription } from "./style-inspector-nl";
import type { LengthValue } from "./length-units";
import type { RawParagraphStyleSnapshot, RawSelectionStyleSnapshot } from "./style-inspector-types";

type RawParagraphOverrides = Partial<Omit<RawParagraphStyleSnapshot, "style" | "font" | "paragraph" | "numbering">> & {
  style?: Partial<RawParagraphStyleSnapshot["style"]>;
  font?: Partial<RawParagraphStyleSnapshot["font"]>;
  paragraph?: Partial<RawParagraphStyleSnapshot["paragraph"]>;
  numbering?: Partial<RawParagraphStyleSnapshot["numbering"]>;
};

function makeRawParagraph(paragraphIndex: number, overrides: RawParagraphOverrides = {}): RawParagraphStyleSnapshot {
  const style: RawParagraphStyleSnapshot["style"] = {
    name: "一级标题",
    nameLocal: "一级标题",
    type: 1,
    basedOn: "无样式",
    ...(overrides.style || {}),
  };
  const font: RawParagraphStyleSnapshot["font"] = {
    eastAsia: "宋体",
    ascii: "Times New Roman",
    hAnsi: "Times New Roman",
    cs: "Times New Roman",
    sizePt: 16,
    bold: -1,
    italic: 0,
    color: 0,
    underline: 0,
    strikeThrough: 0,
    doubleStrikeThrough: 0,
    ...(overrides.font || {}),
  };
  const paragraph: RawParagraphStyleSnapshot["paragraph"] = {
    lineSpacingRule: 1,
    lineSpacing: null,
    beforePt: 0,
    before: { value: 0, unit: "pt" } as LengthValue,
    afterPt: 0,
    after: { value: 0, unit: "pt" } as LengthValue,
    leftIndent: 0,
    leftIndentValue: { value: 0, unit: "pt" } as LengthValue,
    leftIndentChars: null,
    rightIndent: 0,
    rightIndentValue: { value: 0, unit: "pt" } as LengthValue,
    rightIndentChars: null,
    firstLineIndent: 0,
    firstLineIndentValue: { value: 0, unit: "pt" } as LengthValue,
    firstLineIndentChars: null,
    hangingIndentValue: null,
    alignment: 0,
    snapToGrid: 1,
    ...(overrides.paragraph || {}),
  };
  const numbering: RawParagraphStyleSnapshot["numbering"] = {
    listType: 1,
    listValue: 1,
    level: 1,
    listString: "1",
    levelText: "%1",
    align: 0,
    numberPosition: 0,
    textPosition: 0,
    tabPosition: 0,
    trailingCharacter: 1,
    linkedStyle: "一级标题",
    ...(overrides.numbering || {}),
  };

  return {
    paragraphIndex: overrides.paragraphIndex ?? paragraphIndex,
    paragraphText: overrides.paragraphText ?? `第${paragraphIndex}段`,
    rangeStart: overrides.rangeStart ?? paragraphIndex * 10,
    rangeEnd: overrides.rangeEnd ?? paragraphIndex * 10 + 5,
    style,
    font,
    paragraph,
    numbering,
  };
}

function buildResult(raw: RawSelectionStyleSnapshot) {
  const structured = convertRawSelectionStyleSnapshot(raw);
  const comparison = compareParagraphStyles(structured.paragraphs);
  return buildSelectionStyleDescription(structured, comparison);
}

function testSingleParagraphDescription(): void {
  const raw: RawSelectionStyleSnapshot = {
    target: "cursorParagraph",
    selectionCollapsed: true,
    selectionStart: 100,
    selectionEnd: 100,
    paragraphs: [makeRawParagraph(1)],
  };

  const result = buildResult(raw);
  assert.equal(result.target, "cursorParagraph");
  assert.equal(result.style?.name, "一级标题");
  assert.equal(result.font?.sizeName, "三号");
  assert.equal(result.numbering?.suffix, "space");
  assert.match(result.naturalLanguage, /一级标题/);
  assert.match(result.naturalLanguage, /三号加粗/);
  assert.match(result.naturalLanguage, /1\.5 倍行距/);
  assert.match(result.naturalLanguage, /编号后使用空格/);
}

function testMultiParagraphConsistent(): void {
  const raw: RawSelectionStyleSnapshot = {
    target: "selection",
    selectionCollapsed: false,
    selectionStart: 10,
    selectionEnd: 40,
    paragraphs: [makeRawParagraph(1), makeRawParagraph(2)],
  };

  const result = buildResult(raw);
  assert.equal(result.target, "selectionMultiParagraph");
  assert.equal(result.styleConsistent, true);
  assert.equal(result.paragraphCount, 2);
  assert.match(result.naturalLanguage, /所选内容包含 2 个段落/);
  assert.match(result.naturalLanguage, /第1段使用一级标题样式/);
  assert.match(result.naturalLanguage, /第2段使用一级标题样式/);
}

function testMultiParagraphDifferenceSummary(): void {
  const raw: RawSelectionStyleSnapshot = {
    target: "selection",
    selectionCollapsed: false,
    selectionStart: 10,
    selectionEnd: 60,
    paragraphs: [
      makeRawParagraph(1),
      makeRawParagraph(2),
      makeRawParagraph(3, {
        style: { name: "正文", nameLocal: "正文" },
        font: { sizePt: 12, bold: 0 },
        numbering: {
          listType: 0,
          level: null,
          listString: null,
          levelText: null,
          align: null,
          numberPosition: null,
          textPosition: null,
          tabPosition: null,
          trailingCharacter: null,
          linkedStyle: null,
        },
      }),
    ],
  };

  const result = buildResult(raw);
  assert.equal(result.styleConsistent, false);
  assert.ok(result.differenceLabels.includes("字号"));
  assert.ok(result.differenceLabels.includes("加粗"));
  assert.match(result.naturalLanguage, /所选内容包含 3 个段落/);
  assert.match(result.naturalLanguage, /第1段使用一级标题样式/);
  assert.match(result.naturalLanguage, /第3段使用正文样式/);
}

function testNumberingTabSuffix(): void {
  const raw: RawSelectionStyleSnapshot = {
    target: "selection",
    selectionCollapsed: false,
    selectionStart: 20,
    selectionEnd: 30,
    paragraphs: [
      makeRawParagraph(1, {
        numbering: {
          listType: 1,
          listValue: 1,
          level: 2,
          listString: "1.1",
          levelText: "%1.%2",
          trailingCharacter: 0,
          align: 0,
          numberPosition: 0,
          textPosition: 0,
          tabPosition: 0,
          linkedStyle: "二级标题",
        },
      }),
    ],
  };
  const result = buildResult(raw);
  assert.equal(result.numbering?.suffix, "tab");
  assert.match(result.naturalLanguage, /编号后使用制表符/);
}

function testNoNumberingWhenOnlyDefaultLevelExists(): void {
  const raw: RawSelectionStyleSnapshot = {
    target: "selection",
    selectionCollapsed: false,
    selectionStart: 20,
    selectionEnd: 30,
    paragraphs: [
      makeRawParagraph(1, {
        numbering: {
          listType: 0,
          listValue: 0,
          level: 1,
          listString: null,
          levelText: "%1",
          align: 0,
          numberPosition: 0,
          textPosition: 0,
          tabPosition: 0,
          trailingCharacter: 1,
          linkedStyle: null,
        },
      }),
    ],
  };
  const result = buildResult(raw);
  assert.equal(result.numbering?.enabled, false);
  assert.match(result.naturalLanguage, /无编号设置/);
}

function testFirstLineIndentCharsPreferred(): void {
  const raw: RawSelectionStyleSnapshot = {
    target: "selection",
    selectionCollapsed: false,
    selectionStart: 20,
    selectionEnd: 30,
    paragraphs: [
      makeRawParagraph(1, {
        paragraph: {
          firstLineIndent: 24,
          firstLineIndentChars: 2,
        },
      }),
    ],
  };
  const result = buildResult(raw);
  assert.equal(result.paragraph?.firstLineIndentChars, 2);
  assert.equal(result.paragraph?.firstLineIndent, null);
  assert.match(result.naturalLanguage, /首行缩进 2 字符/);
}

function testRecognitionKeepsUnits(): void {
  const raw: RawSelectionStyleSnapshot = {
    target: "selection",
    selectionCollapsed: false,
    selectionStart: 20,
    selectionEnd: 30,
    paragraphs: [
      makeRawParagraph(1, {
        paragraph: {
          beforePt: 14.17,
          before: { value: 0.5, unit: "cm" },
          afterPt: 17.01,
          after: { value: 6, unit: "mm" },
          leftIndent: null,
          leftIndentValue: { value: 2, unit: "char" },
          leftIndentChars: 2,
          rightIndent: 14.4,
          rightIndentValue: { value: 0.2, unit: "inch" },
          firstLineIndent: null,
          firstLineIndentValue: { value: 2, unit: "char" },
          firstLineIndentChars: 2,
        },
      }),
    ],
  };
  const result = buildResult(raw);
  assert.match(result.naturalLanguage, /段前 0\.5 厘米/);
  assert.match(result.naturalLanguage, /段后 6 毫米/);
  assert.match(result.naturalLanguage, /左缩进 2 字符/);
  assert.match(result.naturalLanguage, /右缩进 0\.2 英寸/);
  assert.match(result.naturalLanguage, /首行缩进 2 字符/);
}

testSingleParagraphDescription();
testMultiParagraphConsistent();
testMultiParagraphDifferenceSummary();
testNumberingTabSuffix();
testFirstLineIndentCharsPreferred();
testRecognitionKeepsUnits();
testNoNumberingWhenOnlyDefaultLevelExists();

console.log("style-inspector tests passed");
