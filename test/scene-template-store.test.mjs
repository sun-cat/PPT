import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MAX_SCENE_TEMPLATES,
  sceneTemplateStoreMetadata,
} from "../public/scene-template-store.js";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const tools = await readFile(new URL("../public/tools.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

test("常用场景使用独立 IndexedDB 存放原图和轻量摘要", () => {
  assert.equal(sceneTemplateStoreMetadata.databaseName, "mini-hanghai-scene-templates-v1");
  assert.equal(sceneTemplateStoreMetadata.templateStore, "templates");
  assert.equal(sceneTemplateStoreMetadata.summaryStore, "summaries");
  assert.equal(MAX_SCENE_TEMPLATES, 12);
});

test("场景换图页提供保存 使用 重命名和删除入口", () => {
  assert.match(server, /\["\/scene-template-store\.js"/);
  assert.match(html, /id="sceneTemplateName"/);
  assert.match(html, /id="saveSceneTemplateButton"/);
  assert.match(html, /id="sceneTemplateList"/);
  assert.match(tools, /data-template-action/);
  assert.match(tools, /useSceneTemplate/);
  assert.match(tools, /startSceneTemplateRename/);
  assert.match(tools, /commitSceneTemplateRename/);
  assert.match(tools, /removeStoredSceneTemplate/);
});

test("模板保存背景图 四点定位和画面贴合设置", () => {
  assert.match(tools, /imageBlob/);
  assert.match(tools, /points: perspectiveState\.points\.map/);
  assert.match(tools, /options: perspectiveOptions\(\)/);
  assert.match(tools, /applySceneTemplateOptions/);
  assert.match(tools, /window\.confirm/);
});
