import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSlidePrompt,
  deriveImageEditEndpoint,
  deriveTestEndpoint,
  extractImageCandidate,
  generateSlideImage,
  isApiMartEndpoint,
  isVolcengineSeedreamEndpoint,
  isWukongStudioEndpoint,
  normalizeImageEndpoint,
  normalizeProxyUrl,
  normalizeVolcengineSeedreamEndpoint,
  normalizeWukongApiKey,
  normalizeWukongStudioBase,
  testImageApiConnection,
} from "../lib/image-api.mjs";

test("normalizes a local HTTP proxy address", () => {
  assert.equal(
    normalizeProxyUrl("127.0.0.1:7897"),
    "http://127.0.0.1:7897/",
  );
  assert.equal(
    normalizeProxyUrl("http://127.0.0.1:7897"),
    "http://127.0.0.1:7897/",
  );
  assert.throws(
    () => normalizeProxyUrl("socks5://127.0.0.1:7897"),
    /仅支持 HTTP 或 HTTPS/,
  );
});

test("normalizes an OpenAI-compatible base URL", () => {
  assert.equal(
    normalizeImageEndpoint("https://api.example.com/v1"),
    "https://api.example.com/v1/images/generations",
  );
  assert.equal(
    normalizeImageEndpoint("https://api.example.com/v1/images/generations"),
    "https://api.example.com/v1/images/generations",
  );
});

test("normalizes Volcengine Ark to the Seedream image endpoint", () => {
  assert.equal(
    isVolcengineSeedreamEndpoint("https://ark.cn-beijing.volces.com/api/v3"),
    true,
  );
  assert.equal(
    normalizeVolcengineSeedreamEndpoint(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
    ),
    "https://ark.cn-beijing.volces.com/api/v3/images/generations",
  );
  assert.equal(
    normalizeImageEndpoint("https://ark.cn-beijing.volces.com/api/v3"),
    "https://ark.cn-beijing.volces.com/api/v3/images/generations",
  );
});

test("recognizes APIMart public API hosts", () => {
  assert.equal(isApiMartEndpoint("https://api.aiuxu.com/v1"), true);
  assert.equal(isApiMartEndpoint("https://api.apib.ai/v1"), true);
  assert.equal(isApiMartEndpoint("https://api.example.com/v1"), false);
});

test("builds a page-specific prompt with exact copy and 16:9 constraints", () => {
  const prompt = buildSlidePrompt({
    pageNumber: 3,
    pageText: "年度增长 42%",
    visualPrompt: "标题左对齐，数据在右侧。",
    globalPrompt: "深色商业风格。",
  });
  assert.match(prompt, /第 3 页/);
  assert.match(prompt, /16:9/);
  assert.match(prompt, /年度增长 42%/);
  assert.match(prompt, /逐字准确呈现/);
});

test("adds reference-image guidance to a slide prompt", () => {
  const prompt = buildSlidePrompt({
    pageNumber: 2,
    pageText: "新品发布",
    hasReferenceImage: true,
    referenceMode: "elements",
    referenceInstruction: "保留参考图中的产品外形和金属质感。",
  });
  assert.match(prompt, /附带一张视觉参考图/);
  assert.match(prompt, /主体、物件、纹理或品牌特征/);
  assert.match(prompt, /保留参考图中的产品外形和金属质感/);
  assert.match(prompt, /不要复用参考图中的 Logo、水印、平台标识和原始排版/);
});

test("defaults reference images to automatic 16:9 extension", () => {
  const prompt = buildSlidePrompt({
    pageNumber: 1,
    pageText: "课程封面",
    hasReferenceImage: true,
  });
  assert.match(prompt, /视觉灵感而不是待粘贴素材/);
  assert.match(prompt, /重新设计主体、信息层级与文字位置/);
  assert.match(prompt, /不要简单拉伸、拼贴、描摹或原样复制/);
  assert.match(prompt, /参考图原有文字只用于理解画面/);
});

test("extracts common response formats", () => {
  assert.equal(
    extractImageCandidate({ data: [{ url: "https://cdn.example.com/a.png" }] }),
    "https://cdn.example.com/a.png",
  );
  assert.equal(
    extractImageCandidate({ images: [{ base64: "YWJj" }] }),
    "data:image/png;base64,YWJj",
  );
});

test("derives a standard models endpoint for connection checks", () => {
  assert.equal(
    deriveTestEndpoint("https://api.example.com/v1/images/generations"),
    "https://api.example.com/v1/models",
  );
  assert.equal(
    deriveTestEndpoint(
      "https://api.example.com/v1/images/generations",
      "https://health.example.com/ping",
    ),
    "https://health.example.com/ping",
  );
});

test("derives an image edit endpoint for reference-image requests", () => {
  assert.equal(
    deriveImageEditEndpoint("https://api.example.com/v1/images/generations"),
    "https://api.example.com/v1/images/edits",
  );
  assert.equal(
    deriveImageEditEndpoint(
      "https://api.example.com/v1/images/generations",
      "https://images.example.com/custom-edit",
    ),
    "https://images.example.com/custom-edit",
  );
});

test("sends a compatible generation request without leaking configuration", async () => {
  let captured;
  const result = await generateSlideImage(
    {
      endpoint: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "image-model",
      size: "1536x1024",
      quality: "high",
      prompt: "test prompt",
    },
    {
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return new Response(
          JSON.stringify({ data: [{ b64_json: "YWJj" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );
  assert.equal(captured.url, "https://api.example.com/v1/images/generations");
  assert.equal(captured.options.headers.authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(captured.options.body), {
    prompt: "test prompt",
    n: 1,
    response_format: "b64_json",
    model: "image-model",
    size: "1536x1024",
    quality: "high",
  });
  assert.equal(result, "data:image/png;base64,YWJj");
});

test("sends Volcengine Seedream text-to-image as a single 16:9 image", async () => {
  let captured;
  const result = await generateSlideImage(
    {
      endpoint: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "ark-test-key",
      model: "doubao-seedream-5-0-lite-260128",
      size: "2560x1440",
      quality: "high",
      prompt: "生成一张课件页",
    },
    {
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return new Response(
          JSON.stringify({ data: [{ b64_json: "YWJj" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );

  assert.equal(
    captured.url,
    "https://ark.cn-beijing.volces.com/api/v3/images/generations",
  );
  assert.equal(captured.options.headers.authorization, "Bearer ark-test-key");
  assert.deepEqual(JSON.parse(captured.options.body), {
    model: "doubao-seedream-5-0-lite-260128",
    prompt: "生成一张课件页",
    size: "2560x1440",
    sequential_image_generation: "disabled",
    stream: false,
    response_format: "b64_json",
  });
  assert.equal(result, "data:image/png;base64,YWJj");
});

test("sends a reference image to the Seedream JSON image field", async () => {
  let captured;
  const result = await generateSlideImage(
    {
      endpoint: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      apiKey: "ark-test-key",
      model: "doubao-seedream-4-5-251128",
      size: "2560x1440",
      prompt: "参考这张图重新设计课件",
      referenceImageDataUrl: "data:image/png;base64,YWJj",
      referenceImageName: "参考图.png",
    },
    {
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return new Response(
          JSON.stringify({ data: [{ b64_json: "ZGVm" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );

  const body = JSON.parse(captured.options.body);
  assert.equal(captured.options.headers["content-type"], "application/json");
  assert.deepEqual(body.image, ["data:image/png;base64,YWJj"]);
  assert.equal(body.sequential_image_generation, "disabled");
  assert.equal(result, "data:image/png;base64,ZGVm");
});

test("rejects Seedance video models in the Volcengine image provider", async () => {
  await assert.rejects(
    () => generateSlideImage({
      endpoint: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "ark-test-key",
      model: "doubao-seedance-2-5-260628",
      prompt: "生成课件页",
    }),
    /Seedance 是视频模型/,
  );
});

test("submits and polls an APIMart GPT Image 2 task", async () => {
  const calls = [];
  let pollCount = 0;
  const result = await generateSlideImage(
    {
      endpoint: "https://api.aiuxu.com/v1",
      apiKey: "fixture-token",
      model: "gpt-image-2",
      size: "16:9",
      quality: "high",
      prompt: "make a 16:9 courseware slide",
      extraBody: { resolution: "1k" },
    },
    {
      pollIntervalMs: 0,
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith("/v1/images/generations")) {
          return new Response(
            JSON.stringify({
              code: 200,
              data: [{ status: "submitted", task_id: "task_apimart_fixture" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (String(url).endsWith("/v1/tasks/task_apimart_fixture")) {
          pollCount += 1;
          return new Response(
            JSON.stringify(
              pollCount === 1
                ? { code: 200, data: { status: "processing" } }
                : {
                    code: 200,
                    data: {
                      status: "completed",
                      result: {
                        images: [{ url: ["https://cdn.example.com/apimart.png"] }],
                      },
                    },
                  },
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (String(url) === "https://cdn.example.com/apimart.png") {
          return new Response(Buffer.from("abc"), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
        throw new Error(`unexpected URL ${url}`);
      },
    },
  );

  const submitCall = calls.find((call) => call.url.endsWith("/v1/images/generations"));
  assert.equal(submitCall.options.headers.authorization, "Bearer fixture-token");
  assert.deepEqual(JSON.parse(submitCall.options.body), {
    model: "gpt-image-2",
    prompt: "make a 16:9 courseware slide",
    n: 1,
    size: "16:9",
    resolution: "1k",
  });
  assert.equal(pollCount, 2);
  assert.equal(result, "data:image/png;base64,YWJj");
});

test("uploads an APIMart reference image before submitting the task", async () => {
  const calls = [];
  const result = await generateSlideImage(
    {
      endpoint: "https://api.aiuxu.com/v1",
      apiKey: "fixture-token",
      model: "gpt-image-2",
      size: "16:9",
      prompt: "redesign this reference",
      referenceImageDataUrl: "data:image/png;base64,YWJj",
      referenceImageName: "参考图.png",
    },
    {
      pollIntervalMs: 0,
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith("/v1/uploads/images")) {
          return new Response(
            JSON.stringify({ data: { url: "https://cdn.example.com/reference.png" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (String(url).endsWith("/v1/images/generations")) {
          return new Response(
            JSON.stringify({ data: [{ b64_json: "ZGVm" }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected URL ${url}`);
      },
    },
  );

  const uploadCall = calls.find((call) => call.url.endsWith("/v1/uploads/images"));
  const submitCall = calls.find((call) => call.url.endsWith("/v1/images/generations"));
  assert.ok(uploadCall.options.body instanceof FormData);
  assert.equal(uploadCall.options.body.get("file").type, "image/png");
  assert.deepEqual(JSON.parse(submitCall.options.body).image_urls, [
    "https://cdn.example.com/reference.png",
  ]);
  assert.equal(result, "data:image/png;base64,ZGVm");
});

test("resumes an APIMart task without submitting it again", async () => {
  const calls = [];
  const result = await generateSlideImage(
    {
      endpoint: "https://api.aiuxu.com/v1",
      apiKey: "fixture-token",
      model: "gpt-image-2",
      size: "16:9",
      prompt: "resume task",
    },
    {
      pollIntervalMs: 0,
      existingWukongTask: {
        taskId: "task_resume_fixture",
        productId: "apimart:gpt-image-2",
      },
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith("/v1/tasks/task_resume_fixture")) {
          return new Response(
            JSON.stringify({
              data: {
                status: "completed",
                result: { images: [{ image: "Z2hp" }] },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected URL ${url}`);
      },
    },
  );

  assert.deepEqual(calls.map((call) => call.url), [
    "https://api.aiuxu.com/v1/tasks/task_resume_fixture",
  ]);
  assert.equal(result, "data:image/png;base64,Z2hp");
});

test("sends a multipart image edit request when a reference image is present", async () => {
  let captured;
  const result = await generateSlideImage(
    {
      endpoint: "https://api.example.com/v1/images/generations",
      apiKey: "test-key",
      model: "gpt-image-2",
      size: "1536x1024",
      quality: "high",
      prompt: "extend this reference into a slide",
      referenceImageDataUrl: "data:image/png;base64,YWJj",
      referenceImageName: "产品参考图.png",
    },
    {
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return new Response(
          JSON.stringify({ data: [{ b64_json: "ZGVm" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );

  assert.equal(captured.url, "https://api.example.com/v1/images/edits");
  assert.equal(captured.options.headers.authorization, "Bearer test-key");
  assert.equal(captured.options.headers["content-type"], undefined);
  assert.ok(captured.options.body instanceof FormData);
  assert.equal(captured.options.body.get("model"), "gpt-image-2");
  assert.equal(captured.options.body.get("prompt"), "extend this reference into a slide");
  assert.equal(captured.options.body.get("size"), "1536x1024");
  assert.equal(captured.options.body.get("quality"), "high");
  assert.equal(captured.options.body.get("n"), "1");
  assert.equal(captured.options.body.get("image[]").type, "image/png");
  assert.equal(result, "data:image/png;base64,ZGVm");
});

test("normalizes Wukong image endpoints to the studio API", () => {
  assert.equal(isWukongStudioEndpoint("https://wkapi.work/v1"), true);
  assert.equal(
    normalizeWukongStudioBase("https://wkapi.work/v1/images/generations"),
    "https://wkapi.work/api/v1/studio",
  );
  assert.equal(
    normalizeWukongStudioBase("https://proxy.example.com/api/v1/studio/submit"),
    "https://proxy.example.com/api/v1/studio",
  );
});

test("removes only duplicated Wukong API key prefixes", () => {
  assert.equal(normalizeWukongApiKey(" sk-sk-example "), "sk-example");
  assert.equal(normalizeWukongApiKey("sk-sk-sk-example"), "sk-example");
  assert.equal(normalizeWukongApiKey("sk-example"), "sk-example");
});

test("submits and polls a Wukong GPT-Image-2 task", async () => {
  const calls = [];
  let pollCount = 0;
  const result = await generateSlideImage(
    {
      endpoint: "https://wkapi.work/v1",
      apiKey: "sk-sk-test-key",
      model: "image_gptImage2",
      size: "1536x1024",
      quality: "high",
      prompt: "make a 16:9 slide",
    },
    {
      pollIntervalMs: 0,
      timeoutMs: 1_000,
      fetchImpl: async (url, options = {}) => {
        const href = String(url);
        calls.push({ href, options });
        if (href.endsWith("/submit")) {
          return new Response(JSON.stringify({ task_id: "task-1" }), { status: 200 });
        }
        if (href.includes("/poll?")) {
          pollCount += 1;
          return new Response(
            JSON.stringify(
              pollCount === 1
                ? { status: "processing" }
                : { status: "succeeded", url: "https://cdn.example.com/result.png" },
            ),
            { status: 200 },
          );
        }
        if (href === "https://cdn.example.com/result.png") {
          return new Response(Buffer.from("abc"), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
        throw new Error(`Unexpected URL: ${href}`);
      },
    },
  );

  const submit = calls.find((call) => call.href.endsWith("/submit"));
  assert.equal(submit.href, "https://wkapi.work/api/v1/studio/submit");
  assert.equal(submit.options.headers.authorization, "Bearer sk-test-key");
  assert.deepEqual(JSON.parse(submit.options.body), {
    product_id: "image_gptImage2",
    payload: { prompt: "make a 16:9 slide", size: "16:9" },
    wait: false,
  });
  assert.equal(pollCount, 2);
  assert.equal(result, "data:image/png;base64,YWJj");
});

test("submits NanoBanana 2 with its documented product_id and 16:9 ratio", async () => {
  const calls = [];
  await generateSlideImage(
    {
      endpoint: "https://wkapi.work",
      apiKey: "test-fixture-key",
      model: "image_nanoBanana2",
      size: "16:9",
      quality: "high",
      prompt: "make a 16:9 slide",
    },
    {
      pollIntervalMs: 0,
      timeoutMs: 1_000,
      fetchImpl: async (url, options = {}) => {
        const href = String(url);
        calls.push({ href, options });
        if (href.endsWith("/submit")) {
          return new Response(JSON.stringify({ task_id: "task-nano" }), { status: 200 });
        }
        if (href.includes("/poll?")) {
          return new Response(
            JSON.stringify({ status: "succeeded", url: "data:image/png;base64,YWJj" }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected URL: ${href}`);
      },
    },
  );

  const submit = calls.find((call) => call.href.endsWith("/submit"));
  assert.deepEqual(JSON.parse(submit.options.body), {
    product_id: "image_nanoBanana2",
    payload: {
      prompt: "make a 16:9 slide",
      aspectRatio: "16:9",
      size: "2K",
    },
    wait: false,
  });
});

test("resumes an existing Wukong task without submitting or charging again", async () => {
  const calls = [];
  const result = await generateSlideImage(
    {
      endpoint: "https://wkapi.work",
      apiKey: "test-fixture-key",
      model: "image_nanoBanana2",
      size: "16:9",
      prompt: "resume the paid task",
    },
    {
      existingWukongTask: {
        taskId: "already-paid-task",
        productId: "image_nanoBanana2",
      },
      pollIntervalMs: 0,
      timeoutMs: 1_000,
      fetchImpl: async (url, options = {}) => {
        const href = String(url);
        calls.push({ href, options });
        if (href.includes("/poll?")) {
          return new Response(
            JSON.stringify({ status: "succeeded", url: "data:image/png;base64,YWJj" }),
            { status: 200 },
          );
        }
        throw new Error(`A resumed task must not submit again: ${href}`);
      },
    },
  );

  assert.equal(calls.some((call) => call.href.endsWith("/submit")), false);
  assert.match(calls[0].href, /task_id=already-paid-task/);
  assert.equal(result, "data:image/png;base64,YWJj");
});

test("returns the submitted task id when polling repeatedly loses the network", async () => {
  let pollCount = 0;
  await assert.rejects(
    generateSlideImage(
      {
        endpoint: "https://wkapi.work",
        apiKey: "test-fixture-key",
        model: "image_nanoBanana2",
        size: "16:9",
        prompt: "keep the task id",
      },
      {
        pollIntervalMs: 0,
        timeoutMs: 2_000,
        fetchImpl: async (url) => {
          const href = String(url);
          if (href.endsWith("/submit")) {
            return new Response(JSON.stringify({ task_id: "recover-me" }), { status: 200 });
          }
          if (href.includes("/poll?")) {
            pollCount += 1;
            throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
          }
          throw new Error(`Unexpected URL: ${href}`);
        },
      },
    ),
    (error) => {
      assert.equal(error.wukongTaskPending, true);
      assert.equal(error.wukongTaskId, "recover-me");
      assert.equal(error.wukongProductId, "image_nanoBanana2");
      return true;
    },
  );
  assert.ok(pollCount > 1);
});

test("retries Wukong polling after a transient reset without resubmitting the paid task", async () => {
  let submitCount = 0;
  let pollCount = 0;
  const result = await generateSlideImage(
    {
      endpoint: "https://wkapi.work",
      apiKey: "sk-test-key",
      model: "image_gptImage2",
      size: "16:9",
      prompt: "make a stable slide",
    },
    {
      pollIntervalMs: 0,
      timeoutMs: 5_000,
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.endsWith("/submit")) {
          submitCount += 1;
          return new Response(JSON.stringify({ task_id: "task-stable" }), { status: 200 });
        }
        if (href.includes("/poll?")) {
          pollCount += 1;
          if (pollCount === 1) {
            const error = new Error("fetch failed");
            error.cause = { code: "ECONNRESET" };
            throw error;
          }
          return new Response(
            JSON.stringify({ status: "succeeded", url: "data:image/png;base64,YWJj" }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected URL: ${href}`);
      },
    },
  );

  assert.equal(submitCount, 1);
  assert.equal(pollCount, 2);
  assert.equal(result, "data:image/png;base64,YWJj");
});

test("uploads a reference image before submitting a Wukong task", async () => {
  const calls = [];
  const result = await generateSlideImage(
    {
      endpoint: "https://wkapi.work/api/v1/studio",
      apiKey: "sk-sk-test-key",
      model: "image_gptImage2",
      size: "16:9",
      prompt: "redesign the reference",
      referenceImageDataUrl: "data:image/png;base64,YWJj",
      referenceImageName: "参考图.png",
    },
    {
      pollIntervalMs: 0,
      timeoutMs: 1_000,
      fetchImpl: async (url, options = {}) => {
        const href = String(url);
        calls.push({ href, options });
        if (href.endsWith("/upload-image")) {
          return new Response(JSON.stringify({ url: "https://cdn.example.com/reference.png" }), {
            status: 200,
          });
        }
        if (href.endsWith("/submit")) {
          return new Response(JSON.stringify({ task_id: "task-ref" }), { status: 200 });
        }
        if (href.includes("/poll?")) {
          return new Response(
            JSON.stringify({ status: "succeeded", url: "data:image/png;base64,ZGVm" }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected URL: ${href}`);
      },
    },
  );

  const upload = calls.find((call) => call.href.endsWith("/upload-image"));
  assert.ok(upload.options.body instanceof FormData);
  assert.equal(upload.options.body.get("file").type, "image/png");
  const submit = calls.find((call) => call.href.endsWith("/submit"));
  assert.deepEqual(JSON.parse(submit.options.body).payload.urls, [
    "https://cdn.example.com/reference.png",
  ]);
  assert.equal(result, "data:image/png;base64,ZGVm");
});

test("retries and reuses the same Wukong reference upload without repeating paid submits", async () => {
  let uploadCount = 0;
  let submitCount = 0;
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith("/upload-image")) {
      uploadCount += 1;
      if (uploadCount === 1) throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
      return new Response(JSON.stringify({ url: "https://cdn.example.com/cached-reference.png" }), {
        status: 200,
      });
    }
    if (href.endsWith("/submit")) {
      submitCount += 1;
      return new Response(JSON.stringify({ task_id: `task-cache-${submitCount}` }), { status: 200 });
    }
    if (href.includes("/poll?")) {
      return new Response(
        JSON.stringify({ status: "succeeded", url: "data:image/png;base64,Z2hp" }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected URL: ${href}`);
  };
  const config = {
    endpoint: "https://wkapi.work/api/v1/studio",
    apiKey: "sk-test-cache-key",
    model: "image_gptImage2",
    size: "16:9",
    prompt: "reuse the reference",
    referenceImageDataUrl: "data:image/png;base64,YWJjZA==",
    referenceImageName: "缓存参考图.png",
  };

  const first = await generateSlideImage(config, {
    pollIntervalMs: 0,
    timeoutMs: 5_000,
    fetchImpl,
  });
  const second = await generateSlideImage(
    { ...config, prompt: "reuse the reference on another slide" },
    { pollIntervalMs: 0, timeoutMs: 5_000, fetchImpl },
  );

  assert.equal(first, "data:image/png;base64,Z2hp");
  assert.equal(second, "data:image/png;base64,Z2hp");
  assert.equal(uploadCount, 2);
  assert.equal(submitCount, 2);
});

test("detects the Wukong catalog without generating an image", async () => {
  const result = await testImageApiConnection(
    {
      endpoint: "https://wkapi.work/v1",
      apiKey: "sk-sk-test-key",
      model: "gpt-image-1.5",
    },
    {
      fetchImpl: async (url, options) => {
        const href = String(url);
        assert.equal(options.method, "GET");
        assert.equal(options.headers.authorization, "Bearer sk-test-key");
        if (href.includes("/poll?")) {
          assert.equal(
            href,
            "https://wkapi.work/api/v1/studio/poll?task_id=codex-connection-test",
          );
          return new Response(JSON.stringify({ detail: "task not found" }), {
            status: 502,
          });
        }
        assert.equal(href, "https://wkapi.work/api/v1/studio/catalog");
        return new Response(
          JSON.stringify({
            studio_limits: { max_parallel_image: 3 },
            main: {
              image: [
                {
                  id: "image_gptImage2",
                  name: "GPT-Image-2",
                  price: "0.15 元/张",
                },
              ],
            },
          }),
          { status: 200 },
        );
      },
    },
  );

  assert.equal(result.verified, false);
  assert.equal(result.providerMode, "wukong-studio");
  assert.equal(result.adjustedEndpoint, "https://wkapi.work/api/v1/studio");
  assert.equal(result.adjustedModel, "image_gptImage2");
  assert.equal(result.adjustedSize, "16:9");
  assert.equal(result.products[0].id, "image_gptImage2");
  assert.equal(result.studioLimits.max_parallel_image, 3);
  assert.match(result.message, /0\.15 元\/张/);
  assert.match(result.message, /无法在不提交付费任务/);
});

test("rejects a Wukong key when the protected poll endpoint returns 401", async () => {
  await assert.rejects(
    testImageApiConnection(
      {
        endpoint: "https://wkapi.work/api/v1/studio",
        apiKey: "invalid-test-token",
      },
      {
        fetchImpl: async (url) => {
          const href = String(url);
          if (href.endsWith("/catalog")) {
            return new Response(
              JSON.stringify({
                main: {
                  image: [{ id: "image_gptImage2", name: "GPT-Image-2" }],
                },
              }),
              { status: 200 },
            );
          }
          return new Response(JSON.stringify({ detail: "unauthorized" }), {
            status: 401,
          });
        },
      },
    ),
    /鉴权失败（HTTP 401）/,
  );
});

test("falls back to the system proxy for a safe Wukong connection check", async () => {
  let attempts = 0;
  const result = await testImageApiConnection(
    {
      endpoint: "https://wkapi.work",
      apiKey: "sk-test-key",
      fallbackProxyUrl: "http://127.0.0.1:7897",
    },
    {
      fetchImpl: async (url, options) => {
        attempts += 1;
        if (!options.dispatcher) {
          throw new TypeError("fetch failed", { cause: { code: "ENETUNREACH" } });
        }
        if (String(url).endsWith("/catalog")) {
          return new Response(
            JSON.stringify({
              main: { image: [{ id: "image_gptImage2", name: "GPT-Image-2" }] },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ detail: "task not found" }), { status: 404 });
      },
    },
  );

  assert.equal(attempts, 3);
  assert.equal(result.proxyUsed, true);
  assert.equal(result.proxyFallbackUsed, true);
  assert.match(result.message, /已自动切换到系统代理/);
});

test("does not bypass an explicitly configured Wukong proxy", async () => {
  let directAttemptSeen = false;
  const result = await testImageApiConnection(
    {
      endpoint: "https://wkapi.work",
      apiKey: "sk-test-key",
      proxyUrl: "http://127.0.0.1:7897",
      fallbackProxyUrl: "http://127.0.0.1:8888",
    },
    {
      fetchImpl: async (url, options) => {
        directAttemptSeen ||= !options.dispatcher;
        if (String(url).endsWith("/catalog")) {
          return new Response(
            JSON.stringify({
              main: { image: [{ id: "image_gptImage2", name: "GPT-Image-2" }] },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ detail: "task not found" }), { status: 404 });
      },
    },
  );

  assert.equal(directAttemptSeen, false);
  assert.equal(result.proxyUsed, true);
  assert.equal(result.proxyFallbackUsed, undefined);
});

test("verifies API connectivity without generating an image", async () => {
  const result = await testImageApiConnection(
    {
      endpoint: "https://api.example.com/v1/images/generations",
      apiKey: "test-key",
    },
    {
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.example.com/v1/models");
        assert.equal(options.method, "GET");
        assert.equal(options.headers.authorization, "Bearer test-key");
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
});

test("routes connection checks through a configured proxy", async () => {
  let dispatcherSeen = false;
  const result = await testImageApiConnection(
    {
      endpoint: "https://api.example.com/v1",
      apiKey: "test-key",
      proxyUrl: "http://127.0.0.1:7897",
    },
    {
      fetchImpl: async (_url, options) => {
        dispatcherSeen = Boolean(options.dispatcher);
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );
  assert.equal(dispatcherSeen, true);
  assert.equal(result.proxyUsed, true);
  assert.match(result.message, /已使用网络代理/);
});

test("auto-adjusts a chat-only image model to the provider image endpoint model", async () => {
  const result = await testImageApiConnection(
    {
      endpoint: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "gpt-image-2",
    },
    {
      fetchImpl: async (url) => {
        if (String(url).endsWith("/api/pricing")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  model_name: "gpt-image-2",
                  supported_endpoint_types: ["openai"],
                },
                {
                  model_name: "gpt-image-1.5",
                  supported_endpoint_types: ["image-generation", "openai"],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  assert.equal(result.verified, true);
  assert.equal(result.adjustedModel, "gpt-image-1.5");
  assert.equal(result.adjustedSize, "1536x1024");
  assert.match(result.message, /未开放图片生成端点/);
});

test("distinguishes an upstream reset from a stopped proxy", async () => {
  await assert.rejects(
    () =>
      generateSlideImage(
        {
          endpoint: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-image-2",
          prompt: "test",
          proxyUrl: "http://127.0.0.1:7897",
        },
        {
          fetchImpl: async () => {
            throw new TypeError("fetch failed", {
              cause: { code: "ECONNRESET" },
            });
          },
        },
      ),
    /上游图片服务中途断开连接（ECONNRESET）/,
  );
});

test("retries a safe connection check once after a transient network error", async () => {
  let attempts = 0;
  const result = await testImageApiConnection(
    {
      endpoint: "https://api.example.com/v1",
      apiKey: "test-key",
      proxyUrl: "http://127.0.0.1:7897",
    },
    {
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("fetch failed", {
            cause: { code: "ECONNRESET" },
          });
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );
  assert.equal(attempts, 2);
  assert.equal(result.verified, true);
});

test("explains proxy connection failures in Chinese", async () => {
  await assert.rejects(
    () =>
      testImageApiConnection(
        {
          endpoint: "https://api.example.com/v1",
          apiKey: "test-key",
          proxyUrl: "http://127.0.0.1:7897",
        },
        {
          fetchImpl: async () => {
            throw new TypeError("fetch failed", {
              cause: { code: "ECONNREFUSED" },
            });
          },
        },
      ),
    /无法通过代理 http:\/\/127\.0\.0\.1:7897 访问图片 API/,
  );
});
