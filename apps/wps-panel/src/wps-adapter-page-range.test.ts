import assert from "node:assert/strict";
import { resolvePageRangeBoundary } from "./wps-adapter";

function testResolvesMiddleRange(): void {
  const result = resolvePageRangeBoundary(
    [
      { start: 0, startPage: 1, endPage: 1, text: "封面" },
      { start: 12, startPage: 2, endPage: 2, text: "第一章 总论" },
      { start: 30, startPage: 3, endPage: 4, text: "跨页段落" },
      { start: 60, startPage: 5, endPage: 5, text: "第五页内容" },
    ],
    2,
    4,
    100,
    "第2页导出"
  );

  assert.deepEqual(result, {
    rangeStart: 12,
    rangeEnd: 60,
    title: "第一章 总论",
    paragraphCount: 2,
  });
}

function testResolvesRangeToDocumentEnd(): void {
  const result = resolvePageRangeBoundary(
    [
      { start: 5, startPage: 1, endPage: 1, text: "第一页" },
      { start: 25, startPage: 2, endPage: 2, text: "第二页" },
    ],
    2,
    9,
    80,
    "第2页导出"
  );

  assert.equal(result.rangeStart, 25);
  assert.equal(result.rangeEnd, 80);
  assert.equal(result.paragraphCount, 1);
}

function testRejectsEmptyRange(): void {
  assert.throws(
    () =>
      resolvePageRangeBoundary([{ start: 0, startPage: 1, endPage: 1, text: "第一页" }], 3, 4, 20, "第3页导出"),
    /未找到可处理的内容/
  );
}

testResolvesMiddleRange();
testResolvesRangeToDocumentEnd();
testRejectsEmptyRange();

console.log("wps-adapter page range tests passed");
