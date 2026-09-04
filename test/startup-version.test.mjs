import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const packageInfo = JSON.parse(fs.readFileSync("package.json", "utf8"));
const server = fs.readFileSync("server.mjs", "utf8");
const windowsLauncher = fs.readFileSync("scripts/start.ps1", "utf8");
const macLauncher = fs.readFileSync("苹果系统点这里运行软件.command", "utf8");
const macFirstRunGuide = fs.readFileSync("00-苹果电脑首次使用-先看这里.html", "utf8");
const macRepairCommand = fs.readFileSync("01-苹果无法打开-复制这条命令.txt", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");

test("启动器按版本识别旧后台并优先保留固定端口上的本机数据", () => {
  assert.equal(packageInfo.version, "6.9.2");
  assert.match(server, /service: "shengcai-mini-ppt", version: appVersion/);
  assert.match(server, /useSystemProxyForWukong \? resolveProxyUrl\(\) : ""/);
  assert.match(server, /fallbackProxyUrl: fallbackProxy/);
  assert.match(windowsLauncher, /expectedVersion/);
  assert.match(windowsLauncher, /3210\.\.3220/);
  assert.match(windowsLauncher, /To preserve browser API settings and courseware archives/);
  assert.match(windowsLauncher, /\[string\]\$health\.version -ne \$expectedVersion/);
  assert.match(macLauncher, /EXPECTED_VERSION/);
  assert.match(macLauncher, /CANDIDATE_PORT=3210/);
  assert.match(macLauncher, /为了保留 API 配置和课件时光舱/);
  assert.match(macLauncher, /! printf "%s" "\$RUNNING_HEALTH"/);
});

test("PPT 导出请求上限提高到 200 MB", () => {
  assert.match(server, /const MAX_EXPORT_REQUEST_BYTES = 200 \* 1024 \* 1024/);
  assert.match(server, /readJson\(request, MAX_EXPORT_REQUEST_BYTES\)/);
  assert.doesNotMatch(server, /readJson\(request, 120 \* 1024 \* 1024\)/);
});

test("苹果首次使用页提供 Gatekeeper 和终端备用处理方式", () => {
  assert.match(macFirstRunGuide, /隐私与安全性/);
  assert.match(macFirstRunGuide, /仍要打开/);
  assert.match(macFirstRunGuide, /xattr -dr com\.apple\.quarantine/);
  assert.match(macFirstRunGuide, /osascript/);
  assert.match(macFirstRunGuide, /choose folder/);
  assert.match(macFirstRunGuide, /Expected at least 2 but got 1/);
  assert.match(macFirstRunGuide, /chmod \+x/);
  assert.match(macFirstRunGuide, /不要点“移到废纸篓”/);
  assert.match(macRepairCommand, /osascript/);
  assert.match(macRepairCommand, /xattr -dr com\.apple\.quarantine "\$TOOL_DIR"/);
  assert.match(macRepairCommand, /open "\$LAUNCHER"/);
});

test("笔记模块使用独立缓存版本，避免新页面加载旧脚本", () => {
  assert.match(html, /note-tool\.js\?v=20260811-seeding-notes-v3/);
});

test("本地图片工具使用新版缓存标记，避免学员继续加载旧功能", () => {
  const tools = fs.readFileSync("public/tools.js", "utf8");
  assert.match(html, /tools\.js\?v=20260826-batch-collage-v1/);
  assert.match(tools, /image-tool-math\.js\?v=20260826-batch-collage-v1/);
  assert.match(tools, /scene-template-store\.js\?v=20260812-scene-template-library-v1/);
});

test("商品主图提供两种可访问的版式选项", () => {
  assert.match(html, /name="collageTemplate" value="classic" checked/);
  assert.match(html, /name="collageTemplate" value="showcase"/);
  assert.match(html, /顶部主视觉＋下方 3×4 课件页/);
});

test("PPT 拼图可切换批量模式并提供顺序分组和 ZIP 导出", () => {
  const tools = fs.readFileSync("public/tools.js", "utf8");
  assert.match(html, /name="collageMode" value="batch"/);
  assert.match(html, /name="batchLayout" value="theme-grid" checked/);
  assert.match(html, /name="batchLayout" value="five"/);
  assert.match(html, /id="downloadCollageZip"/);
  assert.match(tools, /chunkSequential\(getSelectedBatchPages\(\), size\)/);
  assert.match(tools, /createStoredZip\(entries\)/);
});

test("生成页面提供单页页纲及风格编辑，并只重置当前页面", () => {
  const app = fs.readFileSync("public/app.js", "utf8");
  assert.match(html, /id="slideEditDialog"/);
  assert.match(html, /data-edit-mode="outline">修改页纲/);
  assert.match(html, /data-edit-mode="style">修改风格和元素/);
  assert.match(html, /保存后只有这一页需要重新生成/);
  assert.match(html, /app\.js\?v=20260904-codex-local-v1/);
  assert.match(app, /projectFields\.scriptInput\.value = slidesToScript\(slides\)/);
  assert.match(app, /updatePageStyleScript\(/);
  assert.match(app, /function resetEditedSlide\(slide\)/);
});

test("单页历史可以预览和恢复完整版本，且不会调用生图接口", () => {
  const app = fs.readFileSync("public/app.js", "utf8");
  assert.match(html, /id="slideHistoryDialog"/);
  assert.match(html, /class="slide-edit-button slide-history-button"/);
  assert.match(html, /恢复不会扣费/);
  assert.match(server, /\["\/slide-history\.js"/);
  assert.match(app, /createSlideHistorySnapshot/);
  assert.match(app, /prepareSlideHistoryRestore/);

  const start = app.indexOf("function restoreSlideHistoryVersion");
  const end = app.indexOf("function showWarnings", start);
  assert.ok(start >= 0 && end > start, "slide history restore function was not found");
  const restoreSource = app.slice(start, end);
  assert.match(restoreSource, /slide\.imageDataUrl = selected\.imageDataUrl/);
  assert.doesNotMatch(restoreSource, /generateOne\(|\/api\/generate-image|apiRequest\(/);
});

test("悟空生图可选择具体 product_id 并限制安全并发", () => {
  const app = fs.readFileSync("public/app.js", "utf8");
  const queue = fs.readFileSync("public/generation-queue.js", "utf8");
  assert.match(html, /id="wukongProduct"/);
  assert.match(html, /image_nanoBanana2/);
  assert.match(html, /image_gptImage2/);
  assert.match(html, /image_nanoBanana_pro/);
  assert.match(app, /existingWukongTask: slide\.pendingTask/);
  assert.match(app, /继续取回结果/);
  assert.match(queue, /fallback = 2/);
});

test("悟空双推荐与计费估算免责声明清晰展示", () => {
  const app = fs.readFileSync("public/app.js", "utf8");
  assert.match(app, /WUKONG_RECOMMENDED_PRODUCTS/);
  assert.match(app, /"image_nanoBanana2"/);
  assert.match(app, /"image_gptImage2"/);
  assert.match(html, /计费说明/);
  assert.match(html, /仅根据 API 中转站当前返回的信息进行估算/);
  assert.match(html, /API 中转站后台消费明细为准/);
  assert.match(html, /页面价格仅为 API 中转站估算/);
  assert.match(app, /此金额仅供估算/);
});

test("本机 Codex、悟空与 APIMart 提供平级快速切换并分别保存本机配置", () => {
  const app = fs.readFileSync("public/app.js", "utf8");
  assert.match(html, /id="codexLocalPreset"/);
  assert.match(html, /id="wukongPreset"/);
  assert.match(html, /id="apiMartPreset"/);
  assert.match(html, /本机 Codex.*无需填写 API 地址或 API Key/s);
  assert.match(app, /visiondeck-api-provider-profiles-v1/);
  assert.match(app, /switchApiProvider\("codex-local"\)/);
  assert.match(app, /switchApiProvider\("wukong"\)/);
  assert.match(app, /switchApiProvider\("apimart"\)/);
  assert.match(app, /profiles\[profileId\] = storedSettings/);
  assert.match(app, /1 张（本机 Codex 串行）/);
  assert.match(app, /Codex 当前使用额度/);
});

test("悟空上游超时会暂停批量提交且刷新脚本缓存", () => {
  const app = fs.readFileSync("public/app.js", "utf8");
  assert.match(html, /app\.js\?v=20260904-codex-local-v1/);
  assert.match(app, /generation-queue\.js\?v=20260818-wukong-migration1/);
  assert.match(app, /shouldHaltBatchGeneration/);
  assert.match(app, /上游生图超时/);
  assert.match(app, /工具不会自动重新提交/);
  assert.match(app, /if \(batchHaltReason\) return false/);
  assert.match(app, /生成异常，批量生成已暂停/);
});
