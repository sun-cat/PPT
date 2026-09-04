import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  codexChildEnvironment,
  generateCodexImage,
  testCodexCliConnection,
} from "../lib/codex-image-cli.mjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("Codex 子进程不会继承项目 API Key", () => {
  const env = codexChildEnvironment({
    PATH: "C:\\tools",
    OPENAI_API_KEY: "openai-secret",
    image_api_key: "image-secret",
    TEXT_API_KEY: "text-secret",
  });

  assert.equal(env.PATH, "C:\\tools");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.image_api_key, undefined);
  assert.equal(env.TEXT_API_KEY, undefined);
});

test("检测本机 Codex 的版本、登录状态和图片功能且不生图", async () => {
  const calls = [];
  const runCommand = async (args) => {
    calls.push(args);
    if (args[0] === "--version") return { code: 0, stdout: "codex-cli 1.2.3", stderr: "" };
    if (args[0] === "login") return { code: 0, stdout: "Logged in using ChatGPT", stderr: "" };
    return { code: 0, stdout: "image_generation stable true", stderr: "" };
  };

  const result = await testCodexCliConnection({ runCommand, cwd: process.cwd() });

  assert.equal(result.verified, true);
  assert.equal(result.providerMode, "codex-local");
  assert.match(result.message, /不会生成图片/);
  assert.deepEqual(calls, [
    ["--version"],
    ["login", "status"],
    ["features", "list"],
  ]);
});

test("未登录时给出可执行的 Codex 登录提示", async () => {
  const runCommand = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "codex-cli 1.2.3", stderr: "" };
    return { code: 1, stdout: "Not logged in", stderr: "" };
  };

  await assert.rejects(
    testCodexCliConnection({ runCommand }),
    /codex login/,
  );
});

test("通过临时隔离目录调用 Codex 生图并返回 data URL", async () => {
  let jobDir = "";
  let receivedPrompt = "";
  const runCommand = async (args, options) => {
    jobDir = options.cwd;
    receivedPrompt = options.input;
    assert.deepEqual(args.slice(0, 7), [
      "exec",
      "--ephemeral",
      "--json",
      "--sandbox",
      "workspace-write",
      "-C",
      jobDir,
    ]);
    assert.equal(args.at(-1), "-");
    await writeFile(path.join(jobDir, "result.png"), PNG_SIGNATURE);
    return { code: 0, stdout: "", stderr: "" };
  };

  const imageDataUrl = await generateCodexImage(
    { prompt: "制作一页简洁的课程封面" },
    { runCommand },
  );

  assert.equal(imageDataUrl, `data:image/png;base64,${PNG_SIGNATURE.toString("base64")}`);
  assert.match(receivedPrompt, /^\$imagegen/m);
  assert.match(receivedPrompt, /result\.png/);
  await assert.rejects(access(jobDir));
});

test("参考图只写入当前 Codex 临时任务目录", async () => {
  const sourceImage = `data:image/png;base64,${PNG_SIGNATURE.toString("base64")}`;
  let referencePath = "";
  const runCommand = async (args, options) => {
    const imageFlagIndex = args.indexOf("-i");
    assert.notEqual(imageFlagIndex, -1);
    referencePath = args[imageFlagIndex + 1];
    assert.equal(path.dirname(referencePath), options.cwd);
    assert.deepEqual(await readFile(referencePath), PNG_SIGNATURE);
    await writeFile(path.join(options.cwd, "result.png"), PNG_SIGNATURE);
    return { code: 0, stdout: "", stderr: "" };
  };

  await generateCodexImage(
    {
      prompt: "参考配色重新设计",
      referenceImageDataUrl: sourceImage,
      referenceImageName: "示例 图.png",
    },
    { runCommand },
  );

  await assert.rejects(access(referencePath));
});

test("Codex CLI 版本过旧时返回明确升级提示", async () => {
  const runCommand = async () => ({
    code: 1,
    stdout: "",
    stderr: "The model requires a newer version of Codex. Please upgrade to the latest app or CLI.",
  });

  await assert.rejects(
    generateCodexImage({ prompt: "一页课件" }, { runCommand }),
    /版本过旧.*升级 Codex CLI/,
  );
});

test("Codex 正常退出但没有生成文件时明确报错", async () => {
  const runCommand = async () => ({ code: 0, stdout: "", stderr: "" });

  await assert.rejects(
    generateCodexImage({ prompt: "一页课件" }, { runCommand }),
    /没有生成约定的 result\.png/,
  );
});
