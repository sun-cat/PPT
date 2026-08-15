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
  assert.match(html, /tools\.js\?v=20260812-scene-template-library-v1/);
  assert.match(tools, /image-tool-math\.js\?v=20260812-collage-two-layouts-fix1/);
  assert.match(tools, /scene-template-store\.js\?v=20260812-scene-template-library-v1/);
});

test("商品主图提供两种可访问的版式选项", () => {
  assert.match(html, /name="collageTemplate" value="classic" checked/);
  assert.match(html, /name="collageTemplate" value="showcase"/);
  assert.match(html, /顶部主视觉＋下方 3×4 课件页/);
});
