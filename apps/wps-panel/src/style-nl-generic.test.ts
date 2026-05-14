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

testParseBodyStyle();
testParseCaptionStyle();
testParseFirstLineIndentCharsAndNoNumbering();
testParseChineseNumeralFirstLineIndentChars();

console.log("style-nl-generic tests passed");
