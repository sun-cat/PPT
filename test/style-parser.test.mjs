import assert from "node:assert/strict";
import test from "node:test";
import { parsePageStyleScript } from "../public/style-parser.js";

test("parses page style and element blocks from one textarea", () => {
  const result = parsePageStyleScript(`第1页
画面风格：明亮、现代扁平插画
添加元素：
指南针、航海路线

第3页
页面风格：简洁商业信息图
画面元素：上升曲线、绿色箭头
补充要求：右侧保留标题区域`);

  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].pageNumber, 1);
  assert.equal(result.pages[0].style, "明亮、现代扁平插画");
  assert.equal(result.pages[0].elements, "指南针、航海路线");
  assert.match(result.pages[0].prompt, /本页画面风格/);
  assert.match(result.pages[1].prompt, /右侧保留标题区域/);
});

test("accepts an empty optional style script", () => {
  assert.deepEqual(parsePageStyleScript(""), { pages: [], warnings: [] });
});

test("rejects style instructions without page markers", () => {
  assert.throws(
    () => parsePageStyleScript("画面风格：清新明亮"),
    /第N页/,
  );
});
