import { parseDeckScript } from "/script-parser.js";
import { parsePageStyleScript } from "/style-parser.js";
import {
  apiSettingsForLocalStorage,
  imageProviderMode,
  isWukongStudioEndpoint,
  isVolcengineSeedreamEndpoint,
  normalizeWukongApiKey,
  normalizeStoredConnectionStatus,
  sanitizeProviderOverrides,
  wukongEndpointForDisplay,
} from "/api-settings.js?v=20260815-wukong-proxy-fallback-v1";
import {
  normalizeGenerationConcurrency,
  runConcurrentTasks,
} from "/generation-queue.js?v=20260813-wukong-stable-queue";
import {
  deleteCoursewareArchive,
  getCoursewareArchive,
  listCoursewareArchives,
  saveCoursewareArchive,
} from "/archive-store.js";

const $ = (selector, root = document) => root.querySelector(selector);
const slideTemplate = $("#slideTemplate");
const slideGrid = $("#slideGrid");
const draftStorageKey = "visiondeck-draft-v1";
const settingsStorageKey = "visiondeck-api-settings-v1";
const concurrencyStorageKey = "visiondeck-generation-concurrency-v2";

const projectFields = {
  deckTitle: $("#deckTitle"),
  globalPrompt: $("#globalPrompt"),
  scriptInput: $("#scriptInput"),
  pageStyleInput: $("#pageStyleInput"),
};

const referenceFields = {
  input: $("#referenceImageInput"),
  uploader: $("#referenceUploader"),
  uploadButton: $("#referenceUploadButton"),
  preview: $("#referencePreview"),
  previewImage: $("#referencePreviewImage"),
  fileName: $("#referenceFileName"),
  fileSize: $("#referenceFileSize"),
  pages: $("#referencePages"),
  instruction: $("#referenceInstruction"),
  status: $("#referenceStatus"),
};

const apiFields = {
  provider: $("#imageProvider"),
  endpoint: $("#endpoint"),
  editEndpoint: $("#editEndpoint"),
  apiKey: $("#apiKey"),
  model: $("#model"),
  size: $("#size"),
  quality: $("#quality"),
  proxyUrl: $("#proxyUrl"),
  testEndpoint: $("#testEndpoint"),
  extraBody: $("#extraBody"),
  extraHeaders: $("#extraHeaders"),
};

const seedreamModelPresets = new Set([
  "doubao-seedream-5-0-lite-260128",
  "doubao-seedream-5-0-260128",
  "doubao-seedream-4-5-251128",
  "doubao-seedream-4-0-250828",
]);

function refreshSeedreamModelSelection() {
  const preset = $("#seedreamModelPreset");
  const custom = $("#seedreamCustomModel");
  const currentModel = apiFields.model.value.trim();
  if (seedreamModelPresets.has(currentModel)) {
    preset.value = currentModel;
    custom.hidden = true;
    custom.value = "";
  } else if (currentModel) {
    preset.value = "custom";
    custom.hidden = false;
    custom.value = currentModel;
  } else {
    preset.value = "doubao-seedream-5-0-lite-260128";
    custom.hidden = true;
    custom.value = "";
    apiFields.model.value = preset.value;
  }
}

function refreshApiProviderGuidance() {
  const providerMode = imageProviderMode(apiFields.endpoint.value);
  const wukong = providerMode === "wukong";
  const volcengine = providerMode === "volcengine-seedream";
  apiFields.provider.value = providerMode;
  $("#seedreamModelField").hidden = !volcengine;
  if (volcengine) refreshSeedreamModelSelection();
  $("#endpointHelp").textContent = wukong
    ? "学员只需填写 https://wkapi.work；系统会在后台自动使用悟空生图路径。"
    : volcengine
      ? "火山方舟填写官方 Base URL；工具会自动使用 /api/v3/images/generations。"
      : "填写服务商提供的图片 API Base URL，工具会自动补全标准生图路径。";
  $("#autoConfigTitle").textContent = wukong
    ? "已识别悟空创作台"
    : volcengine
      ? "已识别火山方舟豆包生图"
      : "普通使用只需填写以上两项";
  $("#autoConfigMessage").textContent = wukong
    ? "系统会先直连悟空接口；直连失败时自动切换系统代理。检测成功后会沿用可用线路，避免付费任务重复提交。"
    : volcengine
      ? "系统只调用 Seedream 图片生成接口；参考图会按豆包格式发送，并固定一次生成一张 16:9 课件图。"
      : "检测地址、图片生成地址、参考图接口和网络代理均由系统自动判断。";
  $("#modelLabel").textContent = wukong
    ? "悟空产品 ID"
    : volcengine
      ? "豆包图片模型 ID"
      : "模型名称";
  $("#modelHelp").textContent = wukong
    ? "推荐 image_gptImage2（GPT-Image-2，当前 0.15 元/张），检测连接会自动填写。"
    : volcengine
      ? "已由上方“豆包图片模型”同步；自定义时可填写 Seedream Model ID 或 ep-...。"
      : "默认使用 GPT Image 2，一般不需要修改。";
  $("#sizeLabel").textContent = wukong ? "输出比例" : "画面尺寸";
  $("#sizeHelp").textContent = wukong
    ? "课件固定使用 16:9；悟空接口不接收 1536x1024 等像素尺寸。"
    : volcengine
      ? "豆包默认使用 2560×1440，保持 16:9 横版。"
      : "标准 16:9 横版，适合整页 PPT。";
  for (const id of ["qualityField", "testEndpointField", "editEndpointField"]) {
    const element = $(`#${id}`);
    element.hidden = wukong || volcengine;
  }
  $("#modelField").hidden = volcengine;
  refreshProxyStatus();
}

function refreshProxyStatus() {
  const status = $("#proxyStatus");
  if (!status) return;
  if (isWukongStudioEndpoint(apiFields.endpoint.value)) {
    status.textContent = systemProxyDetected
      ? `悟空API将先直连；失败时自动切换系统代理 ${systemProxyLabel}`
      : "悟空API将先直连；未检测到系统代理，必要时可在这里手动填写";
    return;
  }
  status.textContent = systemProxyDetected
    ? `已自动检测到系统代理 ${systemProxyLabel}，这里留空即可使用`
    : "未检测到系统代理；可保持直连，或填写 HTTP 代理地址";
}

function applyImageProviderPreset(provider, { clearKey = true } = {}) {
  const previousOrigin = (() => {
    try {
      return new URL(apiFields.endpoint.value).origin;
    } catch {
      return "";
    }
  })();
  const presets = {
    wukong: {
      endpoint: "https://wkapi.work",
      model: "image_gptImage2",
      size: "16:9",
      quality: "high",
    },
    "volcengine-seedream": {
      endpoint: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seedream-5-0-lite-260128",
      size: "2560x1440",
      quality: "",
    },
  };
  const preset = presets[provider];
  if (preset) {
    apiFields.endpoint.value = preset.endpoint;
    apiFields.model.value = preset.model;
    apiFields.size.value = preset.size;
    apiFields.quality.value = preset.quality;
    for (const key of ["editEndpoint", "testEndpoint", "extraBody", "extraHeaders"]) {
      apiFields[key].value = "";
    }
    if (clearKey && previousOrigin && previousOrigin !== new URL(preset.endpoint).origin) {
      apiFields.apiKey.value = "";
      resetApiKeyVisibility();
    }
  } else if (provider === "custom") {
    if (imageProviderMode(apiFields.endpoint.value) !== "custom") {
      apiFields.endpoint.value = "";
      apiFields.model.value = "gpt-image-2";
      apiFields.size.value = "2048x1152";
      apiFields.quality.value = "high";
      if (clearKey) {
        apiFields.apiKey.value = "";
        resetApiKeyVisibility();
      }
    }
  }
  connectionVerified = false;
  connectionReachable = false;
  connectionConfigured = false;
  useSystemProxyForWukong = false;
  refreshApiProviderGuidance();
  setConnectionState("warning", "API 待检测");
  setTestResult("neutral", "已切换接口类型，请填写自己的 API Key 后检测连接。");
}

let slides = [];
let nextId = 1;
let busy = false;
let sourceDirty = false;
let mockMode = false;
let referenceImage = null;
let connectionVerified = false;
let connectionReachable = false;
let connectionConfigured = false;
let useSystemProxyForWukong = false;
let systemProxyDetected = false;
let systemProxyLabel = "";
let toastTimer;
let styleDirty = false;
let currentStep = 1;
let maxStepUnlocked = 1;
let lastApiEndpoint = "";
let activeArchiveId = "";
let activeArchiveCreatedAt = 0;
let archiveSaveTimer;
let archiveSaveChain = Promise.resolve();
let archiveStorageWarningShown = false;
const archiveImageBlobCache = new WeakMap();
let archiveReferenceBlobCache = null;

const stepMeta = {
  1: {
    hint: "填写并识别整套页纲内容",
    next: "下一步：参考图片",
  },
  2: {
    hint: "上传参考图，系统会参考并二创",
    next: "下一步：逐页要求",
  },
  3: {
    hint: "可选填写每页的风格和添加元素",
    next: "下一步：生成画面",
  },
  4: {
    hint: "批量生成、检查并重试每一页",
    next: "下一步：导出 PPT",
  },
  5: {
    hint: "确认页面完整后导出 16:9 PPT",
    next: "",
  },
};

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2500);
}

function branchFromArchivedProject() {
  activeArchiveId = "";
  activeArchiveCreatedAt = 0;
}

function updateWizardNavigation() {
  document.querySelectorAll(".step-tab").forEach((button) => {
    const step = Number(button.dataset.step);
    button.classList.toggle("active", step === currentStep);
    button.classList.toggle("complete", step < currentStep && step <= maxStepUnlocked);
    button.disabled = step > maxStepUnlocked;
    button.setAttribute("aria-current", step === currentStep ? "step" : "false");
  });

  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    const active = Number(panel.dataset.stepPanel) === currentStep;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });

  $("#previousStepButton").disabled = currentStep === 1;
  const nextButton = $("#nextStepButton");
  nextButton.hidden = currentStep === 5;
  if (currentStep < 5) {
    nextButton.innerHTML = `${stepMeta[currentStep].next} <span>→</span>`;
  }
  $("#currentStepLabel").textContent = `步骤 ${currentStep} / 5`;
  $("#currentStepHint").textContent = stepMeta[currentStep].hint;
  if (currentStep === 5) renderExportSummary();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goToStep(step, { unlock = false } = {}) {
  const target = Math.max(1, Math.min(5, Number(step) || 1));
  if (unlock) maxStepUnlocked = Math.max(maxStepUnlocked, target);
  if (target > maxStepUnlocked) return;
  currentStep = target;
  updateWizardNavigation();
}

function invalidateGeneratedSlides(message) {
  const affected = slides.filter((slide) => slide.imageDataUrl || slide.status !== "idle");
  if (!affected.length) return;
  for (const slide of affected) {
    slide.imageDataUrl = "";
    slide.prompt = "";
    slide.status = "idle";
    slide.error = "";
  }
  renderSlides();
  if (message) toast(message);
}

function nextStep() {
  if (currentStep === 1) {
    if (!parseSource()) return;
    goToStep(2, { unlock: true });
    return;
  }
  if (currentStep === 2) {
    try {
      parseReferencePages(referenceFields.pages.value);
    } catch (error) {
      toast(error.message);
      return;
    }
    goToStep(3, { unlock: true });
    return;
  }
  if (currentStep === 3) {
    if (!applyPageStyleInstructions()) return;
    goToStep(4, { unlock: true });
    return;
  }
  if (currentStep === 4) {
    goToStep(5, { unlock: true });
  }
}

function setConnectionState(state, label) {
  const element = $("#connectionState");
  const descriptions = {
    verified: "API 已通过连接或生图验证",
    reachable: "API 路径可访问，已保存配置",
    configured: "API 配置已保存，尚未完成连接验证",
    warning: "API 配置待检测",
    error: "API 连接失败",
  };
  const description = descriptions[state] || label;
  element.dataset.imageState = state || "";
  element.dataset.imageLabel = label;
  element.dataset.imageDescription = description;
  if (!document.body.dataset.activeWorkspace || document.body.dataset.activeWorkspace === "courseware") {
    element.className = `connection-state ${state || ""}`.trim();
    $("span", element).textContent = label;
    element.title = description;
    element.setAttribute("aria-label", description);
  }
}

function setTestResult(state, message) {
  const element = $("#connectionTestResult");
  element.className = `test-result ${state}`;
  element.textContent = message;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseReferencePages(value) {
  const source = String(value || "").trim();
  if (!source || source === "全部") return null;

  const pages = new Set();
  const tokens = source
    .replace(/[，、]/g, ",")
    .replace(/至/g, "-")
    .split(/[\s,]+/)
    .filter(Boolean);

  for (const token of tokens) {
    const single = token.match(/^(\d+)$/);
    const range = token.match(/^(\d+)-(\d+)$/);
    if (single) {
      pages.add(Number(single[1]));
      continue;
    }
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > end || end - start > 200) {
        throw new Error(`参考图页码范围“${token}”无效。`);
      }
      for (let page = start; page <= end; page += 1) pages.add(page);
      continue;
    }
    throw new Error(`参考图页码“${token}”无法识别，请使用 1,3-5 格式。`);
  }
  return pages;
}

function refreshReferenceStatus() {
  const status = referenceFields.status;
  if (!referenceImage) {
    status.className = "reference-status";
    status.textContent = "未上传时，会根据页纲和逐页要求直接生成。";
    return;
  }

  try {
    const pages = parseReferencePages(referenceFields.pages.value);
    const scope = pages
      ? `第 ${Array.from(pages).sort((a, b) => a - b).join("、")} 页`
      : "全部页面";
    status.className = "reference-status active";
    status.textContent = `参考图已启用：系统会分析后重新创作，应用到${scope}。`;
  } catch (error) {
    status.className = "reference-status error";
    status.textContent = error.message;
  }
}

function renderReferenceImage() {
  const hasImage = Boolean(referenceImage);
  referenceFields.uploadButton.hidden = hasImage;
  referenceFields.preview.hidden = !hasImage;
  if (hasImage) {
    referenceFields.previewImage.src = referenceImage.dataUrl;
    referenceFields.fileName.textContent = referenceImage.name;
    referenceFields.fileSize.textContent = formatFileSize(referenceImage.size);
  } else {
    referenceFields.previewImage.removeAttribute("src");
    referenceFields.fileName.textContent = "";
    referenceFields.fileSize.textContent = "";
  }
  refreshReferenceStatus();
}

async function loadReferenceImage(file) {
  if (!file) return;
  const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!supportedTypes.has(file.type)) {
    throw new Error("参考图仅支持 PNG、JPG 或 WebP。");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("参考图不能超过 12 MB。");
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取参考图失败，请重新选择。"));
    reader.readAsDataURL(file);
  });
  referenceImage = {
    dataUrl,
    name: file.name || "reference-image",
    size: file.size,
  };
  archiveReferenceBlobCache = null;
  branchFromArchivedProject();
  invalidateGeneratedSlides();
  renderReferenceImage();
  saveDraft();
  toast("参考图已启用；已有画面需要重新生成");
}

function clearReferenceImage() {
  const hadImage = Boolean(referenceImage);
  if (hadImage) branchFromArchivedProject();
  referenceImage = null;
  archiveReferenceBlobCache = null;
  referenceFields.input.value = "";
  if (hadImage) invalidateGeneratedSlides();
  renderReferenceImage();
  saveDraft();
  toast(hadImage ? "参考图已移除；已有画面需要重新生成" : "尚未上传参考图");
}

function referencePayloadForSlide(slide) {
  if (!referenceImage) return {};
  const pages = parseReferencePages(referenceFields.pages.value);
  if (pages && !pages.has(Number(slide.pageNumber))) return {};
  return {
    referenceImageDataUrl: referenceImage.dataUrl,
    referenceImageName: referenceImage.name,
    referenceMode: "composition",
    referenceInstruction: referenceFields.instruction.value.trim(),
  };
}

function newSlide(page) {
  return {
    id: nextId++,
    pageNumber: page.pageNumber,
    title: page.title,
    pageText: page.pageText,
    visualPrompt: page.visualPrompt,
    pageStylePrompt: "",
    imageDataUrl: "",
    prompt: "",
    status: "idle",
    error: "",
  };
}

function statusMeta(status) {
  if (status === "working") return ["working", "生成中"];
  if (status === "success") return ["success", "已完成"];
  if (status === "error") return ["error", "失败"];
  return ["neutral", "待生成"];
}

function renderSlides() {
  slideGrid.innerHTML = "";
  $("#emptyState").classList.toggle("hidden", slides.length > 0);

  slides.forEach((slide) => {
    const fragment = slideTemplate.content.cloneNode(true);
    const card = $(".slide-card", fragment);
    card.dataset.id = String(slide.id);

    const preview = $(".slide-preview", card);
    const [statusClass, statusLabel] = statusMeta(slide.status);
    $(".preview-page", card).textContent = `PAGE ${String(slide.pageNumber).padStart(2, "0")}`;
    $(".slide-number", card).textContent = `PAGE ${String(slide.pageNumber).padStart(2, "0")}`;
    $(".slide-title", card).textContent = slide.title || "未填写页面标题";
    $(".slide-excerpt", card).textContent = slide.pageText || "未填写页面文字";
    $(".slide-direction", card).textContent = slide.pageStylePrompt
      ? "已应用本页风格与元素要求"
      : "";
    $(".slide-error", card).textContent = slide.error || "";

    const status = $(".preview-status", card);
    status.className = `preview-status ${statusClass}`;
    status.textContent = statusLabel;

    if (slide.imageDataUrl) {
      preview.classList.add("has-image");
      $("img", preview).src = slide.imageDataUrl;
    }

    const retry = $(".retry-button", card);
    const retryNote = $(".retry-note", card);
    const hasPreviousImage = Boolean(slide.imageDataUrl);
    if (slide.status === "working") {
      retry.textContent = hasPreviousImage ? "正在重新生成…" : "正在生成…";
    } else {
      retry.textContent = hasPreviousImage
        ? "↻ 再抽一张（替换本页）"
        : "生成这一页";
    }
    retryNote.textContent = hasPreviousImage
      ? "当前图片会保留，成功后才替换"
      : "只生成这一页，不影响其他页面";
    retry.disabled =
      slide.status === "working" || busy || sourceDirty || styleDirty;
    retry.setAttribute(
      "aria-label",
      hasPreviousImage
        ? `重新生成第 ${slide.pageNumber} 页并替换当前图片`
        : `生成第 ${slide.pageNumber} 页`,
    );
    retry.addEventListener("click", () => generateOne(slide.id));
    slideGrid.appendChild(fragment);
  });
  updateProgress();
}

function showWarnings(warnings) {
  const container = $("#warningList");
  container.innerHTML = "";
  warnings.slice(0, 6).forEach((warning) => {
    const item = document.createElement("p");
    item.textContent = `· ${warning}`;
    container.appendChild(item);
  });
  if (warnings.length > 6) {
    const item = document.createElement("p");
    item.textContent = `另有 ${warnings.length - 6} 条提醒`;
    container.appendChild(item);
  }
}

function showStyleWarnings(warnings) {
  const container = $("#styleWarningList");
  container.innerHTML = "";
  warnings.slice(0, 6).forEach((warning) => {
    const item = document.createElement("p");
    item.textContent = `· ${warning}`;
    container.appendChild(item);
  });
}

function applyPageStyleInstructions({ quiet = false } = {}) {
  try {
    const result = parsePageStyleScript(projectFields.pageStyleInput.value);
    const promptsByPage = new Map();
    for (const page of result.pages) {
      const existing = promptsByPage.get(page.pageNumber);
      promptsByPage.set(
        page.pageNumber,
        [existing, page.prompt].filter(Boolean).join("\n\n"),
      );
    }

    const knownPages = new Set(slides.map((slide) => Number(slide.pageNumber)));
    const warnings = [...result.warnings];
    for (const pageNumber of promptsByPage.keys()) {
      if (!knownPages.has(Number(pageNumber))) {
        warnings.push(`第 ${pageNumber} 页不在当前页纲中，已暂时忽略。`);
      }
    }

    let changedGenerated = 0;
    for (const slide of slides) {
      const nextPrompt = promptsByPage.get(Number(slide.pageNumber)) || "";
      if (slide.pageStylePrompt !== nextPrompt && slide.imageDataUrl) {
        slide.imageDataUrl = "";
        slide.prompt = "";
        slide.status = "idle";
        slide.error = "";
        changedGenerated += 1;
      }
      slide.pageStylePrompt = nextPrompt;
    }

    styleDirty = false;
    $("#styledPageCount").textContent =
      `${Array.from(promptsByPage.keys()).filter((page) => knownPages.has(page)).length} 页`;
    $("#styleParseHint").className = "parse-hint";
    $("#styleParseHint").textContent = result.pages.length
      ? `已应用 ${result.pages.length} 页特殊要求`
      : "未填写逐页要求，将由系统自动设计";
    showStyleWarnings(warnings);
    renderSlides();
    saveDraft();
    if (!quiet) {
      toast(
        changedGenerated
          ? `逐页要求已更新，${changedGenerated} 页需要重新生成`
          : "逐页要求已应用",
      );
    }
    return true;
  } catch (error) {
    styleDirty = true;
    $("#styleParseHint").className = "parse-hint dirty";
    $("#styleParseHint").textContent = error.message;
    showStyleWarnings([error.message]);
    if (!quiet) toast(error.message);
    return false;
  }
}

function parseSource({ quiet = false } = {}) {
  try {
    const result = parseDeckScript(projectFields.scriptInput.value);
    slides = result.pages
      .slice()
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map(newSlide);
    sourceDirty = false;
    $("#parseHint").className = "parse-hint";
    $("#parseHint").textContent = `已识别 ${slides.length} 页，可以开始生成`;
    $("#outlineCount").textContent = `${slides.length} 页`;
    showWarnings(result.warnings);
    applyPageStyleInstructions({ quiet: true });
    renderSlides();
    saveDraft();
    if (!quiet) toast(`已识别 ${slides.length} 页内容`);
    return true;
  } catch (error) {
    slides = [];
    $("#outlineCount").textContent = "0 页";
    showWarnings([error.message]);
    renderSlides();
    $("#parseHint").className = "parse-hint dirty";
    $("#parseHint").textContent = error.message;
    if (!quiet) toast(error.message);
    return false;
  }
}

function markSourceDirty() {
  branchFromArchivedProject();
  if (slides.length) {
    sourceDirty = true;
    $("#parseHint").className = "parse-hint dirty";
    $("#parseHint").textContent = "页纲已修改，请重新识别后再生成";
    $("#outlineCount").textContent = "待识别";
    updateProgress();
  } else {
    $("#parseHint").className = "parse-hint";
    $("#parseHint").textContent = "填写完成后点击“识别页纲”";
  }
  saveDraft();
}

function markStyleDirty() {
  branchFromArchivedProject();
  styleDirty = true;
  $("#styleParseHint").className = "parse-hint dirty";
  $("#styleParseHint").textContent = "逐页要求已修改，请重新应用";
  saveDraft();
  updateProgress();
}

function fillExample() {
  projectFields.deckTitle.value = "AI 工作流提效方案";
  projectFields.globalPrompt.value = "";
  projectFields.scriptInput.value = `第1页
页面标题：AI 工作流提效方案
页面文字：
把重复工作交给系统
把关键判断留给人

第2页
页面标题：三个关键变化
页面文字：
01 任务自动拆解
02 内容批量生成
03 结果统一交付

第3页
页面标题：从一次制作到持续复用
页面文字：
沉淀模板、提示词和审核标准
让每次交付都成为下一次的起点`;
  parseSource();
}

function fillStyleExample() {
  projectFields.pageStyleInput.value = `第1页
画面风格：明亮、现代、简洁的中文商业演示
添加元素：抽象数据流、柔和绿色光点、大面积留白

第2页
画面风格：清晰的信息图版式
添加元素：三个并列步骤卡片、细线图标

第3页
画面风格：具有延展感的总结页
添加元素：上升路径、模板卡片、循环箭头`;
  markStyleDirty();
  applyPageStyleInstructions();
}

function clearProject() {
  branchFromArchivedProject();
  projectFields.scriptInput.value = "";
  slides = [];
  sourceDirty = false;
  showWarnings([]);
  $("#parseHint").className = "parse-hint";
  $("#parseHint").textContent = "按“第N页 / 页面标题 / 页面文字”格式粘贴";
  $("#outlineCount").textContent = "0 页";
  renderSlides();
  saveDraft();
}

function clearPageStyles() {
  projectFields.pageStyleInput.value = "";
  markStyleDirty();
  applyPageStyleInstructions();
}

function collectRawApiSettings() {
  if (apiFields.provider.value === "volcengine-seedream") {
    const preset = $("#seedreamModelPreset").value;
    apiFields.model.value = preset === "custom"
      ? $("#seedreamCustomModel").value.trim()
      : preset;
  }
  return {
    endpoint: apiFields.endpoint.value.trim(),
    editEndpoint: apiFields.editEndpoint.value.trim(),
    apiKey: apiFields.apiKey.value,
    model: apiFields.model.value.trim(),
    size: apiFields.size.value.trim(),
    quality: apiFields.quality.value,
    proxyUrl: apiFields.proxyUrl.value.trim(),
    useSystemProxyForWukong,
    testEndpoint: apiFields.testEndpoint.value.trim(),
    extraBody: apiFields.extraBody.value.trim(),
    extraHeaders: apiFields.extraHeaders.value.trim(),
  };
}

function applyProviderSafety({ previousEndpoint = lastApiEndpoint, ownerOrigin = "", notify = false } = {}) {
  const result = sanitizeProviderOverrides(collectRawApiSettings(), {
    previousEndpoint,
    ownerOrigin,
  });
  for (const key of result.cleared) {
    if (apiFields[key]) apiFields[key].value = "";
  }
  if (result.ownerOrigin) lastApiEndpoint = result.settings.endpoint;
  if (notify && result.cleared.length) {
    setTestResult(
      "neutral",
      "已识别为新的 API 服务商，旧的兼容参数已自动清除，请直接检测连接。",
    );
  }
  return result;
}

function collectApiSettings() {
  return applyProviderSafety().settings;
}

function persistApiSettings() {
  const settings = collectApiSettings();
  localStorage.setItem(
    settingsStorageKey,
    JSON.stringify(
      apiSettingsForLocalStorage(settings, {
        connectionStatus: connectionVerified
          ? "verified"
          : connectionReachable
            ? "reachable"
            : connectionConfigured
              ? "configured"
              : "pending",
      }),
    ),
  );
}

function applyApiSettings(settings = {}) {
  useSystemProxyForWukong = Boolean(settings.useSystemProxyForWukong);
  for (const key of [
    "endpoint",
    "editEndpoint",
    "apiKey",
    "model",
    "size",
    "quality",
    "proxyUrl",
    "testEndpoint",
    "extraBody",
    "extraHeaders",
  ]) {
    if (settings[key] != null && apiFields[key]) {
      apiFields[key].value =
        key === "endpoint" ? wukongEndpointForDisplay(settings[key]) : settings[key];
    }
  }
  apiFields.provider.value = imageProviderMode(apiFields.endpoint.value);
  refreshApiProviderGuidance();
}

function clearApiSettings() {
  const confirmed = window.confirm(
    "确定清除保存在这台电脑上的 API 地址、API Key 和高级设置吗？清除后需要重新填写。",
  );
  if (!confirmed) return;
  localStorage.removeItem(settingsStorageKey);
  const defaults = {
    endpoint: "",
    editEndpoint: "",
    apiKey: "",
    model: "gpt-image-2",
    size: "2048x1152",
    quality: "high",
    proxyUrl: "",
    testEndpoint: "",
    extraBody: "",
    extraHeaders: "",
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (apiFields[key]) apiFields[key].value = value;
  }
  refreshApiProviderGuidance();
  lastApiEndpoint = "";
  connectionVerified = false;
  connectionReachable = false;
  connectionConfigured = false;
  useSystemProxyForWukong = false;
  setConnectionState("", "API 未配置");
  setTestResult("neutral", "本机 API 配置已清除");
  resetApiKeyVisibility();
  toast("本机 API 配置已清除");
}

function openApiDialog() {
  apiFields.provider.value = imageProviderMode(apiFields.endpoint.value);
  refreshApiProviderGuidance();
  $("#apiDialog").showModal();
  setTestResult(
    "neutral",
    connectionVerified
      ? "当前 API 已连接；修改参数后需重新检测"
      : connectionReachable
        ? "当前 API 可访问且配置已保存；真实生图后会升级为已连接"
        : connectionConfigured
          ? "当前 API 配置已保存；可点击“检测连接”继续验证"
          : "填写完成后，请先检测连接",
  );
  requestAnimationFrame(() => {
    const firstField = apiFields.endpoint.value ? apiFields.apiKey : apiFields.endpoint;
    firstField.focus({ preventScroll: true });
  });
}

function resetApiKeyVisibility() {
  const button = $("#toggleApiKey");
  apiFields.apiKey.type = "password";
  button.textContent = "显示";
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", "显示 API Key");
}

function closeApiDialog() {
  resetApiKeyVisibility();
  $("#apiDialog").close();
}

function toggleApiKeyVisibility() {
  const button = $("#toggleApiKey");
  const willShow = apiFields.apiKey.type === "password";
  apiFields.apiKey.type = willShow ? "text" : "password";
  button.textContent = willShow ? "隐藏" : "显示";
  button.setAttribute("aria-pressed", String(willShow));
  button.setAttribute("aria-label", willShow ? "隐藏 API Key" : "显示 API Key");
  apiFields.apiKey.focus({ preventScroll: true });
}

function saveApiSettings() {
  const settings = collectApiSettings();
  const hasEndpoint = Boolean(settings.endpoint);
  connectionConfigured = hasEndpoint;
  persistApiSettings();
  const state = hasEndpoint
    ? connectionVerified
      ? "verified"
      : connectionReachable
        ? "reachable"
        : "configured"
    : "";
  const label = hasEndpoint
    ? connectionVerified
      ? "API 已连接"
      : connectionReachable
        ? "API 可访问"
        : "API 已配置"
    : "API 未配置";
  setConnectionState(state, label);
  closeApiDialog();
  toast(
    hasEndpoint
      ? connectionVerified
        ? "接口已验证并保存"
        : connectionReachable
          ? "接口可访问，配置已保存"
          : "接口配置已保存到当前电脑"
      : "接口设置已清空",
  );
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.blob();
  if (!response.ok) {
    throw new Error(body?.error || `请求失败（HTTP ${response.status}）`);
  }
  return { body, response };
}

async function testConnection() {
  let wukongKeyPrefixAdjusted = false;
  if (isWukongStudioEndpoint(apiFields.endpoint.value)) {
    const currentKey = apiFields.apiKey.value.trim();
    const normalizedKey = normalizeWukongApiKey(currentKey);
    wukongKeyPrefixAdjusted = Boolean(normalizedKey && normalizedKey !== currentKey);
    if (wukongKeyPrefixAdjusted) apiFields.apiKey.value = normalizedKey;
  }
  const settings = collectApiSettings();
  if (!settings.endpoint && !mockMode) {
    connectionVerified = false;
    setTestResult("error", "请先填写图片生成 API 地址。");
    setConnectionState("error", "API 未配置");
    return;
  }

  const button = $("#testConnectionButton");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28_000);
  button.disabled = true;
  button.textContent = "检测中…";
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  setTestResult("working", "正在检测服务器、鉴权和模型接口…");
  try {
    if (mockMode) {
      connectionVerified = true;
      connectionReachable = true;
      connectionConfigured = true;
      setTestResult("success", "模拟接口连接正常。");
      setConnectionState("verified", "模拟接口已连接");
      return;
    }
    const { body } = await apiRequest("/api/test-connection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
      signal: controller.signal,
    });
    const adjustments = [];
    if (wukongKeyPrefixAdjusted) adjustments.push("Key 已移除重复的 sk- 前缀");
    if (body.adjustedEndpoint) {
      apiFields.endpoint.value =
        body.providerMode === "wukong-studio"
          ? wukongEndpointForDisplay(body.adjustedEndpoint)
          : body.adjustedEndpoint;
      adjustments.push(
        body.providerMode === "wukong-studio"
          ? "已自动匹配悟空生图路径"
          : body.providerMode === "volcengine-seedream"
            ? "已自动匹配豆包 Seedream 生图路径"
            : "已匹配图片生成路径",
      );
    }
    if (body.adjustedModel) {
      apiFields.model.value = body.adjustedModel;
      adjustments.push(
        body.providerMode === "wukong-studio"
          ? `产品改为 ${body.adjustedModel}`
          : `模型改为 ${body.adjustedModel}`,
      );
    }
    if (body.adjustedSize) {
      apiFields.size.value = body.adjustedSize;
      adjustments.push(
        body.providerMode === "wukong-studio"
          ? `比例改为 ${body.adjustedSize}`
          : `尺寸改为 ${body.adjustedSize}`,
      );
    }
    connectionVerified = Boolean(body.verified);
    connectionReachable = Boolean(body.ok);
    connectionConfigured = true;
    useSystemProxyForWukong = body.networkRoute === "system-proxy";
    apiFields.provider.value = body.providerMode === "volcengine-seedream"
      ? "volcengine-seedream"
      : imageProviderMode(apiFields.endpoint.value);
    refreshApiProviderGuidance();
    persistApiSettings();
    const message = adjustments.length
      ? `${body.message} 工具已自动将${adjustments.join("、")}。`
      : body.message;
    setTestResult(body.verified ? "success" : "warning", message);
    setConnectionState(
      connectionVerified ? "verified" : connectionReachable ? "reachable" : "warning",
      connectionVerified ? "API 已连接" : connectionReachable ? "API 可访问" : "API 待检测",
    );
  } catch (error) {
    connectionVerified = false;
    connectionReachable = false;
    const message =
      wukongKeyPrefixAdjusted && /401|403|鉴权/.test(String(error?.message || ""))
        ? "已自动移除 API Key 中重复的 sk- 前缀，但鉴权仍失败。请作废已暴露的旧 Key，并重新创建一把已启用的“生图组”Key。"
        : error.message;
    setTestResult(
      "error",
      error?.name === "AbortError"
        ? "连接检测超过 28 秒，已自动停止。请确认代理软件正在运行后重试。"
        : message,
    );
    setConnectionState("error", "连接失败");
  } finally {
    clearTimeout(timeout);
    button.disabled = false;
    button.textContent = "检测连接";
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
  }
}

function friendlyGenerationError(error) {
  const message = String(error?.message || error || "图片生成失败。");
  if (/上游图片服务中途断开连接/.test(message)) {
    return `${message} 当前平台请先在“接口设置”里重新检测，工具会自动选择其开放的生图模型。`;
  }
  if (/无可用渠道/.test(message)) {
    return "当前图片模型不可用。请打开“接口设置”并重新检测，工具会自动匹配该平台开放的生图模型。";
  }
  if (/HTTP 503/.test(message)) {
    return "图片服务暂时繁忙（HTTP 503），请稍后点击“生成本页”重试。";
  }
  return message;
}

function defaultVisualPrompt(slide) {
  const explicit = [slide.visualPrompt, slide.pageStylePrompt]
    .filter(Boolean)
    .join("\n\n");
  if (explicit) return explicit;
  return [
    "请根据本页标题和正文自动选择最合适的专业演示版式。",
    "标题层级清晰，正文易读，重点信息有明确视觉强调。",
    "避免堆叠过多装饰，保持完整、平衡且适合商务表达。",
  ].join("");
}

async function generateOne(id, { silent = false } = {}) {
  const slide = slides.find((item) => item.id === id);
  if (!slide || slide.status === "working") return false;
  if (sourceDirty || styleDirty) {
    if (!silent) {
      toast(sourceDirty ? "请先重新识别页纲" : "请先重新应用逐页要求");
    }
    return false;
  }
  const settings = collectApiSettings();
  if (!settings.endpoint && !mockMode) {
    slide.status = "error";
    slide.error = "请先在右上角“接口设置”中配置自己的 API。";
    setConnectionState("error", "API 未配置");
    renderSlides();
    if (!silent) {
      toast("请先配置并检测自己的 API");
      openApiDialog();
    }
    return false;
  }

  let referencePayload;
  try {
    referencePayload = referencePayloadForSlide(slide);
  } catch (error) {
    slide.status = "error";
    slide.error = error.message;
    renderSlides();
    if (!silent) toast(error.message);
    return false;
  }

  const previousImageDataUrl = slide.imageDataUrl;
  const previousPrompt = slide.prompt;
  const isRegeneration = Boolean(previousImageDataUrl);
  slide.status = "working";
  slide.error = "";
  renderSlides();
  try {
    const { body } = await apiRequest("/api/generate-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...settings,
        pageNumber: slide.pageNumber,
        pageText: [slide.title, slide.pageText].filter(Boolean).join("\n"),
        visualPrompt: defaultVisualPrompt(slide),
        globalPrompt: projectFields.globalPrompt.value.trim(),
        ...referencePayload,
      }),
    });
    slide.imageDataUrl = body.imageDataUrl;
    slide.prompt = body.prompt;
    slide.status = "success";
    scheduleArchiveSave();
    connectionVerified = true;
    connectionReachable = true;
    connectionConfigured = true;
    persistApiSettings();
    setConnectionState("verified", mockMode ? "模拟接口已连接" : "API 已连接");
    if (!silent) {
      toast(
        isRegeneration
          ? `第 ${slide.pageNumber} 页新画面已替换`
          : `第 ${slide.pageNumber} 页生成完成`,
      );
    }
    return true;
  } catch (error) {
    const friendlyError = friendlyGenerationError(error);
    if (previousImageDataUrl) {
      slide.imageDataUrl = previousImageDataUrl;
      slide.prompt = previousPrompt;
      slide.status = "success";
      slide.error = `重新生成失败，已保留上一张图片。${friendlyError}`;
    } else {
      slide.status = "error";
      slide.error = friendlyError;
    }
    setConnectionState("error", "生成请求失败");
    if (!silent) {
      toast(
        isRegeneration
          ? `第 ${slide.pageNumber} 页重新生成失败，已保留上一张`
          : `第 ${slide.pageNumber} 页生成失败`,
      );
    }
    return false;
  } finally {
    renderSlides();
  }
}

async function generateAll() {
  if (busy) return;
  if (sourceDirty) {
    toast("页纲已修改，请先重新识别");
    return;
  }
  if (styleDirty) {
    toast("逐页要求已修改，请先重新应用");
    return;
  }
  const pending = slides.filter((slide) => slide.status !== "success");
  if (!pending.length) {
    toast("所有页面都已生成");
    return;
  }
  const settings = collectApiSettings();
  if (!settings.endpoint && !mockMode) {
    toast("请先配置并检测自己的 API");
    openApiDialog();
    return;
  }

  const concurrency = normalizeGenerationConcurrency(
    $("#generationConcurrency")?.value,
  );
  busy = true;
  renderSlides();
  try {
    await runConcurrentTasks(
      pending,
      (slide) => generateOne(slide.id, { silent: true }),
      concurrency,
    );
  } finally {
    busy = false;
    renderSlides();
  }
  await flushArchiveSave();
  const failed = slides.filter((slide) => slide.status === "error").length;
  toast(failed ? `生成结束，${failed} 页需要重试` : "全部页面生成完成");
}

function dataUrlToBlob(dataUrl) {
  const [header, payload = ""] = String(dataUrl || "").split(",", 2);
  const mimeType = header.match(/^data:([^;,]+)/i)?.[1] || "application/octet-stream";
  const isBase64 = /;base64/i.test(header);
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取本地存档图片失败。"));
    reader.readAsDataURL(blob);
  });
}

function loadDataUrlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法生成课件存档封面。"));
    image.src = dataUrl;
  });
}

async function createArchiveThumbnail(dataUrl) {
  if (!dataUrl) return "";
  const image = await loadDataUrlImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(
    image,
    (canvas.width - width) / 2,
    (canvas.height - height) / 2,
    width,
    height,
  );
  return canvas.toDataURL("image/jpeg", 0.72);
}

function createArchiveId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `courseware-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function archiveBlobForSlide(slide) {
  const cached = archiveImageBlobCache.get(slide);
  if (cached?.source === slide.imageDataUrl) return cached.blob;
  const blob = dataUrlToBlob(slide.imageDataUrl);
  archiveImageBlobCache.set(slide, { source: slide.imageDataUrl, blob });
  return blob;
}

async function buildCurrentArchive() {
  const completed = slides.filter((slide) => slide.status === "success" && slide.imageDataUrl);
  if (!completed.length) return null;

  const now = Date.now();
  if (!activeArchiveId) activeArchiveId = createArchiveId();
  if (!activeArchiveCreatedAt) activeArchiveCreatedAt = now;

  const storedSlides = [];
  for (const slide of slides) {
    storedSlides.push({
      pageNumber: slide.pageNumber,
      title: slide.title,
      pageText: slide.pageText,
      visualPrompt: slide.visualPrompt,
      pageStylePrompt: slide.pageStylePrompt,
      prompt: slide.prompt,
      status: slide.status === "success" && slide.imageDataUrl ? "success" : "idle",
      imageBlob: slide.imageDataUrl ? await archiveBlobForSlide(slide) : null,
    });
  }

  let storedReference = null;
  if (referenceImage?.dataUrl) {
    if (archiveReferenceBlobCache?.source !== referenceImage.dataUrl) {
      archiveReferenceBlobCache = {
        source: referenceImage.dataUrl,
        blob: dataUrlToBlob(referenceImage.dataUrl),
      };
    }
    storedReference = {
      name: referenceImage.name,
      size: referenceImage.size,
      imageBlob: archiveReferenceBlobCache.blob,
    };
  }

  const title = projectFields.deckTitle.value.trim() || "未命名课件";
  const complete = completed.length === slides.length && slides.length > 0;
  const project = {
    id: activeArchiveId,
    version: 1,
    createdAt: activeArchiveCreatedAt,
    updatedAt: now,
    plan: planState(),
    slides: storedSlides,
    referenceImage: storedReference,
  };
  const summary = {
    id: activeArchiveId,
    title,
    createdAt: activeArchiveCreatedAt,
    updatedAt: now,
    pageCount: slides.length,
    completedCount: completed.length,
    complete,
    coverDataUrl: await createArchiveThumbnail(completed[0].imageDataUrl),
  };
  return { project, summary };
}

function handleArchiveSaveError(error) {
  if (archiveStorageWarningShown) return;
  archiveStorageWarningShown = true;
  const message = /quota|space|storage/i.test(`${error?.name || ""} ${error?.message || ""}`)
    ? "本机存储空间不足，请在“课件时光舱”删除不需要的作品。"
    : `自动存档失败：${error?.message || "请检查浏览器本地存储权限。"}`;
  toast(message);
}

async function updateArchiveCountBadge() {
  const badge = $("#archiveCountBadge");
  try {
    const summaries = await listCoursewareArchives();
    badge.textContent = String(summaries.length);
    badge.hidden = summaries.length === 0;
    $("#archiveTotalCount").textContent = `${summaries.length} 份`;
    return summaries;
  } catch {
    badge.hidden = true;
    return [];
  }
}

async function saveCurrentArchive({ notify = false } = {}) {
  const archive = await buildCurrentArchive();
  if (!archive) return false;
  try {
    await saveCoursewareArchive(archive.project, archive.summary);
    archiveStorageWarningShown = false;
    await updateArchiveCountBadge();
    if ($("#archiveDialog").open) await renderArchiveList();
    if (notify) toast("课件已存入时光舱");
    return true;
  } catch (error) {
    handleArchiveSaveError(error);
    throw error;
  }
}

function scheduleArchiveSave() {
  if (!slides.some((slide) => slide.imageDataUrl)) return;
  clearTimeout(archiveSaveTimer);
  archiveSaveTimer = setTimeout(() => {
    archiveSaveChain = archiveSaveChain
      .then(() => saveCurrentArchive())
      .catch(() => undefined);
  }, 700);
}

function flushArchiveSave() {
  clearTimeout(archiveSaveTimer);
  archiveSaveChain = archiveSaveChain
    .then(() => saveCurrentArchive())
    .catch(() => undefined);
  return archiveSaveChain;
}

async function downloadPptxFile(title, imageDataUrls) {
  const { body, response } = await apiRequest("/api/export-pptx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      slides: imageDataUrls.map((imageDataUrl) => ({ imageDataUrl })),
    }),
  });
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const filename = match
    ? decodeURIComponent(match[1])
    : `${String(title || "生财有术mini航海原创PPT课件").trim()}.pptx`;
  const url = URL.createObjectURL(body);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return filename;
}

async function exportPpt() {
  const completed = slides.filter(
    (slide) => slide.status === "success" && slide.imageDataUrl,
  );
  if (!slides.length || completed.length !== slides.length) {
    toast("还有页面没有生成完成，暂不能导出缺页 PPT");
    goToStep(4, { unlock: true });
    return;
  }
  const button = $("#exportPptButton");
  button.disabled = true;
  button.textContent = "正在合成…";
  try {
    await flushArchiveSave();
    await downloadPptxFile(
      projectFields.deckTitle.value.trim(),
      completed.map((slide) => slide.imageDataUrl),
    );
    toast(`已导出 ${completed.length} 页 PPT`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.innerHTML = '导出 16:9 PPT <span>↗</span>';
    updateProgress();
  }
}

function updateProgress() {
  const total = slides.length;
  const completed = slides.filter((slide) => slide.status === "success").length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  $("#parsedCount").textContent = String(total);
  $("#generatedCount").textContent = String(completed);
  $("#progressBar").style.width = `${percent}%`;
  const working = slides.filter((slide) => slide.status === "working").length;
  $("#progressText").textContent = total
    ? busy
      ? `${working} 张生成中 · ${completed} / ${total} 页已完成`
      : `${completed} / ${total} 页已生成`
    : "等待识别页纲";
  const generateAllButton = $("#generateAllButton");
  generateAllButton.disabled = !total || busy || sourceDirty || styleDirty;
  generateAllButton.innerHTML = busy
    ? "正在并发生成… <span>↗</span>"
    : "批量生成全部画面 <span>↗</span>";
  const concurrencyControl = $("#generationConcurrency");
  if (concurrencyControl) concurrencyControl.disabled = busy;
  $("#exportPptButton").disabled =
    !total || completed !== total || busy || sourceDirty || styleDirty;
  renderExportSummary();
}

function renderExportSummary() {
  const total = slides.length;
  const completed = slides.filter(
    (slide) => slide.status === "success" && slide.imageDataUrl,
  ).length;
  const missing = slides
    .filter((slide) => slide.status !== "success" || !slide.imageDataUrl)
    .map((slide) => slide.pageNumber);
  const ready = total > 0 && completed === total && !sourceDirty && !styleDirty;
  const card = $(".export-card");
  card?.classList.toggle("ready", ready);
  $("#exportStateIcon").textContent = ready ? "✓" : "!";
  $("#exportReadyTitle").textContent = ready
    ? "全部页面已经准备完成"
    : "等待生成全部页面";
  $("#exportReadyText").textContent = ready
    ? `共 ${total} 页，将按照页码顺序合成为完整 PowerPoint。`
    : "请先完成所有页面的图片生成，再导出完整 PPT。";
  $("#exportDeckTitle").textContent =
    projectFields.deckTitle.value.trim() || "生财有术mini航海原创PPT课件";
  $("#exportPageCount").textContent = `${total} 页`;
  $("#missingPagesList").textContent = missing.length
    ? `尚未完成：第 ${missing.join("、")} 页`
    : "";
}

function planState() {
  return {
    version: 5,
    product: "生财有术mini航海原创PPT课件",
    title: projectFields.deckTitle.value,
    globalPrompt: projectFields.globalPrompt.value,
    sourceScript: projectFields.scriptInput.value,
    pageStyleScript: projectFields.pageStyleInput.value,
    referenceMode: "composition",
    referencePages: referenceFields.pages.value,
    referenceInstruction: referenceFields.instruction.value,
  };
}

function saveDraft() {
  try {
    localStorage.setItem(draftStorageKey, JSON.stringify(planState()));
  } catch {
    // Local draft saving is optional.
  }
}

function slidesToScript(items) {
  return items
    .map((slide, index) => {
      const title = slide.title || slide.pageText?.split("\n")[0] || "";
      const text = slide.title ? slide.pageText || "" : slide.pageText?.split("\n").slice(1).join("\n") || "";
      return [
        `第${slide.pageNumber || index + 1}页`,
        `页面标题：${title}`,
        "页面文字：",
        text,
        slide.visualPrompt ? `画面提示词：\n${slide.visualPrompt}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function applyPlan(data) {
  projectFields.deckTitle.value = data.title || "生财有术mini航海原创PPT课件";
  projectFields.globalPrompt.value = data.globalPrompt || "";
  referenceFields.pages.value = data.referencePages || "";
  referenceFields.instruction.value = data.referenceInstruction || "";
  projectFields.pageStyleInput.value = data.pageStyleScript || "";
  refreshReferenceStatus();
  projectFields.scriptInput.value =
    data.sourceScript || (Array.isArray(data.slides) ? slidesToScript(data.slides) : "");
  if (projectFields.scriptInput.value.trim()) parseSource({ quiet: true });
  else renderSlides();
  applyPageStyleInstructions({ quiet: true });
  if (slides.length) maxStepUnlocked = Math.max(maxStepUnlocked, 4);
  updateWizardNavigation();
  saveDraft();
}

function exportPlan() {
  const blob = new Blob([JSON.stringify(planState(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectFields.deckTitle.value.trim() || "生财有术mini航海课件方案"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("方案已保存，不包含任何 API 配置和图片");
}

function formatArchiveTime(timestamp) {
  if (!timestamp) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function archiveActionButton(label, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function renderArchiveCard(summary) {
  const card = document.createElement("article");
  card.className = "archive-card";
  card.dataset.archiveId = summary.id;

  const cover = document.createElement("div");
  cover.className = "archive-cover";
  if (summary.coverDataUrl) {
    const image = document.createElement("img");
    image.src = summary.coverDataUrl;
    image.alt = `${summary.title || "课件"}封面预览`;
    image.loading = "lazy";
    cover.appendChild(image);
  } else {
    const placeholder = document.createElement("span");
    placeholder.textContent = "16:9";
    cover.appendChild(placeholder);
  }

  const body = document.createElement("div");
  body.className = "archive-card-body";
  const top = document.createElement("div");
  top.className = "archive-card-top";
  const title = document.createElement("h3");
  title.textContent = summary.title || "未命名课件";
  title.title = title.textContent;
  const state = document.createElement("span");
  state.className = `archive-state-pill${summary.complete ? "" : " partial"}`;
  state.textContent = summary.complete ? "完整课件" : "制作中";
  top.append(title, state);

  const meta = document.createElement("p");
  meta.className = "archive-meta";
  meta.textContent = `${summary.pageCount || 0} 页 · 已保存 ${summary.completedCount || 0} 页画面`;
  const updated = document.createElement("p");
  updated.className = "archive-updated";
  updated.textContent = `最近更新 ${formatArchiveTime(summary.updatedAt)}`;

  const actions = document.createElement("div");
  actions.className = "archive-card-actions";
  const restoreButton = archiveActionButton("恢复课件", "primary", async () => {
    await restoreArchiveProject(summary.id, restoreButton);
  });
  const downloadButton = archiveActionButton("重新下载 PPT", "ghost", async () => {
    await downloadArchivedPpt(summary.id, downloadButton);
  });
  downloadButton.disabled = !summary.complete;
  if (!summary.complete) downloadButton.title = "页面尚未全部生成，请先恢复课件继续制作";
  const deleteButton = archiveActionButton("删除", "text-button delete-archive-button", async () => {
    await removeArchivedProject(summary.id, summary.title);
  });
  actions.append(restoreButton, downloadButton, deleteButton);

  body.append(top, meta, updated, actions);
  card.append(cover, body);
  return card;
}

async function renderArchiveList() {
  const list = $("#archiveList");
  const status = $("#archiveListStatus");
  const empty = $("#archiveEmpty");
  status.hidden = false;
  status.textContent = "正在读取本机作品…";
  empty.hidden = true;
  list.innerHTML = "";
  try {
    const summaries = await listCoursewareArchives();
    $("#archiveTotalCount").textContent = `${summaries.length} 份`;
    $("#archiveCountBadge").textContent = String(summaries.length);
    $("#archiveCountBadge").hidden = summaries.length === 0;
    status.hidden = true;
    empty.hidden = summaries.length > 0;
    for (const summary of summaries) list.appendChild(renderArchiveCard(summary));
  } catch (error) {
    status.hidden = false;
    status.textContent = error.message || "本机作品读取失败。";
  }
}

async function openArchiveDialog() {
  $("#archiveDialog").showModal();
  await renderArchiveList();
}

function closeArchiveDialog() {
  $("#archiveDialog").close();
}

async function restoreArchiveProject(id, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在恢复…";
  try {
    const archive = await getCoursewareArchive(id);
    if (!archive) throw new Error("这份本机存档已经不存在。请刷新时光舱。 ");
    applyPlan(archive.plan || { slides: archive.slides });

    referenceImage = null;
    archiveReferenceBlobCache = null;
    if (archive.referenceImage?.imageBlob) {
      const dataUrl = await blobToDataUrl(archive.referenceImage.imageBlob);
      referenceImage = {
        dataUrl,
        name: archive.referenceImage.name || "reference-image",
        size: archive.referenceImage.size || archive.referenceImage.imageBlob.size,
      };
      archiveReferenceBlobCache = {
        source: dataUrl,
        blob: archive.referenceImage.imageBlob,
      };
    }
    renderReferenceImage();

    const savedSlides = new Map(
      (archive.slides || []).map((slide) => [Number(slide.pageNumber), slide]),
    );
    for (const slide of slides) {
      const saved = savedSlides.get(Number(slide.pageNumber));
      if (!saved) continue;
      slide.prompt = saved.prompt || "";
      slide.pageStylePrompt = saved.pageStylePrompt || slide.pageStylePrompt;
      slide.error = "";
      if (saved.imageBlob) {
        slide.imageDataUrl = await blobToDataUrl(saved.imageBlob);
        slide.status = "success";
        archiveImageBlobCache.set(slide, {
          source: slide.imageDataUrl,
          blob: saved.imageBlob,
        });
      } else {
        slide.imageDataUrl = "";
        slide.status = "idle";
      }
    }

    activeArchiveId = archive.id;
    activeArchiveCreatedAt = archive.createdAt || Date.now();
    sourceDirty = false;
    styleDirty = false;
    const complete = slides.length > 0 && slides.every((slide) => slide.imageDataUrl);
    maxStepUnlocked = Math.max(maxStepUnlocked, complete ? 5 : 4);
    renderSlides();
    saveDraft();
    closeArchiveDialog();
    goToStep(4, { unlock: true });
    toast(`已恢复“${projectFields.deckTitle.value.trim() || "未命名课件"}”`);
  } catch (error) {
    toast(error.message || "恢复课件失败。 ");
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function downloadArchivedPpt(id, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在合成…";
  try {
    const archive = await getCoursewareArchive(id);
    if (!archive) throw new Error("这份本机存档已经不存在。 ");
    const storedSlides = Array.isArray(archive.slides) ? archive.slides : [];
    if (!storedSlides.length || storedSlides.some((slide) => !slide.imageBlob)) {
      throw new Error("这份课件还有页面未完成，请先恢复课件继续生成。 ");
    }
    const imageDataUrls = [];
    for (const slide of storedSlides) imageDataUrls.push(await blobToDataUrl(slide.imageBlob));
    const title = archive.plan?.title || "生财有术mini航海原创PPT课件";
    await downloadPptxFile(title, imageDataUrls);
    toast(`已从时光舱重新导出 ${storedSlides.length} 页 PPT`);
  } catch (error) {
    toast(error.message || "重新下载失败。 ");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function removeArchivedProject(id, title) {
  const confirmed = window.confirm(
    `确定从这台电脑删除“${title || "未命名课件"}”吗？删除后无法从时光舱恢复。`,
  );
  if (!confirmed) return;
  try {
    await deleteCoursewareArchive(id);
    if (activeArchiveId === id) branchFromArchivedProject();
    await renderArchiveList();
    toast("这份课件已从时光舱删除");
  } catch (error) {
    toast(error.message || "删除存档失败。 ");
  }
}

async function boot() {
  try {
    const savedSettings = JSON.parse(localStorage.getItem(settingsStorageKey) || "null");
    if (savedSettings) {
      applyApiSettings(savedSettings);
      lastApiEndpoint = savedSettings.endpoint || "";
      const savedConnectionStatus = normalizeStoredConnectionStatus(
        savedSettings.connectionStatus,
      );
      connectionVerified = savedConnectionStatus === "verified";
      connectionReachable = ["verified", "reachable"].includes(savedConnectionStatus);
      connectionConfigured = Boolean(savedSettings.endpoint);
      const sanitized = applyProviderSafety({
        previousEndpoint: "",
        ownerOrigin: savedSettings.providerOrigin || "",
      });
      if (sanitized.cleared.length) persistApiSettings();
    }
  } catch {
    // Ignore invalid settings.
  }

  try {
    const { body: config } = await apiRequest("/api/config");
    mockMode = Boolean(config.mockMode);
    systemProxyDetected = Boolean(config.proxyDetected);
    systemProxyLabel = String(config.proxyLabel || "");
    if (!apiFields.endpoint.value) apiFields.endpoint.value = config.endpoint || "";
    if (!apiFields.editEndpoint.value) apiFields.editEndpoint.value = config.editEndpoint || "";
    if (!apiFields.model.value) apiFields.model.value = config.model || "";
    if (!apiFields.size.value) apiFields.size.value = config.size || "2048x1152";
    if (!apiFields.quality.value) apiFields.quality.value = config.quality || "high";
    refreshProxyStatus();
    setConnectionState(
      mockMode
        ? "verified"
        : connectionVerified
          ? "verified"
          : connectionReachable
            ? "reachable"
            : connectionConfigured
              ? "configured"
            : apiFields.endpoint.value
              ? "warning"
              : "",
      mockMode
        ? "模拟接口已连接"
        : connectionVerified
          ? "API 已连接"
          : connectionReachable
            ? "API 可访问"
            : connectionConfigured
              ? "API 已配置"
            : apiFields.endpoint.value
              ? "API 待检测"
              : "API 未配置",
    );
  } catch {
    setConnectionState("error", "本地服务异常");
  }

  try {
    const savedDraft = JSON.parse(localStorage.getItem(draftStorageKey) || "null");
    if (savedDraft) applyPlan(savedDraft);
    else renderSlides();
  } catch {
    renderSlides();
  }
  maxStepUnlocked = slides.length ? 4 : 1;
  currentStep = 1;
  updateWizardNavigation();
  await updateArchiveCountBadge();
}

$("#apiSettingsButton").addEventListener("click", () => {
  if (document.body.dataset.activeWorkspace === "notes") {
    window.dispatchEvent(new CustomEvent("open-note-api-settings"));
    return;
  }
  openApiDialog();
});
$("#closeApiDialog").addEventListener("click", closeApiDialog);
$("#toggleApiKey").addEventListener("click", toggleApiKeyVisibility);
$("#saveApiSettingsButton").addEventListener("click", saveApiSettings);
$("#clearApiSettingsButton").addEventListener("click", clearApiSettings);
$("#testConnectionButton").addEventListener("click", testConnection);
apiFields.provider.addEventListener("change", () => {
  applyImageProviderPreset(apiFields.provider.value);
});
$("#seedreamModelPreset").addEventListener("change", (event) => {
  const custom = $("#seedreamCustomModel");
  custom.hidden = event.target.value !== "custom";
  if (event.target.value !== "custom") {
    apiFields.model.value = event.target.value;
    custom.value = "";
  } else {
    custom.focus();
  }
  connectionVerified = false;
  connectionReachable = false;
  setConnectionState("warning", "API 待检测");
});
$("#seedreamCustomModel").addEventListener("input", (event) => {
  apiFields.model.value = event.target.value.trim();
  connectionVerified = false;
  connectionReachable = false;
});
apiFields.endpoint.addEventListener("input", () => {
  apiFields.provider.value = imageProviderMode(apiFields.endpoint.value);
  refreshApiProviderGuidance();
});
$("#archiveButton").addEventListener("click", openArchiveDialog);
$("#closeArchiveDialog").addEventListener("click", closeArchiveDialog);
$("#archiveCloseButton").addEventListener("click", closeArchiveDialog);
$("#parseButton").addEventListener("click", () => parseSource());
$("#exampleButton").addEventListener("click", fillExample);
$("#clearButton").addEventListener("click", clearProject);
$("#parseStyleButton").addEventListener("click", () => applyPageStyleInstructions());
$("#styleExampleButton").addEventListener("click", fillStyleExample);
$("#clearStyleButton").addEventListener("click", clearPageStyles);
$("#generateAllButton").addEventListener("click", generateAll);
const generationConcurrency = $("#generationConcurrency");
if (generationConcurrency) {
  generationConcurrency.value = String(
    normalizeGenerationConcurrency(localStorage.getItem(concurrencyStorageKey)),
  );
  generationConcurrency.addEventListener("change", () => {
    const concurrency = normalizeGenerationConcurrency(generationConcurrency.value);
    generationConcurrency.value = String(concurrency);
    localStorage.setItem(concurrencyStorageKey, String(concurrency));
    toast(`已切换为同时生成 ${concurrency} 张`);
  });
}
$("#exportPptButton").addEventListener("click", exportPpt);
$("#backToGenerationButton").addEventListener("click", () => goToStep(4));
$("#previousStepButton").addEventListener("click", () => goToStep(currentStep - 1));
$("#nextStepButton").addEventListener("click", nextStep);
$("#saveDraftButton").addEventListener("click", () => {
  saveDraft();
  toast("当前草稿已保存在这台电脑");
});
document.querySelectorAll(".step-tab").forEach((button) => {
  button.addEventListener("click", () => goToStep(Number(button.dataset.step)));
});
$("#exportPlanButton").addEventListener("click", exportPlan);
$("#importButton").addEventListener("click", () => $("#importInput").click());
$("#importInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    applyPlan(JSON.parse(await file.text()));
    toast("方案导入完成");
  } catch {
    toast("方案文件格式无效");
  }
  event.target.value = "";
});

referenceFields.uploadButton.addEventListener("click", () => referenceFields.input.click());
$("#replaceReferenceButton").addEventListener("click", () => referenceFields.input.click());
$("#removeReferenceButton").addEventListener("click", clearReferenceImage);
referenceFields.input.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await loadReferenceImage(file);
  } catch (error) {
    toast(error.message);
  }
  event.target.value = "";
});
for (const eventName of ["dragenter", "dragover"]) {
  referenceFields.uploader.addEventListener(eventName, (event) => {
    event.preventDefault();
    referenceFields.uploader.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  referenceFields.uploader.addEventListener(eventName, (event) => {
    event.preventDefault();
    referenceFields.uploader.classList.remove("dragging");
  });
}
referenceFields.uploader.addEventListener("drop", async (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    await loadReferenceImage(file);
  } catch (error) {
    toast(error.message);
  }
});

$("#apiDialog").addEventListener("click", (event) => {
  if (event.target === $("#apiDialog")) closeApiDialog();
});
$("#apiDialog").addEventListener("close", resetApiKeyVisibility);
$("#archiveDialog").addEventListener("click", (event) => {
  if (event.target === $("#archiveDialog")) closeArchiveDialog();
});
projectFields.scriptInput.addEventListener("input", markSourceDirty);
projectFields.pageStyleInput.addEventListener("input", markStyleDirty);
projectFields.deckTitle.addEventListener("input", () => {
  saveDraft();
  renderExportSummary();
});
projectFields.globalPrompt.addEventListener("change", () => {
  branchFromArchivedProject();
  saveDraft();
});
referenceFields.pages.addEventListener("input", refreshReferenceStatus);
referenceFields.pages.addEventListener("change", () => {
  branchFromArchivedProject();
  if (referenceImage) invalidateGeneratedSlides("参考图应用页码已修改，请重新生成相关画面");
  saveDraft();
});
referenceFields.instruction.addEventListener("change", () => {
  branchFromArchivedProject();
  if (referenceImage) invalidateGeneratedSlides("参考要求已修改，请重新生成相关画面");
  saveDraft();
});

for (const field of Object.values(apiFields)) {
  const eventName = field.tagName === "SELECT" ? "change" : "input";
  field.addEventListener(eventName, () => {
    if (field === apiFields.endpoint) refreshApiProviderGuidance();
    if (field === apiFields.endpoint || field === apiFields.proxyUrl) {
      useSystemProxyForWukong = false;
    }
    connectionVerified = false;
    connectionReachable = false;
    connectionConfigured = false;
    setTestResult("neutral", "参数已修改，请重新检测连接");
    setConnectionState(
      apiFields.endpoint.value.trim() ? "warning" : "",
      apiFields.endpoint.value.trim() ? "API 待检测" : "API 未配置",
    );
  });
}
apiFields.endpoint.addEventListener("change", () => {
  applyProviderSafety({ previousEndpoint: lastApiEndpoint, notify: true });
  refreshApiProviderGuidance();
});

boot();
