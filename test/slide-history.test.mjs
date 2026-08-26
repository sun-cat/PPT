import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SLIDE_HISTORY,
  createSlideHistorySnapshot,
  prepareSlideHistoryRestore,
  prependSlideHistory,
} from "../public/slide-history.js";

function slideFixture(overrides = {}) {
  return {
    title: "原始页面标题",
    pageText: "原始页面正文",
    visualPrompt: "原始画面提示词",
    pageStylePrompt: "本页画面风格：\n原始风格",
    prompt: "原始完整提示词",
    imageDataUrl: "data:image/png;base64,b3JpZ2luYWw=",
    history: [],
    ...overrides,
  };
}

test("单页历史快照完整保存图片、页纲、风格、元素和补充要求", () => {
  const snapshot = createSlideHistorySnapshot(
    slideFixture(),
    { style: " 原始风格 ", elements: " 青铜鼎 ", extra: " 右侧留白 " },
    { id: "version-1", createdAt: 12345 },
  );

  assert.deepEqual(snapshot, {
    id: "version-1",
    createdAt: 12345,
    title: "原始页面标题",
    pageText: "原始页面正文",
    visualPrompt: "原始画面提示词",
    pageStylePrompt: "本页画面风格：\n原始风格",
    prompt: "原始完整提示词",
    imageDataUrl: "data:image/png;base64,b3JpZ2luYWw=",
    styleFields: { style: "原始风格", elements: "青铜鼎", extra: "右侧留白" },
  });
});

test("没有已生成图片时不会创建无意义的历史记录", () => {
  assert.equal(createSlideHistorySnapshot(slideFixture({ imageDataUrl: "" })), null);
});

test("每一页仅保留最近六个历史版本", () => {
  let history = [];
  for (let index = 1; index <= MAX_SLIDE_HISTORY + 2; index += 1) {
    history = prependSlideHistory(
      history,
      createSlideHistorySnapshot(slideFixture(), {}, { id: `version-${index}` }),
    );
  }

  assert.equal(history.length, MAX_SLIDE_HISTORY);
  assert.deepEqual(history.map((item) => item.id), [
    "version-8",
    "version-7",
    "version-6",
    "version-5",
    "version-4",
    "version-3",
  ]);
});

test("恢复旧版本时当前图片和要求也会自动进入历史记录", () => {
  const previous = createSlideHistorySnapshot(
    slideFixture({ title: "上一版标题", imageDataUrl: "data:image/png;base64,b2xk" }),
    { style: "上一版风格" },
    { id: "older" },
  );
  const slide = slideFixture({ title: "当前标题", history: [previous] });
  const restored = prepareSlideHistoryRestore(slide, "older", {
    style: "当前风格",
    elements: "当前元素",
  });

  assert.equal(restored.selected.title, "上一版标题");
  assert.equal(restored.history.length, 1);
  assert.equal(restored.history[0].title, "当前标题");
  assert.equal(restored.history[0].styleFields.style, "当前风格");
  assert.equal(restored.history[0].styleFields.elements, "当前元素");
});

test("当前页面尚未重新生成时仍可以直接恢复历史图片", () => {
  const previous = createSlideHistorySnapshot(slideFixture(), {}, { id: "older" });
  const slide = slideFixture({ imageDataUrl: "", history: [previous] });
  const restored = prepareSlideHistoryRestore(slide, "older");

  assert.equal(restored.selected.title, "原始页面标题");
  assert.deepEqual(restored.history, []);
});

test("不存在的历史版本会给出明确提示", () => {
  assert.throws(
    () => prepareSlideHistoryRestore(slideFixture(), "missing"),
    /历史版本已经不存在/,
  );
});
