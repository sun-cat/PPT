import assert from "node:assert/strict";
import test from "node:test";
import { parseDeckScript } from "../public/script-parser.js";

test("parses the requested page-title-text format", () => {
  const result = parseDeckScript(`第1页
页面标题：开场
页面文字：
第一行
第二行

第2页
页面标题：结论
页面文字：立即行动`);

  assert.equal(result.pages.length, 2);
  assert.deepEqual(result.pages[0], {
    pageNumber: 1,
    title: "开场",
    pageText: "第一行\n第二行",
    visualPrompt: "",
  });
  assert.equal(result.pages[1].title, "结论");
  assert.equal(result.pages[1].pageText, "立即行动");
});

test("accepts an optional visual prompt block", () => {
  const result = parseDeckScript(`第3页
页面标题：增长
页面文字：同比增长 42%
画面提示词：
左文右图，深色背景`);
  assert.equal(result.pages[0].visualPrompt, "左文右图，深色背景");
});

test("rejects text without page markers", () => {
  assert.throws(() => parseDeckScript("页面标题：没有页码"), /第N页/);
});

test("warns when page numbers are not continuous", () => {
  const result = parseDeckScript(`第1页
页面标题：开始
页面文字：正文

第3页
页面标题：结尾
页面文字：正文`);
  assert.ok(result.warnings.some((warning) => /缺少第 2 页/.test(warning)));
});
