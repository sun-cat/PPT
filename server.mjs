import fs from "node:fs";
import fsp from "node:fs/promises";
import { execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSlidePrompt,
  generateSlideImage,
  isWukongStudioEndpoint,
  normalizeProxyUrl,
  testImageApiConnection,
} from "./lib/image-api.mjs";
import { buildImageOnlyPptx } from "./lib/presentation.mjs";
import { extractPptxPageImages } from "./lib/pptx-images.mjs";
import { renderPptxPageImages } from "./lib/pptx-renderer.mjs";
import { generateText, testTextApiConnection } from "./lib/text-api.mjs";
import {
  buildKeywordSuggestionPrompts,
  buildNotePrompts,
  parseKeywordSuggestionOutput,
  parseNoteModelOutput,
  validateNoteRequest,
} from "./public/note-writing.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const packageManifest = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const appVersion = String(packageManifest.version || "0.0.0");
loadEnvFile(path.join(rootDir, ".env"));

const port = Number.parseInt(process.env.PORT || "3210", 10);
const host = "127.0.0.1";
const detectedSystemProxyUrl = detectSystemProxyUrl();
const mockImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4Gf9QAAAABJRU5ErkJggg==";

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/assets/shengcai-logo.png", ["assets/shengcai-logo.png", "image/png"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/generation-queue.js", ["generation-queue.js", "text/javascript; charset=utf-8"]],
  ["/api-settings.js", ["api-settings.js", "text/javascript; charset=utf-8"]],
  ["/archive-store.js", ["archive-store.js", "text/javascript; charset=utf-8"]],
  ["/scene-template-store.js", ["scene-template-store.js", "text/javascript; charset=utf-8"]],
  ["/script-parser.js", ["script-parser.js", "text/javascript; charset=utf-8"]],
  ["/style-parser.js", ["style-parser.js", "text/javascript; charset=utf-8"]],
  ["/tools.js", ["tools.js", "text/javascript; charset=utf-8"]],
  ["/zip-store.js", ["zip-store.js", "text/javascript; charset=utf-8"]],
  ["/image-tool-math.js", ["image-tool-math.js", "text/javascript; charset=utf-8"]],
  ["/note-writing.js", ["note-writing.js", "text/javascript; charset=utf-8"]],
  ["/note-tool.js", ["note-tool.js", "text/javascript; charset=utf-8"]],
]);

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("请求内容过大。");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求 JSON 格式无效。");
    error.statusCode = 400;
    throw error;
  }
}

async function readBuffer(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("PPTX 文件过大，请控制在 180 MB 以内。");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseObject(value, label) {
  if (value == null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label}必须是 JSON 对象。`);
  }
}

function safeFilename(value) {
  const clean = String(value || "生财有术mini航海原创PPT课件")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 80);
  return clean || "生财有术mini航海原创PPT课件";
}

function resolveProxyUrl(explicitValue = "") {
  return (
    String(explicitValue || "").trim() ||
    process.env.IMAGE_API_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    detectedSystemProxyUrl ||
    ""
  );
}

function normalizeDetectedProxyValue(value = "") {
  let candidate = String(value || "").trim();
  if (!candidate) return "";
  if (candidate.includes(";") || /^(?:http|https)=/i.test(candidate)) {
    const entries = new Map();
    for (const entry of candidate.split(";")) {
      const match = entry.match(/^\s*([^=]+)=(.+?)\s*$/);
      if (match) entries.set(match[1].toLowerCase(), match[2].trim());
    }
    candidate = entries.get("https") || entries.get("http") || "";
  }
  if (!candidate) return "";
  try {
    return normalizeProxyUrl(candidate);
  } catch {
    return "";
  }
}

function detectSystemProxyUrl() {
  try {
    if (process.platform === "win32") {
      const registryKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
      const enabled = execFileSync(
        "reg.exe",
        ["query", registryKey, "/v", "ProxyEnable"],
        { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      if (!/REG_DWORD\s+0x1\b/i.test(enabled)) return "";
      const configured = execFileSync(
        "reg.exe",
        ["query", registryKey, "/v", "ProxyServer"],
        { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      const match = configured.match(/ProxyServer\s+REG_SZ\s+(.+)$/im);
      return normalizeDetectedProxyValue(match?.[1] || "");
    }
    if (process.platform === "darwin") {
      const configured = execFileSync("scutil", ["--proxy"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const prefix of ["HTTPS", "HTTP"]) {
        const enabled = configured.match(new RegExp(`${prefix}Enable\\s*:\\s*(\\d+)`, "i"));
        const hostMatch = configured.match(new RegExp(`${prefix}Proxy\\s*:\\s*(.+)`, "i"));
        const portMatch = configured.match(new RegExp(`${prefix}Port\\s*:\\s*(\\d+)`, "i"));
        if (enabled?.[1] === "1" && hostMatch?.[1] && portMatch?.[1]) {
          return normalizeDetectedProxyValue(`${hostMatch[1].trim()}:${portMatch[1]}`);
        }
      }
    }
  } catch {
    // System proxy detection is best-effort; direct access remains available.
  }
  return "";
}

function resolveImageProxyUrl(
  explicitValue = "",
  endpoint = "",
  useSystemProxyForWukong = false,
) {
  const explicitProxy = String(explicitValue || "").trim();
  if (explicitProxy) return explicitProxy;
  if (isWukongStudioEndpoint(endpoint)) {
    return useSystemProxyForWukong ? resolveProxyUrl() : "";
  }
  return resolveProxyUrl();
}

function resolveTextProxyUrl(explicitValue = "") {
  return (
    String(explicitValue || "").trim() ||
    process.env.TEXT_API_PROXY ||
    resolveProxyUrl()
  );
}

function mockNoteResult(input) {
  const request = validateNoteRequest(input);
  return {
    titles: [
      `${request.coreKeyword}原来要这样讲🔥`,
      `别急着讲知识先讲${request.coreKeyword}`,
      `${request.coreKeyword}备课思路✨`,
    ],
    body: [
      `准备${request.coreKeyword}时，我一开始也想把知识点尽量塞满。后来发现，第一节课更重要的是先让学生知道接下来要怎么学。`,
      `所以这套“${request.sourceTitle || "当前课件"}”没有逐页堆内容，而是从一个清晰的问题切进去，再挑几个最有代表性的变化让学生看懂。老师拿来备课时，也更容易找到自己的讲课节奏。`,
      "我比较喜欢这种思路：不是课件页数越多越好，而是每一页都能回应课堂里的真实问题。",
    ].join("\n\n"),
    posterText: "不是讲得多而是先讲明白",
    imagePlan: ["第1张：课件封面", "第2张：核心内容页", "第3张：使用场景或细节页"],
    hashtags: [request.coreKeyword, ...request.longTailKeywords.slice(0, 7)],
    factBasis: [
      { fact: `笔记主题来自${request.coreKeyword}`, source: "核心关键词" },
      { fact: "正文只使用当前课件资料", source: "课件原文" },
    ],
  };
}

function describeConfiguredProxy(value) {
  if (!value) return "";
  try {
    const url = new URL(normalizeProxyUrl(value));
    return `${url.hostname}:${url.port}`;
  } catch {
    return "代理已配置";
  }
}

async function serveStatic(response, pathname) {
  const entry = staticFiles.get(pathname);
  if (!entry) {
    sendJson(response, 404, { error: "页面不存在。" });
    return;
  }
  const [filename, contentType] = entry;
  const body = await fsp.readFile(path.join(publicDir, filename));
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === "GET" && url.pathname === "/api/config") {
    const proxyUrl = resolveProxyUrl();
    sendJson(response, 200, {
      endpoint: process.env.IMAGE_API_URL || "",
      editEndpoint: process.env.IMAGE_EDIT_API_URL || "",
      model: process.env.IMAGE_MODEL || "",
      size: process.env.IMAGE_API_SIZE || "2048x1152",
      quality: process.env.IMAGE_API_QUALITY || "high",
      hasServerApiKey: Boolean(process.env.IMAGE_API_KEY),
      mockMode: process.env.MOCK_IMAGE_API === "1",
      mockTextMode: process.env.MOCK_TEXT_API === "1",
      proxyDetected: Boolean(proxyUrl),
      proxyLabel: describeConfiguredProxy(proxyUrl),
      appVersion,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "shengcai-mini-ppt", version: appVersion });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/generate-image") {
    const input = await readJson(request, 20 * 1024 * 1024);
    const hasReferenceImage = Boolean(input.referenceImageDataUrl);
    const prompt = buildSlidePrompt({
      pageNumber: input.pageNumber,
      pageText: input.pageText,
      visualPrompt: input.visualPrompt,
      globalPrompt: input.globalPrompt,
      hasReferenceImage,
      referenceMode: input.referenceMode,
      referenceInstruction: input.referenceInstruction,
    });

    const imageEndpoint = input.endpoint || process.env.IMAGE_API_URL;
    const imageDataUrl =
      process.env.MOCK_IMAGE_API === "1"
        ? mockImage
        : await generateSlideImage({
            endpoint: imageEndpoint,
            editEndpoint: input.editEndpoint || process.env.IMAGE_EDIT_API_URL,
            apiKey: input.apiKey || process.env.IMAGE_API_KEY,
            model: input.model || process.env.IMAGE_MODEL || "",
            size: input.size || process.env.IMAGE_API_SIZE || "2048x1152",
            quality: input.quality || process.env.IMAGE_API_QUALITY || "",
            prompt,
            extraBody: parseObject(input.extraBody, "额外请求参数"),
            extraHeaders: parseObject(input.extraHeaders, "额外请求头"),
            proxyUrl: resolveImageProxyUrl(
              input.proxyUrl,
              imageEndpoint,
              Boolean(input.useSystemProxyForWukong),
            ),
            referenceImageDataUrl: input.referenceImageDataUrl || "",
            referenceImageName: input.referenceImageName || "",
          });

    sendJson(response, 200, { imageDataUrl, prompt });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/test-connection") {
    const input = await readJson(request, 1024 * 1024);
    const imageEndpoint = input.endpoint || process.env.IMAGE_API_URL;
    const explicitProxy = String(input.proxyUrl || "").trim();
    const useSavedSystemProxy = Boolean(input.useSystemProxyForWukong);
    const primaryProxy = resolveImageProxyUrl(
      explicitProxy,
      imageEndpoint,
      useSavedSystemProxy,
    );
    const fallbackProxy =
      isWukongStudioEndpoint(imageEndpoint) && !explicitProxy && !primaryProxy
        ? resolveProxyUrl()
        : "";
    const result = await testImageApiConnection({
      endpoint: imageEndpoint,
      testEndpoint: input.testEndpoint || "",
      apiKey: input.apiKey || process.env.IMAGE_API_KEY,
      model: input.model || process.env.IMAGE_MODEL || "",
      extraHeaders: parseObject(input.extraHeaders, "额外请求头"),
      proxyUrl: primaryProxy,
      fallbackProxyUrl: fallbackProxy,
    });
    sendJson(response, 200, {
      ...result,
      networkRoute: explicitProxy
        ? "manual-proxy"
        : result.proxyUsed
          ? "system-proxy"
          : "direct",
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/test-text-connection") {
    const input = await readJson(request, 1024 * 1024);
    const result =
      process.env.MOCK_TEXT_API === "1"
        ? {
            ok: true,
            verified: true,
            protocol: "responses",
            message: "模拟文字接口连接正常。",
          }
        : await testTextApiConnection({
            endpoint: input.endpoint || process.env.TEXT_API_URL,
            apiKey: input.apiKey || process.env.TEXT_API_KEY,
            model: input.model || process.env.TEXT_MODEL,
            protocol: input.protocol || "auto",
            extraBody: input.extraBody || "",
            extraHeaders: input.extraHeaders || "",
            proxyUrl: resolveTextProxyUrl(input.proxyUrl),
          });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/generate-note") {
    const input = await readJson(request, 2 * 1024 * 1024);
    const prompts = buildNotePrompts(input);
    const note =
      process.env.MOCK_TEXT_API === "1"
        ? mockNoteResult(prompts.request)
        : parseNoteModelOutput(
            (
              await generateText({
                endpoint: input.endpoint || process.env.TEXT_API_URL,
                apiKey: input.apiKey || process.env.TEXT_API_KEY,
                model: input.model || process.env.TEXT_MODEL,
                protocol: input.protocol || "auto",
                instructions: prompts.instructions,
                input: prompts.input,
                extraBody: input.extraBody || "",
                extraHeaders: input.extraHeaders || "",
                proxyUrl: resolveTextProxyUrl(input.proxyUrl),
              })
            ).text,
          );
    sendJson(response, 200, { note });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/suggest-note-keywords") {
    const input = await readJson(request, 2 * 1024 * 1024);
    const prompts = buildKeywordSuggestionPrompts(input);
    const keywords =
      process.env.MOCK_TEXT_API === "1"
        ? [
            `${input.coreKeyword}怎么选`,
            `${input.coreKeyword}备课思路`,
            "老师快速备课资料",
            "开学第一课课件",
            "课堂教学设计参考",
            "教师实用课件分享",
          ]
        : parseKeywordSuggestionOutput(
            (
              await generateText({
                endpoint: input.endpoint || process.env.TEXT_API_URL,
                apiKey: input.apiKey || process.env.TEXT_API_KEY,
                model: input.model || process.env.TEXT_MODEL,
                protocol: input.protocol || "auto",
                instructions: prompts.instructions,
                input: prompts.input,
                extraBody: input.extraBody || "",
                extraHeaders: input.extraHeaders || "",
                proxyUrl: resolveTextProxyUrl(input.proxyUrl),
              })
            ).text,
            input.coreKeyword,
          );
    sendJson(response, 200, { keywords });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/export-pptx") {
    const input = await readJson(request, 120 * 1024 * 1024);
    const slides = Array.isArray(input.slides)
      ? input.slides.filter((slide) => slide?.imageDataUrl)
      : [];
    const buffer = await buildImageOnlyPptx({ slides });
    const filename = `${safeFilename(input.title)}.pptx`;
    response.writeHead(200, {
      "content-type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "content-length": buffer.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(buffer);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/extract-ppt-images") {
    const encodedFilename = String(request.headers["x-file-name"] || "");
    let filename = encodedFilename;
    try {
      filename = decodeURIComponent(encodedFilename);
    } catch {
      // Keep the safe raw header for the validation message below.
    }
    if (!/\.pptx$/i.test(filename)) {
      const error = new Error("请选择 .pptx 文件；旧版 .ppt 请先另存为 .pptx。 ");
      error.statusCode = 415;
      throw error;
    }
    const buffer = await readBuffer(request, 180 * 1024 * 1024);
    const result = await extractPptxPageImages(buffer, {
      pageRange: String(request.headers["x-page-range"] || ""),
      renderPages: renderPptxPageImages,
    });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "GET") {
    await serveStatic(response, url.pathname);
    return;
  }
  sendJson(response, 404, { error: "接口不存在。" });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(`[${new Date().toISOString()}] ${error.message}`);
    if (!response.headersSent) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "服务器处理失败。",
      });
    } else {
      response.destroy();
    }
  });
});

server.listen(port, host, () => {
  console.log(`Shengcai Mini PPT: http://${host}:${port}`);
  if (process.env.MOCK_IMAGE_API === "1") {
    console.log("MOCK_IMAGE_API mode is active.");
  }
});
