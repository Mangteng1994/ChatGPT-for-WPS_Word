import assert from "node:assert/strict";
import { parseGenericStylesFromNaturalLanguage } from "./style-nl-generic";

function testParseBodyStyle(): void {
  const input =
    "正文：小四不加粗，不倾斜，中文字体为 宋体，复杂字体为 Times New Roman，字体颜色为 #000000；段落为1.5 倍行距，段前段后均为 0，左缩进 0，右缩进 0，首行缩进 24，对齐方式为两端对齐；编号为一级编号，编号后字符未读取到明确设置。";
  const result = parseGenericStylesFromNaturalLanguage(input);
  assert.equal(result.explicitSections.length, 1);
  assert.equal(result.nonHeadingSections.length, 1);
  const style = result.nonHeadingSections[0];
  assert.equal(style.name, "正文");
  assert.equal(style.styleType, "paragraph");
  assert.equal(style.font.sizePt, 12);
  assert.equal(style.font.bold, false);
  assert.equal(style.font.italic, false);
  assert.equal(style.font.eastAsia, "宋体");
  assert.equal(style.font.cs, "Times New Roman");
  assert.equal(style.font.color, "#000000");
  assert.equal(style.paragraph.lineSpacingRule, "onePointFive");
  assert.equal(style.paragraph.beforePt, 0);
  assert.equal(style.paragraph.afterPt, 0);
  assert.equal(style.paragraph.firstLineIndent, 24);
  assert.equal(style.paragraph.firstLineIndentChars, null);
  assert.equal(style.paragraph.alignment, "justify");
  assert.equal(style.numbering.enabled, true);
  assert.equal(style.numbering.level, 1);
}

function testParseCaptionStyle(): void {
  const input =
    "图名：所选段落使用图名样式（段落样式），基于题注，五号加粗，不倾斜，中文字体为 宋体，英文和复杂字体为 Times New Roman，字体颜色为 #000000；段落为单倍行距，段前 0，段后 7.8，左缩进、右缩进和首行缩进均为 0，对齐方式为居中；编号为一级编号，编号后字符未读取到明确设置。";
  const result = parseGenericStylesFromNaturalLanguage(input);
  assert.equal(result.explicitSections.length, 1);
  const style = result.explicitSections[0];
  assert.equal(style.name, "图名");
  assert.equal(style.basedOn, "题注");
  assert.equal(style.font.sizePt, 10.5);
  assert.equal(style.font.bold, true);
  assert.equal(style.font.italic, false);
  assert.equal(style.font.ascii, "Times New Roman");
  assert.equal(style.paragraph.lineSpacingRule, "single");
  assert.equal(style.paragraph.afterPt, 7.8);
  assert.equal(style.paragraph.alignment, "center");
}

function testParseFirstLineIndentCharsAndNoNumbering(): void {
  const input = "正文：首行缩进为2字符，左缩进 0，右缩进 0；明确没有编号。";
  const result = parseGenericStylesFromNaturalLanguage(input);
  assert.equal(result.explicitSections.length, 1);
  const style = result.explicitSections[0];
  assert.equal(style.paragraph.firstLineIndentChars, 2);
  assert.equal(style.paragraph.firstLineIndentValue?.unit, "char");
  assert.equal(style.paragraph.firstLineIndent, null);
  assert.equal(style.numbering.enabled, false);
}

function testParseChineseNumeralFirstLineIndentChars(): void {
  const input = "正文：首行缩进两个字符，左缩进 0，右缩进 0。";
  const result = parseGenericStylesFromNaturalLanguage(input);
  assert.equal(result.explicitSections.length, 1);
  const style = result.explicitSections[0];
  assert.equal(style.paragraph.firstLineIndentChars, 2);
  assert.equal(style.paragraph.firstLineIndent, null);
}

function testParseMixedUnits(): void {
  const input = "正文：段前 0.5 厘米，段后 6 mm，左缩进 2 字符，右缩进 0.2 英寸，悬挂缩进 3 磅。";
  const result = parseGenericStylesFromNaturalLanguage(input);
  assert.equal(result.explicitSections.length, 1);
  const style = result.explicitSections[0];
  assert.equal(style.paragraph.before?.unit, "cm");
  assert.equal(style.paragraph.after?.unit, "mm");
  assert.equal(style.paragraph.leftIndentValue?.unit, "char");
  assert.equal(style.paragraph.rightIndentValue?.unit, "inch");
  assert.equal(style.paragraph.hangingIndentValue?.unit, "pt");
}

function testParseAlphabeticNumberingFormat(): void {
  const input = "7级标题：小四加粗；编号为一级编号，格式为 a.，编号后使用空格，不使用制表符。";
  const result = parseGenericStylesFromNaturalLanguage(input);
  assert.equal(result.explicitSections.length, 1);
  const style = result.explicitSections[0];
  assert.equal(style.numbering.enabled, true);
  assert.equal(style.numbering.level, 1);
  assert.equal(style.numbering.format, "lowerLetter");
  assert.equal(style.numbering.displayFormat, "a.");
  assert.equal(style.numbering.levelText, "%1.");
  assert.equal(style.numbering.suffix, "space");
}

function testParseCircleAndParenthesizedNumberingFormat(): void {
  const input =
    "5级标题：编号为一级编号，格式为 ⑴，编号后使用空格，不使用制表符。\n6级标题：编号为一级编号，格式为 ①，编号后使用空格，不使用制表符。";
  const result = parseGenericStylesFromNaturalLanguage(input);
  assert.equal(result.explicitSections.length, 2);

  const style5 = result.explicitSections[0];
  assert.equal(style5.name, "5级标题");
  assert.equal(style5.numbering.format, "parenthesizedNumber");
  assert.equal(style5.numbering.displayFormat, "⑴");
  assert.equal(style5.numbering.levelText, "%1");

  const style6 = result.explicitSections[1];
  assert.equal(style6.name, "6级标题");
  assert.equal(style6.numbering.format, "numberInCircle");
  assert.equal(style6.numbering.displayFormat, "①");
  assert.equal(style6.numbering.levelText, "%1");
}

testParseBodyStyle();
testParseCaptionStyle();
testParseFirstLineIndentCharsAndNoNumbering();
testParseChineseNumeralFirstLineIndentChars();
testParseMixedUnits();
testParseAlphabeticNumberingFormat();
testParseCircleAndParenthesizedNumberingFormat();

console.log("style-nl-generic tests passed");
