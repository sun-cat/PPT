import test from "node:test";
import assert from "node:assert/strict";
import {
  generateText,
  isDeepSeekEndpoint,
  normalizeTextEndpoint,
} from "../lib/text-api.mjs";

test("normalizeTextEndpoint 为 Base URL 补全 Responses 路径", () => {
  assert.equal(
    normalizeTextEndpoint("https://api.example.com/v1"),
    "https://api.example.com/v1/responses",
  );
  assert.equal(
    normalizeTextEndpoint("https://api.example.com/v1", "chat"),
    "https://api.example.com/v1/chat/completions",
  );
});

test("DeepSeek Base URL 自动使用兼容范围更广的 Chat Completions", () => {
  assert.equal(isDeepSeekEndpoint("https://api.deepseek.com"), true);
  assert.equal(isDeepSeekEndpoint("https://api.example.com"), false);
  assert.equal(
    normalizeTextEndpoint("https://api.deepseek.com"),
    "https://api.deepseek.com/chat/completions",
  );
  assert.equal(
    normalizeTextEndpoint("https://api.deepseek.com", "responses"),
    "https://api.deepseek.com/responses",
  );
});

test("generateText 使用 Responses 请求并读取 output_text", async () => {
  let request;
  const result = await generateText({
    endpoint: "https://api.example.com/v1",
    apiKey: "test-key",
    model: "text-model",
    instructions: "严格依据资料",
    input: "课件内容",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ output_text: "{\"body\":\"正文\"}" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(request.url, "https://api.example.com/v1/responses");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "text-model");
  assert.equal(body.instructions, "严格依据资料");
  assert.equal(result.text, '{"body":"正文"}');
});

test("generateText 兼容 Chat Completions 返回", async () => {
  let requestBody;
  const result = await generateText({
    endpoint: "https://api.example.com/v1/chat/completions",
    model: "chat-model",
    instructions: "系统要求",
    input: "用户资料",
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "聊天结果" } }] }),
        { status: 200 },
      );
    },
  });
  assert.equal(requestBody.messages[0].role, "system");
  assert.equal(requestBody.messages[1].content, "用户资料");
  assert.equal(result.protocol, "chat");
  assert.equal(result.text, "聊天结果");
});

test("DeepSeek 旧模型名返回明确迁移提示", async () => {
  await assert.rejects(
    generateText({
      endpoint: "https://api.deepseek.com",
      model: "deepseek-chat",
      instructions: "系统要求",
      input: "用户资料",
      fetchImpl: async () => new Response(),
    }),
    /deepseek-v4-flash/,
  );
});

test("generateText 不允许额外参数覆盖模型与用户输入", async () => {
  let requestBody;
  await generateText({
    endpoint: "https://api.example.com/v1",
    model: "safe-model",
    instructions: "事实约束",
    input: "真实课件",
    extraBody: '{"model":"wrong-model","input":"错误资料"}',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ output_text: "完成" }), { status: 200 });
    },
  });
  assert.equal(requestBody.model, "safe-model");
  assert.equal(requestBody.input, "真实课件");
});
