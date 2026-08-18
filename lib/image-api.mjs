import { ProxyAgent } from "undici";

const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const WUKONG_STUDIO_PATH = "/api/v1/studio";
const WUKONG_DEFAULT_PRODUCT = "image_nanoBanana2";
const WUKONG_GPT_PRODUCT = "image_gptImage2";
const WUKONG_POLL_INTERVAL_MS = 4_000;
const READ_ONLY_RETRY_DELAYS_MS = [800, 1_600, 3_200, 5_000];
const WUKONG_UPLOAD_CACHE_TTL_MS = 60 * 60 * 1000;
const VOLCENGINE_ARK_HOST = "ark.cn-beijing.volces.com";
const VOLCENGINE_ARK_IMAGE_PATH = "/api/v3/images/generations";
const wukongUploadCache = new Map();

export function normalizeProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new Error("网络代理地址不是有效的 URL。");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("网络代理仅支持 HTTP 或 HTTPS 地址。");
  }
  if (!url.hostname || !url.port) {
    throw new Error("网络代理地址需要包含主机和端口，例如 http://127.0.0.1:7897。");
  }
  return url.toString();
}

function describeProxy(value) {
  try {
    const url = new URL(normalizeProxyUrl(value));
    return `${url.protocol}//${url.hostname}:${url.port}`;
  } catch {
    return "已配置的代理";
  }
}

function createFetchContext(fetchImpl, proxyUrl) {
  const normalizedProxy = normalizeProxyUrl(proxyUrl);
  if (!normalizedProxy) {
    return {
      fetch: fetchImpl,
      proxyUsed: false,
      close: async () => {},
    };
  }

  const dispatcher = new ProxyAgent(normalizedProxy);
  return {
    fetch: (url, options = {}) =>
      fetchImpl(url, {
        ...options,
        dispatcher,
      }),
    proxyUsed: true,
    close: async () => {
      await dispatcher.destroy();
    },
  };
}

export function isNetworkError(error) {
  const code = String(error?.cause?.code || error?.code || "");
  const message = String(error?.message || "");
  return (
    /fetch failed|network|socket|connect/i.test(message) ||
    /ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|ETIMEDOUT|UND_ERR_/i.test(code)
  );
}

async function fetchReadOnlyWithRetry(fetchImpl, url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= READ_ONLY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetchImpl(url, options);
      if (
        attempt < READ_ONLY_RETRY_DELAYS_MS.length &&
        [408, 429, 502, 503, 504].includes(response.status)
      ) {
        await abortableDelay(READ_ONLY_RETRY_DELAYS_MS[attempt], options.signal);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error) || attempt >= READ_ONLY_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await abortableDelay(READ_ONLY_RETRY_DELAYS_MS[attempt], options.signal);
    }
  }
  throw lastError;
}

function networkErrorCode(error) {
  return String(error?.cause?.code || error?.code || "").trim().toUpperCase();
}

function friendlyNetworkError(error, proxyUrl, action) {
  if (!isNetworkError(error)) return null;
  if (proxyUrl) {
    const code = networkErrorCode(error);
    if (code && !/ECONNREFUSED|ENETUNREACH|ENOTFOUND|ETIMEDOUT/.test(code)) {
      return `${action}失败：代理 ${describeProxy(proxyUrl)} 正常参与了请求，但上游图片服务中途断开连接（${code}）。这通常是模型与图片接口不匹配，或服务商图片通道暂时不可用；请重新“检测连接”并按提示调整模型。`;
    }
    return `${action}失败：无法通过代理 ${describeProxy(proxyUrl)} 访问图片 API。请确认代理软件正在运行，或在“高级设置”中修改代理地址。`;
  }
  return `${action}失败：当前网络无法直连图片 API。请开启系统代理，或在“高级设置”中填写 HTTP 代理地址。`;
}

function parseHttpUrl(value, errorMessage) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error(errorMessage);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(errorMessage);
  }
  return url;
}

export function isWukongStudioEndpoint(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return (
      ["wkapi.work", "wkapi.pro"].includes(url.hostname.toLowerCase()) ||
      /\/api\/v1\/studio(?:\/|$)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function isVolcengineSeedreamEndpoint(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    return new URL(raw).hostname.toLowerCase() === VOLCENGINE_ARK_HOST;
  } catch {
    return false;
  }
}

export function normalizeVolcengineSeedreamEndpoint(value) {
  const url = parseHttpUrl(value, "火山方舟豆包生图 API 地址不是有效的 URL。");
  if (url.hostname.toLowerCase() !== VOLCENGINE_ARK_HOST) {
    throw new Error("火山方舟豆包生图请使用 ark.cn-beijing.volces.com 官方地址。");
  }
  url.pathname = VOLCENGINE_ARK_IMAGE_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function assertVolcengineImageModel(model) {
  const requested = String(model || "").trim();
  if (/seedance/i.test(requested)) {
    throw new Error("Seedance 是视频模型，当前工具只支持豆包 Seedream 图片模型。");
  }
  if (!requested) {
    throw new Error("请选择豆包 Seedream 图片模型，或填写火山方舟 Endpoint ID。");
  }
  return requested;
}

export function normalizeWukongApiKey(value) {
  const raw = String(value || "").trim();
  return raw.replace(/^(?:sk-){2,}/i, "sk-");
}

export function normalizeWukongStudioBase(value) {
  const url = parseHttpUrl(value, "悟空创作台 API 地址不是有效的 URL。");
  const studioMatch = url.pathname.match(/^(.*?\/api\/v1\/studio)(?:\/.*)?$/i);
  url.pathname = studioMatch?.[1] || WUKONG_STUDIO_PATH;
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function wukongStudioEndpoint(endpoint, action) {
  return `${normalizeWukongStudioBase(endpoint)}/${String(action || "").replace(/^\/+/, "")}`;
}

function wukongUploadEndpoint(endpoint) {
  const url = new URL(normalizeWukongStudioBase(endpoint));
  url.pathname = "/api/v1/ai/test-page/upload-image";
  return url.toString();
}

function resolveWukongProductId(model) {
  const requested = String(model || "").trim();
  return /^image_[a-z0-9_-]+$/i.test(requested) ? requested : WUKONG_DEFAULT_PRODUCT;
}

function resolveWukongAspectRatio(size) {
  const requested = String(size || "").trim();
  return /^(?:1:1|3:2|2:3|16:9|9:16|4:3|3:4|21:9|9:21|1:3|3:1|2:1|1:2)$/.test(
    requested,
  )
    ? requested
    : "16:9";
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
      payload?.detail ||
      payload?.error?.message ||
      payload?.message ||
      raw.slice(0, 500) ||
      "接口没有返回错误详情。";
    throw new Error(`${action}失败（HTTP ${response.status}）：${detail}`);
  }
  return payload;
}

function abortableDelay(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error("请求已取消。");
      error.name = "AbortError";
      reject(error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function catalogImageProducts(payload) {
  if (Array.isArray(payload?.main?.image)) return payload.main.image;
  if (Array.isArray(payload?.data?.main?.image)) return payload.data.main.image;
  if (Array.isArray(payload?.products)) {
    return payload.products.filter((item) => item?.category === "image");
  }
  return [];
}

function providerPricingEndpoint(endpoint) {
  const url = new URL(normalizeImageEndpoint(endpoint));
  url.pathname = "/api/pricing";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function imageEndpointTypes(item) {
  return Array.isArray(item?.supported_endpoint_types)
    ? item.supported_endpoint_types.map((value) => String(value).toLowerCase())
    : [];
}

async function inspectProviderImageCompatibility({
  endpoint,
  model,
  routedFetch,
  signal,
}) {
  const requestedModel = String(model || "").trim();
  if (!requestedModel) return null;

  try {
    const response = await routedFetch(providerPricingEndpoint(endpoint), {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "follow",
      signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) return null;

    const current = payload.data.find(
      (item) => String(item?.model_name || "").trim() === requestedModel,
    );
    if (!current || imageEndpointTypes(current).includes("image-generation")) {
      return null;
    }

    const replacement = payload.data.find((item) =>
      imageEndpointTypes(item).includes("image-generation"),
    );
    return {
      requestedModel,
      recommendedModel: String(replacement?.model_name || "").trim(),
    };
  } catch {
    // Many OpenAI-compatible providers do not expose public capability metadata.
    return null;
  }
}

export function normalizeImageEndpoint(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("请填写图片生成 API 地址。");
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("图片生成 API 地址不是有效的 URL。");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("图片生成 API 仅支持 http 或 https。");
  }

  if (url.hostname.toLowerCase() === VOLCENGINE_ARK_HOST) {
    return normalizeVolcengineSeedreamEndpoint(url.toString());
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (!/\/images\/generations$/i.test(pathname)) {
    url.pathname = `${pathname}/images/generations`.replace(/\/{2,}/g, "/");
  } else {
    url.pathname = pathname;
  }
  return url.toString();
}

export function deriveImageEditEndpoint(endpoint, explicitEditEndpoint = "") {
  const explicit = String(explicitEditEndpoint || "").trim();
  if (explicit) {
    let url;
    try {
      url = new URL(explicit);
    } catch {
      throw new Error("参考图编辑 API 地址不是有效的 URL。");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("参考图编辑 API 仅支持 http 或 https。");
    }
    return url.toString();
  }

  const url = new URL(normalizeImageEndpoint(endpoint));
  url.pathname = url.pathname.replace(/\/images\/generations$/i, "/images/edits");
  url.search = "";
  return url.toString();
}

export function deriveTestEndpoint(endpoint, explicitTestEndpoint = "") {
  const explicit = String(explicitTestEndpoint || "").trim();
  if (explicit) {
    const url = new URL(explicit);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("检测地址仅支持 http 或 https。");
    }
    return url.toString();
  }

  const url = new URL(normalizeImageEndpoint(endpoint));
  url.pathname = url.pathname.replace(/\/images\/generations$/i, "/models");
  url.search = "";
  return url.toString();
}

export function buildSlidePrompt({
  pageNumber,
  pageText,
  visualPrompt,
  globalPrompt = "",
  hasReferenceImage = false,
  referenceMode = "composition",
  referenceInstruction = "",
}) {
  const copy = String(pageText || "").trim();
  const visual = String(visualPrompt || "").trim();
  const global = String(globalPrompt || "").trim();
  const reference = String(referenceInstruction || "").trim();
  const referenceModeText = {
    elements: "提取参考图中与本页要求有关的主体、物件、纹理或品牌特征，重新组织成新的页面画面。",
    style: "参考其配色、材质、光影与设计语言，但不要照搬原图版式。",
    composition:
      "把参考图作为视觉灵感而不是待粘贴素材：先理解其构图节奏、配色、主体元素、材质和光影，再根据本页内容重新设计主体、信息层级与文字位置，创作一张新的 16:9 页面。保持视觉语言相近，但不要简单拉伸、拼贴、描摹或原样复制。",
  };

  if (!copy && !visual) {
    throw new Error(`第 ${pageNumber} 页缺少文字或画面提示词。`);
  }

  return [
    `请生成一张完整的 PPT 第 ${pageNumber} 页画面。`,
    "画布必须为 16:9 横版、全出血构图，适合作为整页幻灯片背景。",
    "画面中不要出现页码、模型水印、编辑器边框、裁切线或与要求无关的文字。",
    global ? `整套 PPT 的统一视觉规范：\n${global}` : "",
    visual ? `本页画面、布局与设计要求：\n${visual}` : "",
    hasReferenceImage
      ? [
          "本次请求附带一张视觉参考图。请先理解参考图中的主体、元素、配色、材质和构图，再按以下规则生成新的完整页面：",
          referenceModeText[referenceMode] || referenceModeText.elements,
          reference ? `用户指定的参考要求：\n${reference}` : "",
          "参考图原有文字只用于理解画面，不要复制；不要复用参考图中的 Logo、水印、平台标识和原始排版，并以本页要求的新文字和原创构图替换。",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    copy
      ? [
          "本页需要呈现的文字如下。请逐字准确呈现，不要改写、补充或遗漏：",
          "<<<文字开始>>>",
          copy,
          "<<<文字结束>>>",
        ].join("\n")
      : "本页不需要出现任何文字。",
    "重要：所有关键内容保持在画面四周 5% 的安全区域内，确保后续居中裁切为 16:9 时不丢失。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function decodeBase64Image(base64, mimeType = "image/png") {
  const clean = String(base64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!clean) return null;
  return `data:${mimeType};base64,${clean}`;
}

export function extractImageCandidate(payload) {
  const firstData = payload?.data?.[0];
  const firstImage = payload?.images?.[0];
  const firstOutput = payload?.output?.[0];
  const candidate =
    firstData?.b64_json ||
    firstData?.base64 ||
    firstData?.url ||
    firstImage?.b64_json ||
    firstImage?.base64 ||
    firstImage?.url ||
    firstOutput?.image_base64 ||
    firstOutput?.b64_json ||
    payload?.result?.url ||
    payload?.result?.image ||
    payload?.data?.url ||
    payload?.data?.image ||
    payload?.image_base64 ||
    payload?.b64_json ||
    payload?.image ||
    payload?.url;

  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate) || /^data:image\//i.test(candidate)) {
    return candidate;
  }
  return decodeBase64Image(candidate, payload?.mime_type || "image/png");
}

function assertImageSize(buffer) {
  if (!buffer.length) throw new Error("图片接口返回了空文件。");
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("图片文件超过 30 MB，已停止处理。");
  }
}

async function remoteImageToDataUrl(url, fetchImpl, signal) {
  const response = await fetchReadOnlyWithRetry(fetchImpl, url, {
    method: "GET",
    redirect: "follow",
    signal,
  });
  if (!response.ok) {
    throw new Error(`读取生成图片失败（HTTP ${response.status}）。`);
  }
  const contentType = (response.headers.get("content-type") || "image/png").split(";")[0];
  if (!contentType.startsWith("image/")) {
    throw new Error("图片接口返回的 URL 不是图片内容。");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  assertImageSize(buffer);
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function dataUrlToImageFile(dataUrl, originalName = "reference-image") {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
  if (!match) {
    throw new Error("参考图格式无效，仅支持 PNG、JPG 或 WebP。");
  }

  const buffer = Buffer.from(match[2], "base64");
  assertImageSize(buffer);
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1];
  const safeStem = String(originalName || "reference-image")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return {
    blob: new Blob([buffer], { type: match[1] }),
    filename: `${safeStem || "reference-image"}.${extension}`,
  };
}

function referenceImageCacheKey(endpoint, dataUrl) {
  const base64 = String(dataUrl || "").split(",", 2)[1] || "";
  let hash = 2166136261;
  for (let index = 0; index < base64.length; index += 1) {
    hash ^= base64.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${new URL(normalizeWukongStudioBase(endpoint)).origin}|${base64.length}|${hash >>> 0}`;
}

function pruneWukongUploadCache(now = Date.now()) {
  for (const [key, entry] of wukongUploadCache) {
    if (now - entry.createdAt > WUKONG_UPLOAD_CACHE_TTL_MS) {
      wukongUploadCache.delete(key);
    }
  }
}

async function uploadWukongReferenceImage({
  endpoint,
  dataUrl,
  originalName,
  headers,
  routedFetch,
  signal,
}) {
  pruneWukongUploadCache();
  const cacheKey = referenceImageCacheKey(endpoint, dataUrl);
  const cached = wukongUploadCache.get(cacheKey);
  if (cached) return cached.promise;

  const promise = (async () => {
    const form = new FormData();
    const { blob, filename } = dataUrlToImageFile(dataUrl, originalName);
    form.append("file", blob, filename);
    const response = await fetchReadOnlyWithRetry(routedFetch, wukongUploadEndpoint(endpoint), {
      method: "POST",
      headers,
      body: form,
      signal,
    });
    const uploaded = await responseToJson(response, "参考图上传");
    const uploadedUrl = uploaded?.url || uploaded?.data?.url;
    if (!/^https?:\/\//i.test(String(uploadedUrl || ""))) {
      throw new Error("参考图上传成功，但悟空接口没有返回可访问的图片 URL。");
    }
    return uploadedUrl;
  })();

  wukongUploadCache.set(cacheKey, { createdAt: Date.now(), promise });
  try {
    return await promise;
  } catch (error) {
    if (wukongUploadCache.get(cacheKey)?.promise === promise) {
      wukongUploadCache.delete(cacheKey);
    }
    throw error;
  }
}

function appendFormValue(form, key, value) {
  if (value == null || value === "") return;
  if (Array.isArray(value)) {
    value.forEach((item) => appendFormValue(form, key, item));
    return;
  }
  form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
}

async function generateWukongStudioImage(
  {
    endpoint,
    apiKey,
    model,
    size,
    quality,
    prompt,
    extraBody = {},
    extraHeaders = {},
    referenceImageDataUrl = "",
    referenceImageName = "",
  },
  {
    routedFetch,
    signal,
    pollIntervalMs,
    existingTask = null,
    onTaskSubmitted = null,
  },
) {
  const configuredProduct = String(
    existingTask?.productId || extraBody.product_id || model || "",
  ).trim();
  const productId = resolveWukongProductId(configuredProduct);
  const nestedPayload =
    extraBody.payload && typeof extraBody.payload === "object" && !Array.isArray(extraBody.payload)
      ? extraBody.payload
      : {};
  const {
    product_id: _ignoredProductId,
    payload: _ignoredPayload,
    wait: _ignoredWait,
    ...directPayload
  } = extraBody;
  const payload = {
    ...directPayload,
    ...nestedPayload,
    prompt,
  };

  if (productId === WUKONG_GPT_PRODUCT) {
    payload.size = resolveWukongAspectRatio(payload.size || size);
    delete payload.aspectRatio;
    delete payload.quality;
  } else if (/^image_nanoBanana/i.test(productId)) {
    payload.aspectRatio = resolveWukongAspectRatio(payload.aspectRatio || size);
    payload.size = /^(?:1K|2K|4K)$/i.test(String(payload.size || ""))
      ? String(payload.size).toUpperCase()
      : quality === "high"
        ? "2K"
        : "1K";
  }

  const normalizedApiKey = normalizeWukongApiKey(apiKey);
  const authorization = normalizedApiKey
    ? { authorization: `Bearer ${normalizedApiKey}` }
    : {};
  const jsonHeaders = {
    accept: "application/json",
    ...extraHeaders,
    "content-type": "application/json",
    ...authorization,
  };

  let taskId = String(existingTask?.taskId || "").trim();
  if (!taskId) {
    if (referenceImageDataUrl) {
      const uploadHeaders = {
        accept: "application/json",
        ...extraHeaders,
        ...authorization,
      };
      for (const key of Object.keys(uploadHeaders)) {
        if (key.toLowerCase() === "content-type") delete uploadHeaders[key];
      }
      payload.urls = [await uploadWukongReferenceImage({
        endpoint,
        dataUrl: referenceImageDataUrl,
        originalName: referenceImageName,
        headers: uploadHeaders,
        routedFetch,
        signal,
      })];
    }

    const submitResponse = await routedFetch(wukongStudioEndpoint(endpoint, "submit"), {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ product_id: productId, payload, wait: false }),
      signal,
    });
    const submitted = await responseToJson(submitResponse, "悟空生图任务提交");
    const immediateCandidate = extractImageCandidate(submitted);
    if (immediateCandidate) {
      return /^https?:\/\//i.test(immediateCandidate)
        ? remoteImageToDataUrl(immediateCandidate, routedFetch, signal)
        : immediateCandidate;
    }

    taskId = String(submitted?.task_id || submitted?.data?.task_id || "").trim();
    if (!taskId) throw new Error("悟空接口已响应，但没有返回生图任务 ID。");
    if (typeof onTaskSubmitted === "function") {
      onTaskSubmitted({ taskId, productId });
    }
  }

  const markTaskError = (error, { final = false } = {}) => {
    error.wukongTaskPending = !final;
    error.wukongTaskFinal = final;
    error.wukongTaskId = taskId;
    error.wukongProductId = productId;
    return error;
  };

  while (!signal.aborted) {
    try {
      await abortableDelay(pollIntervalMs, signal);
      const pollUrl = new URL(wukongStudioEndpoint(endpoint, "poll"));
      pollUrl.searchParams.set("task_id", taskId);
      pollUrl.searchParams.set("product_id", productId);
      const pollResponse = await fetchReadOnlyWithRetry(routedFetch, pollUrl, {
        method: "GET",
        headers: jsonHeaders,
        signal,
      });
      const polled = await responseToJson(pollResponse, "悟空生图任务查询");
      const status = String(polled?.status || polled?.data?.status || "").toLowerCase();
      const candidate = extractImageCandidate(polled);
      if (candidate) {
        return /^https?:\/\//i.test(candidate)
          ? remoteImageToDataUrl(candidate, routedFetch, signal)
          : candidate;
      }
      if (["processing", "pending", "queued", "submitted", "running"].includes(status)) {
        continue;
      }
      const detail = polled?.detail || polled?.message || polled?.error?.message;
      if (["failed", "error", "cancelled", "canceled"].includes(status)) {
        throw markTaskError(
          new Error(`悟空生图任务失败：${detail || "上游没有返回失败详情。"}`),
          { final: true },
        );
      }
      throw markTaskError(
        new Error(
          `悟空生图任务返回了无法识别的状态${status ? `（${status}）` : ""}：${detail || "没有图片 URL。"}`,
        ),
      );
    } catch (error) {
      if (error?.wukongTaskId) throw error;
      throw markTaskError(error);
    }
  }

  const abortError = new Error("悟空生图任务已取消。");
  abortError.name = "AbortError";
  throw markTaskError(abortError);
}

async function responseToImageDataUrl(response, fetchImpl, signal) {
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      payload?.message ||
      raw.slice(0, 500) ||
      "接口没有返回错误详情。";
    throw new Error(`图片生成失败（HTTP ${response.status}）：${detail}`);
  }

  const candidate = extractImageCandidate(payload);
  if (!candidate) {
    throw new Error("图片接口响应中没有找到 URL 或 Base64 图片。");
  }
  if (/^https?:\/\//i.test(candidate)) {
    return remoteImageToDataUrl(candidate, fetchImpl, signal);
  }

  const match = candidate.match(/^data:(image\/[^;]+);base64,(.+)$/s);
  if (!match) throw new Error("图片接口返回的 Base64 格式无效。");
  const buffer = Buffer.from(match[2], "base64");
  assertImageSize(buffer);
  return candidate;
}

export async function generateSlideImage(
  {
    endpoint,
    editEndpoint,
    apiKey,
    model,
    size,
    quality,
    prompt,
    extraBody = {},
    extraHeaders = {},
    proxyUrl = "",
    referenceImageDataUrl = "",
    referenceImageName = "",
  },
  {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = WUKONG_POLL_INTERVAL_MS,
    existingWukongTask = null,
    onWukongTaskSubmitted = null,
  } = {},
) {
  const hasReferenceImage = Boolean(referenceImageDataUrl);
  const url = hasReferenceImage
    ? deriveImageEditEndpoint(endpoint, editEndpoint)
    : normalizeImageEndpoint(endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchContext = createFetchContext(fetchImpl, proxyUrl);
  const routedFetch = fetchContext.fetch;

  try {
    if (isWukongStudioEndpoint(endpoint)) {
      return await generateWukongStudioImage(
        {
          endpoint,
          apiKey,
          model,
          size,
          quality,
          prompt,
          extraBody,
          extraHeaders,
          referenceImageDataUrl,
          referenceImageName,
        },
        {
          routedFetch,
          signal: controller.signal,
          pollIntervalMs,
          existingTask: existingWukongTask,
          onTaskSubmitted: onWukongTaskSubmitted,
        },
      );
    }

    if (isVolcengineSeedreamEndpoint(endpoint)) {
      const requestedModel = assertVolcengineImageModel(model);
      const body = {
        ...extraBody,
        model: requestedModel,
        prompt,
        size: String(size || "2560x1440").trim(),
        sequential_image_generation: "disabled",
        stream: false,
        response_format: extraBody.response_format || "b64_json",
      };
      delete body.n;
      delete body.quality;
      delete body.product_id;
      if (referenceImageDataUrl) body.image = [referenceImageDataUrl];

      const headers = {
        "content-type": "application/json",
        accept: "application/json",
        ...extraHeaders,
      };
      if (apiKey) headers.authorization = `Bearer ${String(apiKey).trim()}`;

      const response = await routedFetch(normalizeVolcengineSeedreamEndpoint(endpoint), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return await responseToImageDataUrl(response, routedFetch, controller.signal);
    }

    if (hasReferenceImage) {
      const form = new FormData();
      const { blob, filename } = dataUrlToImageFile(
        referenceImageDataUrl,
        referenceImageName,
      );
      const fields = {
        ...extraBody,
        prompt,
        n: 1,
      };
      if (model) fields.model = String(model).trim();
      if (size) fields.size = String(size).trim();
      if (quality) fields.quality = quality;
      Object.entries(fields).forEach(([key, value]) => appendFormValue(form, key, value));
      form.append("image[]", blob, filename);

      const headers = {
        accept: "application/json",
        ...extraHeaders,
      };
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === "content-type") delete headers[key];
      }
      if (apiKey) headers.authorization = `Bearer ${String(apiKey).trim()}`;

      const response = await routedFetch(url, {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal,
      });
      return await responseToImageDataUrl(response, routedFetch, controller.signal);
    }

    const body = {
      ...extraBody,
      prompt,
      n: 1,
      response_format: extraBody.response_format || "b64_json",
    };
    if (model) body.model = String(model).trim();
    if (size) body.size = String(size).trim();
    if (quality) body.quality = quality;

    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      ...extraHeaders,
    };
    if (apiKey) headers.authorization = `Bearer ${String(apiKey).trim()}`;

    const response = await routedFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await responseToImageDataUrl(response, routedFetch, controller.signal);
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`图片生成超时（${Math.round(timeoutMs / 1000)} 秒）。`);
      timeoutError.code = "IMAGE_API_TIMEOUT";
      timeoutError.wukongTaskPending = Boolean(error?.wukongTaskPending);
      timeoutError.wukongTaskId = error?.wukongTaskId;
      timeoutError.wukongProductId = error?.wukongProductId;
      throw timeoutError;
    }
    const networkMessage = friendlyNetworkError(error, proxyUrl, "图片生成");
    if (networkMessage) {
      const networkError = new Error(networkMessage, { cause: error });
      networkError.code = "IMAGE_API_NETWORK";
      networkError.wukongTaskPending = Boolean(error?.wukongTaskPending);
      networkError.wukongTaskId = error?.wukongTaskId;
      networkError.wukongProductId = error?.wukongProductId;
      throw networkError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    try {
      await fetchContext.close();
    } catch {
      // The request result is more useful than a late proxy cleanup error.
    }
  }
}

async function testWukongStudioConnection(
  {
    endpoint,
    apiKey,
    model = "",
    extraHeaders = {},
    proxyUrl = "",
  },
  { fetchImpl = fetch, timeoutMs = 15_000 } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const fetchContext = createFetchContext(fetchImpl, proxyUrl);
  const routedFetch = fetchContext.fetch;
  const base = normalizeWukongStudioBase(endpoint);
  const normalizedApiKey = normalizeWukongApiKey(apiKey);

  try {
    if (!normalizedApiKey) {
      throw new Error("请填写悟空API生图组的 API Key。");
    }
    const headers = { accept: "application/json", ...extraHeaders };
    headers.authorization = `Bearer ${normalizedApiKey}`;
    const response = await routedFetch(`${base}/catalog`, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    if ([401, 403].includes(response.status)) {
      throw new Error(`悟空创作台鉴权失败（HTTP ${response.status}），请检查 API Key 是否属于生图组。`);
    }
    const catalog = await responseToJson(response, "悟空创作台目录检测");
    const products = catalogImageProducts(catalog).filter((item) => !item?.disabled);
    const requestedProduct = resolveWukongProductId(model);
    const product =
      products.find((item) => item?.id === requestedProduct) ||
      products.find((item) => item?.id === WUKONG_DEFAULT_PRODUCT) ||
      products[0];
    if (!product?.id) {
      throw new Error("悟空创作台当前没有可用的生图产品，请联系供应商检查上游通道。");
    }

    const probeUrl = new URL(`${base}/poll`);
    probeUrl.searchParams.set("task_id", "codex-connection-test");
    const probeResponse = await routedFetch(probeUrl, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    if ([401, 403].includes(probeResponse.status)) {
      throw new Error(
        `悟空创作台鉴权失败（HTTP ${probeResponse.status}），请确认 API Key 已启用且属于生图组。`,
      );
    }
    const latencyMs = Date.now() - startedAt;
    const authVerified = probeResponse.status < 500;
    return {
      ok: true,
      verified: authVerified,
      status: response.status,
      latencyMs,
      endpoint: `${base}/catalog`,
      proxyUsed: fetchContext.proxyUsed,
      providerMode: "wukong-studio",
      adjustedEndpoint: base,
      adjustedModel: product.id,
      adjustedSize: "16:9",
      productName: String(product.name || product.id),
      unitPrice: String(product.price || ""),
      products: products.map((item) => ({
        id: String(item?.id || ""),
        name: String(item?.name || item?.id || ""),
        price: String(item?.price || ""),
        desc: String(item?.desc || item?.description || ""),
      })),
      studioLimits: catalog?.studio_limits || catalog?.data?.studio_limits || {},
      message: authVerified
        ? `悟空生图组 Key 鉴权通过，识别到 ${product.name || product.id}${product.price ? `（${product.price}）` : ""}。系统将使用异步提交与轮询流程，输出 16:9 画面。`
        : `悟空创作台可访问，已识别到 ${product.name || product.id}${product.price ? `（${product.price}）` : ""}；但供应商对不存在的检测任务返回 HTTP ${probeResponse.status}，无法在不提交付费任务的情况下进一步验证 Key 分组。请确认 Key 分组是“生图组”后保存。`,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `悟空创作台连接检测超时（${Math.round(timeoutMs / 1000)} 秒）。`,
        { cause: error },
      );
      timeoutError.code = "IMAGE_API_TIMEOUT";
      throw timeoutError;
    }
    const networkMessage = friendlyNetworkError(error, proxyUrl, "悟空创作台连接检测");
    if (networkMessage) {
      const networkError = new Error(networkMessage, { cause: error });
      networkError.code = "IMAGE_API_NETWORK";
      throw networkError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    try {
      await fetchContext.close();
    } catch {
      // The request result is more useful than a late proxy cleanup error.
    }
  }
}

export async function testImageApiConnection(
  {
    endpoint,
    testEndpoint,
    apiKey,
    model = "",
    extraHeaders = {},
    proxyUrl = "",
    fallbackProxyUrl = "",
  },
  { fetchImpl = fetch, timeoutMs = 15_000 } = {},
) {
  if (isWukongStudioEndpoint(endpoint)) {
    try {
      return await testWukongStudioConnection(
        { endpoint, apiKey, model, extraHeaders, proxyUrl },
        {
          fetchImpl,
          timeoutMs: fallbackProxyUrl && !proxyUrl ? Math.min(timeoutMs, 6_000) : timeoutMs,
        },
      );
    } catch (error) {
      const canUseFallback = Boolean(
        fallbackProxyUrl &&
          !proxyUrl &&
          (error?.code === "IMAGE_API_TIMEOUT" ||
            error?.code === "IMAGE_API_NETWORK" ||
            isNetworkError(error) ||
            isNetworkError(error?.cause)),
      );
      if (!canUseFallback) throw error;
      const result = await testWukongStudioConnection(
        { endpoint, apiKey, model, extraHeaders, proxyUrl: fallbackProxyUrl },
        { fetchImpl, timeoutMs },
      );
      return {
        ...result,
        proxyFallbackUsed: true,
        message: `${result.message} 直连不可用，已自动切换到系统代理。`,
      };
    }
  }
  const volcengineSeedream = isVolcengineSeedreamEndpoint(endpoint);
  if (volcengineSeedream) {
    if (!String(apiKey || "").trim()) {
      throw new Error("请填写火山方舟 API Key。");
    }
    assertVolcengineImageModel(model);
  }
  const url = deriveTestEndpoint(endpoint, testEndpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const fetchContext = createFetchContext(fetchImpl, proxyUrl);
  const routedFetch = fetchContext.fetch;

  try {
    const headers = {
      accept: "application/json",
      ...extraHeaders,
    };
    if (apiKey) headers.authorization = `Bearer ${String(apiKey).trim()}`;

    const requestOptions = {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    };
    let response;
    try {
      response = await routedFetch(url, requestOptions);
    } catch (error) {
      if (error?.name === "AbortError" || !isNetworkError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400));
      response = await routedFetch(url, requestOptions);
    }
    const latencyMs = Date.now() - startedAt;

    if ([401, 403].includes(response.status)) {
      throw new Error(`鉴权失败（HTTP ${response.status}），请检查 API Key 或请求头。`);
    }
    if (response.status >= 500) {
      throw new Error(`API 服务异常（HTTP ${response.status}）。`);
    }
    if (response.ok) {
      if (volcengineSeedream) {
        return {
          ok: true,
          verified: true,
          status: response.status,
          latencyMs,
          endpoint: url,
          proxyUsed: fetchContext.proxyUsed,
          providerMode: "volcengine-seedream",
          adjustedEndpoint: normalizeVolcengineSeedreamEndpoint(endpoint),
          adjustedSize: "2560x1440",
          message: `火山方舟 API Key 检测通过，已启用豆包 Seedream 图片生成与参考图生图；不会调用 Seedance 视频模型。`,
        };
      }
      const compatibility = await inspectProviderImageCompatibility({
        endpoint,
        model,
        routedFetch,
        signal: controller.signal,
      });
      if (compatibility?.recommendedModel) {
        const recommendedSize = /^gpt-image-/i.test(compatibility.recommendedModel)
          ? "1536x1024"
          : "";
        return {
          ok: true,
          verified: true,
          status: response.status,
          latencyMs,
          endpoint: url,
          proxyUsed: fetchContext.proxyUsed,
          adjustedModel: compatibility.recommendedModel,
          adjustedSize: recommendedSize,
          message: `API 地址和 Key 正常。该平台的 ${compatibility.requestedModel} 未开放图片生成端点，已识别到可用生图模型 ${compatibility.recommendedModel}。`,
        };
      }
      return {
        ok: true,
        verified: true,
        status: response.status,
        latencyMs,
        endpoint: url,
        proxyUsed: fetchContext.proxyUsed,
        message: `连接成功，鉴权与模型接口均已响应（${latencyMs} ms）${fetchContext.proxyUsed ? "，已使用网络代理" : "，当前为直连"}。`,
      };
    }

    return {
      ok: true,
      verified: false,
      status: response.status,
      latencyMs,
      endpoint: url,
      proxyUsed: fetchContext.proxyUsed,
      providerMode: volcengineSeedream ? "volcengine-seedream" : "openai-compatible",
      adjustedEndpoint: volcengineSeedream
        ? normalizeVolcengineSeedreamEndpoint(endpoint)
        : undefined,
      adjustedSize: volcengineSeedream ? "2560x1440" : undefined,
      message: volcengineSeedream
        ? `已识别火山方舟豆包生图地址（HTTP ${response.status}），但该地址未提供无费用的标准模型检测结果。配置可以保存，请由学员使用自己的 Key 实际生成一页验证；工具只会调用 Seedream 图片模型。`
        : `服务器可以访问（HTTP ${response.status}，${fetchContext.proxyUsed ? "已使用网络代理" : "当前为直连"}），但未提供标准模型检测接口；请用实际生成做最终验证。`,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`连接检测超时（${Math.round(timeoutMs / 1000)} 秒）。`);
    }
    const networkMessage = friendlyNetworkError(error, proxyUrl, "连接检测");
    if (networkMessage) throw new Error(networkMessage);
    throw error;
  } finally {
    clearTimeout(timer);
    try {
      await fetchContext.close();
    } catch {
      // The request result is more useful than a late proxy cleanup error.
    }
  }
}
