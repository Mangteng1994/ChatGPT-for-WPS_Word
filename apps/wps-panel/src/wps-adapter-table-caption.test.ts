import assert from "node:assert/strict";
import { buildPageExportFileName, ensureUniqueDocxFileName, isLikelyTableCaptionText, normalizePageExportTitle } from "./wps-adapter";

function testRecognizesTableCaptions(): void {
  assert.equal(isLikelyTableCaptionText("表1 试验结果"), true);
  assert.equal(isLikelyTableCaptionText("表 2-1 主要指标"), true);
  assert.equal(isLikelyTableCaptionText("附表A 参数对照"), true);
  assert.equal(isLikelyTableCaptionText("Table 3 Results Summary"), true);
}

function testRejectsNonCaptionText(): void {
  assert.equal(isLikelyTableCaptionText("表明本研究具有可行性"), false);
  assert.equal(isLikelyTableCaptionText("这是表格前的说明文字"), false);
  assert.equal(isLikelyTableCaptionText(""), false);
}

function testNormalizesPageExportTitle(): void {
  assert.equal(normalizePageExportTitle("\r\n  起始页第一行  \r\n第二行"), "起始页第一行");
  assert.equal(normalizePageExportTitle("   ", "第5页导出"), "第5页导出");
}

function testBuildsPageExportFileName(): void {
  assert.equal(buildPageExportFileName("第一章：总论/背景"), "第一章：总论_背景.docx");
  assert.equal(buildPageExportFileName("   "), "页码导出.docx");
}

function testEnsuresUniqueDocxFileName(): void {
  const used = new Set<string>();
  assert.equal(ensureUniqueDocxFileName("页码导出.docx", used), "页码导出.docx");
  assert.equal(ensureUniqueDocxFileName("页码导出.docx", used), "页码导出_2.docx");
  assert.equal(ensureUniqueDocxFileName("页码导出.DOCX", used), "页码导出_3.DOCX");
}

testRecognizesTableCaptions();
testRejectsNonCaptionText();
testNormalizesPageExportTitle();
testBuildsPageExportFileName();
testEnsuresUniqueDocxFileName();

console.log("wps-adapter table caption tests passed");
