import { ProxyAgent } from "undici";
import { normalizeProxyUrl } from "./image-api.mjs";

const DEFAULT_TIMEOUT_MS = 180_000;

export function isDeepSeekEndpoint(value) {
  try {
    return new URL(String(value || "").trim()).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

function parseEndpoint(value, protocol = "auto") {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("请填写文字处理 API 地址。");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("文字处理 API 地址不是有效的 URL。");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("文字处理 API 仅支持 http 或 https。");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  const explicitChat = /\/chat\/completions$/i.test(pathname);
  const explicitResponses = /\/responses$/i.test(pathname);
  const mode =
    protocol === "chat"
      ? "chat"
      : protocol === "responses"
        ? "responses"
        : explicitChat
          ? "chat"
          : explicitResponses
            ? "responses"
            : isDeepSeekEndpoint(url.toString())
              ? "chat"
              : "responses";
  if (!explicitChat && !explicitResponses) {
    url.pathname = `${pathname}/${mode === "chat" ? "chat/completions" : "responses"}`.replace(
      /\/{2,}/g,
      "/",
    );
  } else {
    url.pathname = pathname;
  }
  url.hash = "";
  return { endpoint: url.toString(), protocol: mode };
}

export function normalizeTextEndpoint(value, protocol = "auto") {
  return parseEndpoint(value, protocol).endpoint;
}

function parseJsonObject(value, label) {
  if (value == null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const result = JSON.parse(String(value));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new Error(`${label}必须是 JSON 对象。`);
  }
}

function responseText(payload, protocol) {
  if (protocol === "chat") {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((item) => item?.text || item?.content || "").join("");
    }
  }
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") parts.push(content.text);
      else if (typeof content?.json === "object") parts.push(JSON.stringify(content.json));
    }
  }
  return parts.join("");
}

async function responseToJson(response, action) {
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const detail =
      payload?.error?.message || payload?.detail || payload?.message || raw.slice(0, 500) || "接口没有返回错误详情。";
    const error = new Error(`${action}失败（HTTP ${response.status}）：${detail}`);
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }
  return payload;
}

export async function generateText({
  endpoint,
  apiKey = "",
  model,
  protocol = "auto",
  instructions,
  input,
  extraBody = {},
  extraHeaders = {},
  proxyUrl = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  const resolved = parseEndpoint(endpoint, protocol);
  const requestedModel = String(model || "").trim();
  if (!requestedModel) throw new Error("请填写文字模型名称。");
  if (
    isDeepSeekEndpoint(endpoint) &&
    ["deepseek-chat", "deepseek-reasoner"].includes(requestedModel.toLowerCase())
  ) {
    throw new Error(
      "当前 DeepSeek 模型名称已更新，请改用 deepseek-v4-flash（笔记推荐）或 deepseek-v4-pro。",
    );
  }
  const bodyOverrides = parseJsonObject(extraBody, "额外请求参数");
  const headerOverrides = parseJsonObject(extraHeaders, "额外请求头");
  const normalizedProxy = normalizeProxyUrl(proxyUrl);
  const dispatcher = normalizedProxy ? new ProxyAgent(normalizedProxy) : null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const payload =
    resolved.protocol === "chat"
      ? {
          ...bodyOverrides,
          model: requestedModel,
          messages: [
            { role: "system", content: String(instructions || "") },
            { role: "user", content: String(input || "") },
          ],
        }
      : {
          ...bodyOverrides,
          model: requestedModel,
          instructions: String(instructions || ""),
          input: String(input || ""),
        };
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    ...(String(apiKey || "").trim()
      ? { authorization: `Bearer ${String(apiKey).trim()}` }
      : {}),
    ...headerOverrides,
  };

  try {
    const response = await fetchImpl(resolved.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    const result = await responseToJson(response, "文字生成");
    const text = responseText(result, resolved.protocol).trim();
    if (!text) throw new Error("文字模型没有返回可用内容。");
    return { text, endpoint: resolved.endpoint, protocol: resolved.protocol };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("文字模型响应超过 180 秒，已自动停止。请稍后重试或更换模型。");
    }
    if (/fetch failed|network|socket|connect/i.test(String(error?.message || ""))) {
      throw new Error(
        normalizedProxy
          ? "无法通过当前代理访问文字处理 API，请检查代理地址或服务状态。"
          : "当前网络无法访问文字处理 API，请检查地址、网络或代理设置。",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (dispatcher) await dispatcher.destroy();
  }
}

export async function testTextApiConnection(options) {
  const result = await generateText({
    ...options,
    instructions: "只回复四个汉字：连接正常。不要输出其他内容。",
    input: "检测文字模型接口。",
    timeoutMs: Math.min(Number(options?.timeoutMs) || 18_000, 18_000),
  });
  return {
    ok: true,
    verified: true,
    endpoint: result.endpoint,
    protocol: result.protocol,
    message: "文字模型、鉴权和生成接口均已验证。",
  };
}
