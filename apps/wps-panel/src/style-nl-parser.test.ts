import assert from "node:assert/strict";
import { buildStructuredStyleSetFromNaturalLanguage } from "./style-nl-converter";
import { parseNaturalLanguageStyleInput } from "./style-nl-parser";

function getStyleByLevel(level: number, styles: ReturnType<typeof buildStructuredStyleSetFromNaturalLanguage>["styles"]) {
  const found = styles.find((item) => item.level === level);
  assert.ok(found, `缺少 ${level} 级标题样式`);
  return found;
}

function testStructuredSample(): void {
  const input = `
一级标题：
基于无样式，三号加粗，中文宋体，英文和复杂字体 Times New Roman，1.5 倍间距，其余都是 0，定义网格。编号对齐位置都是 0，编号和汉字之间不用制表符，用空格。

二级标题：
基于无样式，小三加粗；字体中文宋体，英文和复杂字体 Times New Roman；段落 1.5 倍间距，其余都是 0 或无，间距勾选定义网格；编号对齐位置都是 0，编号和汉字之间不用制表符，用空格。

三级标题：
基于无样式，四号加粗；字体中文宋体，英文和复杂字体 Times New Roman；段落 1.5 倍间距，其余都是 0 或无，间距勾选定义网格；编号对齐位置都是 0，编号和汉字之间不用制表符，用空格。

四级标题：
基于无样式，小四加粗；字体中文宋体，英文和复杂字体 Times New Roman；段落 1.5 倍间距，其余都是 0 或无，间距勾选定义网格；编号对齐位置都是 0，编号和汉字之间不用制表符，用空格。
`;

  const parsed = parseNaturalLanguageStyleInput(input);
  assert.equal(parsed.length, 4);

  const styleSet = buildStructuredStyleSetFromNaturalLanguage(input);
  assert.equal(styleSet.styles.length, 4);

  const sizeByLevel = new Map<number, number>([
    [1, 16],
    [2, 15],
    [3, 14],
    [4, 12],
  ]);

  for (const level of [1, 2, 3, 4]) {
    const style = getStyleByLevel(level, styleSet.styles);
    assert.equal(style.font.sizePt, sizeByLevel.get(level));
    assert.equal(style.font.bold, true);
    assert.equal(style.font.eastAsia, "宋体");
    assert.equal(style.font.ascii, "Times New Roman");
    assert.equal(style.font.hAnsi, "Times New Roman");
    assert.equal(style.font.cs, "Times New Roman");
    assert.equal(style.paragraph.lineSpacing, 1.5);
    assert.equal(style.paragraph.beforePt, 0);
    assert.equal(style.paragraph.afterPt, 0);
    assert.equal(style.paragraph.leftIndent, 0);
    assert.equal(style.paragraph.rightIndent, 0);
    assert.equal(style.paragraph.firstLineIndent, 0);
    assert.equal(style.paragraph.snapToGrid, true);
    assert.equal(style.numbering.leftIndent, 0);
    assert.equal(style.numbering.textIndent, 0);
    assert.equal(style.numbering.hanging, 0);
    assert.equal(style.numbering.suffix, "space");
    assert.equal(style.numbering.levelText, Array.from({ length: level }, (_, idx) => `%${idx + 1}`).join("."));
  }
}

function testMentionedLevelsFallback(): void {
  const input = "请把一级标题、二级标题统一改成小四加粗，中文宋体，英文和复杂字体 Times New Roman，不用制表符，用空格。";
  const styleSet = buildStructuredStyleSetFromNaturalLanguage(input);
  assert.equal(styleSet.styles.length, 2);
  const level1 = getStyleByLevel(1, styleSet.styles);
  const level2 = getStyleByLevel(2, styleSet.styles);
  assert.equal(level1.font.sizePt, 12);
  assert.equal(level2.font.sizePt, 12);
  assert.equal(level1.numbering.suffix, "space");
  assert.equal(level2.numbering.suffix, "space");
}

function testNoHeadingMentionDefaultAllLevels(): void {
  const input = "基于无样式，小三加粗，中文宋体，英文和复杂字体 Times New Roman，编号后用空格。";
  const styleSet = buildStructuredStyleSetFromNaturalLanguage(input);
  assert.equal(styleSet.styles.length, 4);
  for (const level of [1, 2, 3, 4]) {
    const style = getStyleByLevel(level, styleSet.styles);
    assert.equal(style.font.sizePt, 15);
    assert.equal(style.numbering.suffix, "space");
  }
}

testStructuredSample();
testMentionedLevelsFallback();
testNoHeadingMentionDefaultAllLevels();

console.log("style-nl-parser tests passed");
