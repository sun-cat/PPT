import {
  affineFromTriangles,
  computeCollageLayout,
  computeImageFitRect,
  computeShowcaseCollageLayout,
  computePerspectiveRasterSize,
  computeUnitSquareHomography,
  estimateQuadAspect,
  expandTriangleForOverlap,
  parseFeaturedPageNumbers,
  projectUnitPoint,
  resolvePerspectiveRasterAspect,
  validatePerspectiveQuad,
} from "/image-tool-math.js?v=20260818-perspective-full-migration1";
import { createStoredZip } from "/zip-store.js?v=20260810-batch-export";
import {
  MAX_SCENE_TEMPLATES,
  deleteSceneTemplate,
  getSceneTemplate,
  listSceneTemplateSummaries,
  renameSceneTemplate,
  saveSceneTemplate,
} from "/scene-template-store.js?v=20260812-scene-template-library-v1";

const MAX_REPLACEMENT_IMAGES = 18;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function showToolToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToolToast.timer);
  showToolToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3000);
}

function setStatus(element, state, message) {
  element.className = `tool-status${state ? ` ${state}` : ""}`;
  element.textContent = message;
}

function setBusy(button, busy, busyText, normalText) {
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
  button.textContent = busy ? busyText : normalText;
  button.setAttribute("aria-busy", String(busy));
}

function renderWorkspaceConnection(target) {
  const element = $("#connectionState");
  const labelElement = $("span", element);
  let state = "";
  let label = "本地处理";
  let description = "当前工具只在本机处理，不调用 AI 接口";
  if (target === "courseware") {
    state = element.dataset.imageState || "";
    label = element.dataset.imageLabel || "图片 API 未配置";
    description = element.dataset.imageDescription || label;
  } else if (target === "notes") {
    state = element.dataset.textState || "";
    label = element.dataset.textLabel || "文字 API 未配置";
    description = element.dataset.textDescription || label;
  }
  element.className = `connection-state ${state}`.trim();
  labelElement.textContent = label;
  element.title = description;
  element.setAttribute("aria-label", description);
  $("#apiSettingsButton").textContent = target === "notes" ? "文字接口" : "接口设置";
}

function switchWorkspace(name, { updateHash = true } = {}) {
  const target = ["courseware", "notes", "collage", "perspective"].includes(name)
    ? name
    : "courseware";
  $$('[data-workspace-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.workspacePanel !== target;
  });
  $$(".workspace-tab").forEach((button) => {
    const active = button.dataset.workspace === target;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  $(".topbar").classList.toggle("tool-mode", ["collage", "perspective"].includes(target));
  $(".topbar").classList.toggle("notes-mode", target === "notes");
  document.body.classList.toggle("tool-workspace-active", target !== "courseware");
  document.body.dataset.activeWorkspace = target;
  renderWorkspaceConnection(target);
  if (updateHash) {
    const hash = target === "courseware" ? "" : `#${target}`;
    history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
  }
  window.dispatchEvent(new CustomEvent("workspacechange", { detail: { workspace: target } }));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$$(".workspace-tab").forEach((button) => {
  button.addEventListener("click", () => switchWorkspace(button.dataset.workspace));
});

window.addEventListener("hashchange", () => {
  switchWorkspace(location.hash.replace(/^#/, ""), { updateHash: false });
});

const collageState = {
  file: null,
  pages: [],
  rendered: false,
  activeTemplate: "classic",
  heroValues: { classic: "", showcase: "" },
};

const collage = {
  fileInput: $("#collagePptInput"),
  fileButton: $("#collagePptButton"),
  fileName: $("#collageFileName"),
  pageRange: $("#collagePageRange"),
  extractButton: $("#extractPptButton"),
  status: $("#collageExtractStatus"),
  templateInputs: $$("input[name='collageTemplate']"),
  heroPages: $("#collageHeroPages"),
  heroLabel: $("#collageHeroLabel"),
  heroHelp: $("#collageHeroHelp"),
  background: $("#collageBackgroundColor"),
  colorValue: $("#collageColorValue"),
  renderButton: $("#renderCollageButton"),
  canvas: $("#collageCanvas"),
  empty: $("#collageCanvasEmpty"),
  thumbs: $("#collageThumbs"),
  pngButton: $("#downloadCollagePng"),
  jpgButton: $("#downloadCollageJpg"),
};

function normalizePageRangeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/[，、；;]/g, ",")
    .replace(/[—~至]/g, "-")
    .replace(/\s+/g, "");
}

function getCollageTemplate() {
  return collage.templateInputs.find((input) => input.checked)?.value || "classic";
}

function collageTemplateName(template = getCollageTemplate()) {
  return template === "showcase" ? "主图＋课件矩阵" : "重点三图";
}

function collageTemplateMinimum(template = getCollageTemplate()) {
  return template === "showcase" ? 1 : 3;
}

function defaultHeroValue(template = getCollageTemplate()) {
  const count = template === "showcase" ? 1 : 3;
  return collageState.pages.slice(0, count).map((page) => page.pageNumber).join(",");
}

function updateCollageTemplateUi({ render = true } = {}) {
  const previous = collageState.activeTemplate;
  collageState.heroValues[previous] = collage.heroPages.value;
  const template = getCollageTemplate();
  collageState.activeTemplate = template;
  if (template === "showcase") {
    collage.heroLabel.textContent = "顶部主视觉页码";
    collage.heroPages.placeholder = "例如 1";
    collage.heroHelp.textContent = "填写 1 个已提取页码；其余页面按顺序最多展示 12 张。";
  } else {
    collage.heroLabel.textContent = "重点大图页码";
    collage.heroPages.placeholder = "例如 1,2,3";
    collage.heroHelp.textContent = "填写 3 个已提取页码；其余页面自动放到左侧缩略图区。";
  }
  collage.heroPages.value = collageState.heroValues[template] || defaultHeroValue(template);
  collage.renderButton.disabled = collageState.pages.length < collageTemplateMinimum(template);
  if (render && collageState.pages.length >= collageTemplateMinimum(template)) {
    renderCollage().catch((error) => setStatus(collage.status, "error", error.message));
  }
}

function selectCollageFile(file) {
  collageState.pages = [];
  collageState.rendered = false;
  collage.thumbs.innerHTML = "";
  collage.empty.hidden = false;
  collage.renderButton.disabled = true;
  collage.pngButton.disabled = true;
  collage.jpgButton.disabled = true;
  if (!file) {
    collageState.file = null;
    collage.fileName.textContent = "尚未选择文件 · 最大 180 MB";
    collage.extractButton.disabled = true;
    setStatus(collage.status, "", "等待上传 PPTX。");
    return;
  }
  if (!/\.pptx$/i.test(file.name)) {
    collage.fileInput.value = "";
    selectCollageFile(null);
    setStatus(collage.status, "error", "请选择 .pptx 文件；旧版 .ppt 请先另存为 .pptx。");
    return;
  }
  if (file.size > 180 * 1024 * 1024) {
    collage.fileInput.value = "";
    selectCollageFile(null);
    setStatus(collage.status, "error", "PPTX 文件超过 180 MB，请压缩后再上传。");
    return;
  }
  collageState.file = file;
  collage.fileName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  collage.extractButton.disabled = false;
  setStatus(collage.status, "success", "文件已选择，可以提取页面。");
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败，文件可能已损坏。"));
    image.src = source;
  });
}

function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawRoundedImage(context, image, x, y, width, height, radius = 16) {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;
  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }
  context.save();
  roundedRectPath(context, x, y, width, height, radius);
  context.clip();
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
  context.restore();
}

function parseHeroPageNumbers(template = getCollageTemplate()) {
  return parseFeaturedPageNumbers(
    collage.heroPages.value,
    template,
    collageState.pages.map((page) => page.pageNumber),
  );
}

function renderCollageThumbs(heroNumbers = [], template = getCollageTemplate()) {
  const heroSet = new Set(heroNumbers);
  collage.thumbs.innerHTML = "";
  for (const page of collageState.pages) {
    const card = document.createElement("article");
    card.className = `extracted-page-card${heroSet.has(page.pageNumber) ? " hero" : ""}`;
    const image = document.createElement("img");
    image.src = page.dataUrl;
    image.alt = `PPT 第 ${page.pageNumber} 页`;
    image.loading = "lazy";
    const label = document.createElement("span");
    const featuredText = template === "showcase" ? "顶部主视觉" : "重点大图";
    label.innerHTML = `第 ${page.pageNumber} 页${heroSet.has(page.pageNumber) ? `<b>${featuredText}</b>` : ""}`;
    card.append(image, label);
    collage.thumbs.append(card);
  }
}

async function renderCollage() {
  const template = getCollageTemplate();
  const minimum = collageTemplateMinimum(template);
  if (collageState.pages.length < minimum) {
    throw new Error(`至少需要提取 ${minimum} 页才能生成“${collageTemplateName(template)}”版式。`);
  }
  const heroNumbers = parseHeroPageNumbers(template);
  const pageMap = new Map(collageState.pages.map((page) => [page.pageNumber, page]));
  const heroes = heroNumbers.map((number) => pageMap.get(number));
  const smallPages = collageState.pages
    .filter((page) => !heroNumbers.includes(page.pageNumber))
    .slice(0, template === "showcase" ? 12 : 11);
  const allPages = [...heroes, ...smallPages];
  await Promise.all(
    allPages.map(async (page) => {
      if (!page.image) page.image = await loadImage(page.dataUrl);
    }),
  );

  const canvas = collage.canvas;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = collage.background.value;
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (template === "showcase") {
    const layout = computeShowcaseCollageLayout(canvas.width, canvas.height, smallPages.length);
    drawRoundedImage(
      context,
      heroes[0].image,
      layout.heroX,
      layout.heroY,
      layout.heroWidth,
      layout.heroHeight,
      2,
    );
    smallPages.forEach((page, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      drawRoundedImage(
        context,
        page.image,
        layout.outer + column * (layout.tileWidth + layout.columnGap),
        layout.gridTop + row * (layout.tileHeight + layout.rowGap),
        layout.tileWidth,
        layout.tileHeight,
        2,
      );
    });
  } else {
    const layout = computeCollageLayout(canvas.width, canvas.height, smallPages.length);
    heroes.forEach((page, index) => {
      drawRoundedImage(
        context,
        page.image,
        layout.rightX,
        layout.heroTop + index * (layout.heroHeight + layout.gap),
        layout.rightWidth,
        layout.heroHeight,
        2,
      );
    });
    smallPages.forEach((page, index) => {
      drawRoundedImage(
        context,
        page.image,
        layout.outer,
        layout.thumbTop + index * (layout.thumbHeight + layout.thumbGap),
        layout.leftWidth,
        layout.thumbHeight,
        2,
      );
    });
  }

  collageState.rendered = true;
  collage.empty.hidden = true;
  collage.pngButton.disabled = false;
  collage.jpgButton.disabled = false;
  renderCollageThumbs(heroNumbers, template);
  setStatus(
    collage.status,
    "success",
    template === "showcase"
      ? `拼图已生成：顶部 1 张主视觉，下方 ${smallPages.length} 张课件页。`
      : `拼图已生成：右侧 3 张重点大图，左侧 ${smallPages.length} 张缩略图。`,
  );
}

async function extractPptPages() {
  if (!collageState.file) return;
  setBusy(collage.extractButton, true, "正在提取…", "提取 PPT 页面");
  setStatus(
    collage.status,
    "working",
    "正在读取完整页面；可编辑 PPT 会自动调用本机 PowerPoint 渲染，请稍候…",
  );
  try {
    const response = await fetch("/api/extract-ppt-images", {
      method: "POST",
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "x-file-name": encodeURIComponent(collageState.file.name),
        "x-page-range": normalizePageRangeHeader(collage.pageRange.value),
      },
      body: collageState.file,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `提取失败（HTTP ${response.status}）。`);
    collageState.pages = body.pages || [];
    collageState.rendered = false;
    collageState.heroValues.classic = collageState.pages.slice(0, 3).map((page) => page.pageNumber).join(",");
    collageState.heroValues.showcase = collageState.pages[0]?.pageNumber ? String(collageState.pages[0].pageNumber) : "";
    collage.heroPages.value = collageState.heroValues[getCollageTemplate()];
    collage.renderButton.disabled = collageState.pages.length < collageTemplateMinimum();
    renderCollageThumbs();
    const missingText = body.missingPages?.length
      ? `；第 ${body.missingPages.join("、")} 页渲染失败，已跳过`
      : "";
    const methodText =
      body.extractionMode === "rendered"
        ? "已用本机 PowerPoint 渲染"
        : "已快速读取";
    if (collageState.pages.length >= collageTemplateMinimum()) await renderCollage();
    const collageText =
      collageState.pages.length >= collageTemplateMinimum()
        ? `；已生成“${collageTemplateName()}”商品主图`
        : "";
    setStatus(
      collage.status,
      "success",
      `PPTX 共 ${body.totalPages} 页，${methodText} ${collageState.pages.length} 页${missingText}${collageText}。`,
    );
  } catch (error) {
    collageState.pages = [];
    collage.renderButton.disabled = true;
    renderCollageThumbs();
    setStatus(collage.status, "error", error.message);
  } finally {
    setBusy(collage.extractButton, false, "正在提取…", "提取 PPT 页面");
    collage.extractButton.disabled = !collageState.file;
  }
}

function downloadCanvas(canvas, mimeType, filename, quality = 0.94) {
  canvas.toBlob(
    (blob) => {
      if (!blob) {
        showToolToast("导出失败，请换一个浏览器后重试。");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    mimeType,
    quality,
  );
}

function canvasToBlob(canvas, mimeType, quality = 0.94) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("浏览器未能生成图片文件。")),
      mimeType,
      quality,
    );
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

collage.fileButton.addEventListener("click", () => collage.fileInput.click());
collage.fileInput.addEventListener("change", (event) => selectCollageFile(event.target.files?.[0]));
collage.extractButton.addEventListener("click", extractPptPages);
collage.renderButton.addEventListener("click", async () => {
  try {
    await renderCollage();
  } catch (error) {
    setStatus(collage.status, "error", error.message);
  }
});
collage.templateInputs.forEach((input) => {
  input.addEventListener("change", () => updateCollageTemplateUi());
});
collage.background.addEventListener("input", () => {
  collage.colorValue.textContent = collage.background.value.toUpperCase();
  if (collageState.rendered) renderCollage().catch(() => {});
});
collage.heroPages.addEventListener("change", () => {
  collageState.heroValues[getCollageTemplate()] = collage.heroPages.value;
  if (collageState.pages.length >= collageTemplateMinimum()) renderCollage().catch((error) => setStatus(collage.status, "error", error.message));
});
collage.pngButton.addEventListener("click", () =>
  downloadCanvas(collage.canvas, "image/png", `商品主图-${collageTemplateName()}.png`),
);
collage.jpgButton.addEventListener("click", () =>
  downloadCanvas(collage.canvas, "image/jpeg", `商品主图-${collageTemplateName()}.jpg`, 0.94),
);

const perspectiveState = {
  backgroundFile: null,
  backgroundImage: null,
  replacementFile: null,
  replacementImage: null,
  replacements: [],
  replacementIndex: -1,
  points: [],
  history: [],
  dragIndex: -1,
  dragHistorySaved: false,
  animationFrame: 0,
  exporting: false,
  activeTemplateId: null,
  templateSummaries: [],
  templateObjectUrls: [],
  templateBusy: false,
  renameTemplateId: null,
};

const perspective = {
  sceneInput: $("#sceneImageInput"),
  sceneButton: $("#sceneImageButton"),
  sceneName: $("#sceneFileName"),
  templateName: $("#sceneTemplateName"),
  templateSaveButton: $("#saveSceneTemplateButton"),
  templateList: $("#sceneTemplateList"),
  templateCount: $("#sceneTemplateCount"),
  templateHint: $("#sceneTemplateHint"),
  replacementInput: $("#replacementImageInput"),
  replacementButton: $("#replacementImageButton"),
  replacementName: $("#replacementFileName"),
  replacementQueue: $("#replacementQueue"),
  replacementQueueCount: $("#replacementQueueCount"),
  replacementThumbs: $("#replacementThumbs"),
  previousReplacementButton: $("#previousReplacementButton"),
  nextReplacementButton: $("#nextReplacementButton"),
  undoButton: $("#undoPerspectiveButton"),
  resetButton: $("#resetPointsButton"),
  fitMode: $("#perspectiveFitMode"),
  matteColor: $("#perspectiveMatteColor"),
  opacity: $("#perspectiveOpacity"),
  opacityValue: $("#perspectiveOpacityValue"),
  brightness: $("#perspectiveBrightness"),
  brightnessValue: $("#perspectiveBrightnessValue"),
  feather: $("#perspectiveFeather"),
  featherValue: $("#perspectiveFeatherValue"),
  status: $("#perspectiveStatus"),
  pngButton: $("#exportPerspectivePng"),
  jpgButton: $("#exportPerspectiveJpg"),
  restartButton: $("#restartPerspectiveButton"),
  canvas: $("#perspectiveCanvas"),
  stage: $("#perspectiveCanvasStage"),
  empty: $("#perspectiveCanvasEmpty"),
  resolution: $("#perspectiveResolution"),
  steps: $("#perspectiveSteps"),
};

function perspectiveOptions() {
  return {
    fitMode: perspective.fitMode.value,
    fitModeVersion: 3,
    matteColor: perspective.matteColor.value,
    opacity: Number(perspective.opacity.value) / 100,
    brightness: Number(perspective.brightness.value) / 100,
    feather: Number(perspective.feather.value),
  };
}

function updatePerspectiveSteps() {
  let active = 1;
  if (perspectiveState.backgroundImage) active = 2;
  if (perspectiveState.replacementImage) active = 3;
  if (perspectiveState.points.length === 4) active = 4;
  $$('li', perspective.steps).forEach((item, index) => {
    item.classList.toggle("active", index + 1 === active);
  });
}

function updatePerspectiveControls() {
  const complete = perspectiveState.points.length === 4 &&
    validatePerspectiveQuad(perspectiveState.points).valid;
  const count = perspectiveState.replacements.length;
  perspective.undoButton.disabled = perspectiveState.history.length === 0;
  perspective.resetButton.disabled = perspectiveState.points.length === 0;
  perspective.pngButton.disabled = perspectiveState.exporting || !complete || !count;
  perspective.jpgButton.disabled = perspectiveState.exporting || !complete || !count;
  perspective.pngButton.setAttribute("aria-busy", String(perspectiveState.exporting));
  perspective.jpgButton.setAttribute("aria-busy", String(perspectiveState.exporting));
  const templateName = perspective.templateName.value.trim();
  perspective.templateSaveButton.disabled = perspectiveState.templateBusy || !complete || !templateName;
  perspective.templateSaveButton.setAttribute("aria-busy", String(perspectiveState.templateBusy));
  perspective.templateSaveButton.textContent = perspectiveState.templateBusy
    ? "正在保存…"
    : perspectiveState.activeTemplateId
      ? "更新当前场景"
      : "保存当前场景";
  if (perspectiveState.exporting) {
    perspective.pngButton.textContent = count > 1 ? "正在批量导出…" : "正在导出…";
    perspective.jpgButton.textContent = count > 1 ? "正在批量导出…" : "正在导出…";
  } else {
    perspective.pngButton.textContent = count > 1 ? `批量导出 PNG（${count} 张）` : "导出 PNG";
    perspective.jpgButton.textContent = count > 1 ? `批量导出 JPG（${count} 张）` : "导出 JPG";
  }
  updatePerspectiveSteps();
}

function cleanSceneTemplateName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 30);
}

function defaultSceneTemplateName(file) {
  return cleanSceneTemplateName(String(file?.name || "常用场景").replace(/\.[^.]+$/, ""));
}

function createSceneTemplateId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `scene-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clearSceneTemplateObjectUrls() {
  perspectiveState.templateObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  perspectiveState.templateObjectUrls = [];
}

function setSceneTemplateHint(message, state = "") {
  perspective.templateHint.textContent = message;
  perspective.templateHint.className = `scene-template-hint${state ? ` ${state}` : ""}`;
}

function renderSceneTemplates() {
  clearSceneTemplateObjectUrls();
  perspective.templateList.innerHTML = "";
  perspective.templateCount.textContent = `${perspectiveState.templateSummaries.length} / ${MAX_SCENE_TEMPLATES}`;
  if (!perspectiveState.templateSummaries.length) {
    const empty = document.createElement("div");
    empty.className = "scene-template-empty";
    empty.textContent = "还没有常用场景，完成一次四点定位后保存即可。";
    perspective.templateList.append(empty);
    return;
  }

  for (const summary of perspectiveState.templateSummaries) {
    const card = document.createElement("article");
    card.className = `scene-template-card${summary.id === perspectiveState.activeTemplateId ? " active" : ""}`;
    card.dataset.templateId = summary.id;

    const thumb = document.createElement("div");
    thumb.className = "scene-template-thumb";
    const image = document.createElement("img");
    const objectUrl = URL.createObjectURL(summary.thumbnailBlob);
    perspectiveState.templateObjectUrls.push(objectUrl);
    image.src = objectUrl;
    image.alt = `${summary.name}场景缩略图`;
    thumb.append(image);

    const body = document.createElement("div");
    body.className = "scene-template-card-body";
    const copy = document.createElement("div");
    copy.className = "scene-template-card-copy";
    if (summary.id === perspectiveState.renameTemplateId) {
      const renameInput = document.createElement("input");
      renameInput.className = "scene-template-rename-input";
      renameInput.type = "text";
      renameInput.maxLength = 30;
      renameInput.value = summary.name;
      renameInput.setAttribute("aria-label", "重命名常用场景");
      copy.append(renameInput);
    } else {
      const name = document.createElement("strong");
      name.textContent = summary.name;
      copy.append(name);
    }
    const meta = document.createElement("small");
    meta.textContent = `${summary.width} × ${summary.height} · 已保存四点定位`;
    copy.append(meta);

    const actions = document.createElement("div");
    actions.className = "scene-template-card-actions";
    const actionItems = summary.id === perspectiveState.renameTemplateId
      ? [["save-rename", "保存名称", "use"], ["cancel-rename", "取消", "rename"]]
      : [["use", "使用", "use"], ["rename", "重命名", "rename"], ["delete", "删除", "delete"]];
    for (const [action, label, className] of actionItems) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.templateAction = action;
      button.className = className;
      button.textContent = label;
      actions.append(button);
    }
    body.append(copy, actions);
    card.append(thumb, body);
    perspective.templateList.append(card);
  }
  const renameInput = perspective.templateList.querySelector(".scene-template-rename-input");
  if (renameInput) {
    renameInput.focus();
    renameInput.select();
  }
}

async function refreshSceneTemplates() {
  try {
    perspectiveState.templateSummaries = await listSceneTemplateSummaries();
    renderSceneTemplates();
  } catch (error) {
    perspectiveState.templateSummaries = [];
    perspective.templateCount.textContent = `0 / ${MAX_SCENE_TEMPLATES}`;
    perspective.templateList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "scene-template-empty error";
    empty.textContent = error.message;
    perspective.templateList.append(empty);
  }
}

async function createSceneTemplateThumbnail(image) {
  const maxWidth = 360;
  const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, "image/jpeg", 0.78);
}

function applySceneTemplateOptions(options = {}) {
  const requestedMode = ["warp", "contain", "cover"].includes(options.fitMode)
    ? options.fitMode
    : "warp";
  const legacyFitMigrated = Number(options.fitModeVersion || 0) < 3 && requestedMode !== "warp";
  perspective.fitMode.value = legacyFitMigrated ? "warp" : requestedMode;
  perspective.matteColor.value = /^#[0-9a-f]{6}$/i.test(options.matteColor || "")
    ? options.matteColor
    : "#000000";
  perspective.opacity.value = String(Math.round(Math.max(0, Math.min(1, Number(options.opacity ?? 1))) * 100));
  perspective.brightness.value = String(Math.round(Math.max(0.5, Math.min(1.5, Number(options.brightness ?? 1))) * 100));
  perspective.feather.value = String(Math.round(Math.max(0, Math.min(10, Number(options.feather ?? 0)))));
  perspective.opacityValue.textContent = `${perspective.opacity.value}%`;
  perspective.brightnessValue.textContent = `${perspective.brightness.value}%`;
  perspective.featherValue.textContent = `${perspective.feather.value} px`;
  const colorOutput = perspective.matteColor.closest(".color-field")?.querySelector("output");
  if (colorOutput) colorOutput.textContent = perspective.matteColor.value.toUpperCase();
  return legacyFitMigrated;
}

async function saveCurrentSceneTemplate() {
  if (perspectiveState.templateBusy) return;
  const validation = validatePerspectiveQuad(perspectiveState.points);
  const name = cleanSceneTemplateName(perspective.templateName.value);
  if (!perspectiveState.backgroundFile || !perspectiveState.backgroundImage || !validation.valid) {
    setStatus(perspective.status, "error", "请先上传场景图并完成四点定位，再保存常用场景。");
    return;
  }
  if (!name) {
    setSceneTemplateHint("请先填写一个容易识别的场景名称。", "error");
    perspective.templateName.focus();
    return;
  }
  if (!perspectiveState.activeTemplateId && perspectiveState.templateSummaries.length >= MAX_SCENE_TEMPLATES) {
    setSceneTemplateHint(`最多保存 ${MAX_SCENE_TEMPLATES} 个常用场景，请先删除不用的模板。`, "error");
    return;
  }

  perspectiveState.templateBusy = true;
  updatePerspectiveControls();
  try {
    const id = perspectiveState.activeTemplateId || createSceneTemplateId();
    const previous = perspectiveState.templateSummaries.find((item) => item.id === id);
    const now = Date.now();
    const thumbnailBlob = await createSceneTemplateThumbnail(perspectiveState.backgroundImage);
    const imageBlob = perspectiveState.backgroundFile.slice(
      0,
      perspectiveState.backgroundFile.size,
      perspectiveState.backgroundFile.type,
    );
    const common = {
      id,
      name,
      fileName: perspectiveState.backgroundFile.name || `${name}.jpg`,
      mimeType: perspectiveState.backgroundFile.type || imageBlob.type || "image/jpeg",
      width: perspectiveState.backgroundImage.naturalWidth,
      height: perspectiveState.backgroundImage.naturalHeight,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    await saveSceneTemplate(
      {
        ...common,
        imageBlob,
        points: perspectiveState.points.map((point) => ({ x: point.x, y: point.y })),
        options: perspectiveOptions(),
      },
      { ...common, thumbnailBlob },
    );
    perspectiveState.activeTemplateId = id;
    await refreshSceneTemplates();
    setSceneTemplateHint("已保存。下次打开工具可直接点击“使用”。", "success");
    setStatus(perspective.status, "success", `常用场景“${name}”已保存在当前浏览器。`);
  } catch (error) {
    const message = error?.name === "QuotaExceededError"
      ? "浏览器本地存储空间不足，请删除不用的常用场景后重试。"
      : `保存失败：${error.message}`;
    setSceneTemplateHint(message, "error");
  } finally {
    perspectiveState.templateBusy = false;
    updatePerspectiveControls();
  }
}

async function useSceneTemplate(id) {
  if (perspectiveState.templateBusy) return;
  perspectiveState.templateBusy = true;
  updatePerspectiveControls();
  setStatus(perspective.status, "working", "正在恢复常用场景和四点定位…");
  try {
    const template = await getSceneTemplate(id);
    if (!template) throw new Error("这个常用场景已不存在，请刷新后重试。");
    const file = new File(
      [template.imageBlob],
      template.fileName || `${template.name}.jpg`,
      { type: template.mimeType || template.imageBlob.type || "image/jpeg", lastModified: template.updatedAt },
    );
    const image = await imageFromFile(file, "常用场景图");
    const points = Array.isArray(template.points)
      ? template.points.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
      : [];
    if (!validatePerspectiveQuad(points).valid) throw new Error("这个模板的四点定位数据已损坏，请删除后重新保存。");
    perspectiveState.backgroundFile = file;
    perspectiveState.backgroundImage = image;
    perspectiveState.points = points;
    perspectiveState.history = [];
    perspectiveState.activeTemplateId = id;
    perspective.templateName.value = template.name;
    perspective.sceneName.textContent = `${template.name} · ${image.naturalWidth}×${image.naturalHeight}`;
    perspective.empty.hidden = true;
    const legacyFitMigrated = applySceneTemplateOptions(template.options);
    configurePerspectiveCanvas();
    renderSceneTemplates();
    redrawPerspective();
    setSceneTemplateHint(
      legacyFitMigrated
        ? "已恢复场景，并自动切换为“完整贴满”，避免旧模板出现黑边或裁掉课件内容。"
        : "已恢复背景图、四点定位和画面贴合设置。",
      "success",
    );
    setStatus(
      perspective.status,
      "success",
      perspectiveState.replacementImage
        ? "常用场景已恢复，可以直接微调或导出。"
        : "常用场景已恢复，请上传需要贴入的课件画面。",
    );
  } catch (error) {
    setStatus(perspective.status, "error", `恢复失败：${error.message}`);
  } finally {
    perspectiveState.templateBusy = false;
    updatePerspectiveControls();
  }
}

function startSceneTemplateRename(id) {
  const summary = perspectiveState.templateSummaries.find((item) => item.id === id);
  if (!summary) return;
  perspectiveState.renameTemplateId = id;
  renderSceneTemplates();
}

async function commitSceneTemplateRename(id) {
  const summary = perspectiveState.templateSummaries.find((item) => item.id === id);
  const input = perspective.templateList.querySelector(`[data-template-id="${CSS.escape(id)}"] .scene-template-rename-input`);
  if (!summary || !input) return;
  const name = cleanSceneTemplateName(input.value);
  if (!name) {
    setSceneTemplateHint("场景名称不能为空。", "error");
    input.focus();
    return;
  }
  if (name === summary.name) {
    perspectiveState.renameTemplateId = null;
    renderSceneTemplates();
    return;
  }
  try {
    await renameSceneTemplate(id, name);
    if (perspectiveState.activeTemplateId === id) perspective.templateName.value = name;
    perspectiveState.renameTemplateId = null;
    await refreshSceneTemplates();
    setSceneTemplateHint(`已重命名为“${name}”。`, "success");
  } catch (error) {
    setSceneTemplateHint(`重命名失败：${error.message}`, "error");
  }
}

async function removeStoredSceneTemplate(id) {
  const summary = perspectiveState.templateSummaries.find((item) => item.id === id);
  if (!summary) return;
  if (!window.confirm(`确定删除常用场景“${summary.name}”吗？删除后无法恢复。`)) return;
  try {
    await deleteSceneTemplate(id);
    if (perspectiveState.activeTemplateId === id) perspectiveState.activeTemplateId = null;
    await refreshSceneTemplates();
    setSceneTemplateHint("常用场景已删除，当前画布内容仍然保留。", "success");
    updatePerspectiveControls();
  } catch (error) {
    setSceneTemplateHint(`删除失败：${error.message}`, "error");
  }
}

function pushPointHistory() {
  perspectiveState.history.push(perspectiveState.points.map((point) => ({ ...point })));
  if (perspectiveState.history.length > 40) perspectiveState.history.shift();
}

function imageFromFile(file, label) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      reject(new Error(`${label}仅支持 JPG、PNG 或 WebP。`));
      return;
    }
    if (file.size > 40 * 1024 * 1024) {
      reject(new Error(`${label}超过 40 MB，请压缩后再上传。`));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth * image.naturalHeight > 80_000_000) {
        reject(new Error(`${label}像素尺寸过大，请将长边缩小到 10000 像素以内。`));
        return;
      }
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${label}无法读取，文件可能已损坏。`));
    };
    image.src = url;
  });
}

function imageDimensions(image) {
  return {
    width: Number(image?.naturalWidth || image?.width || 0),
    height: Number(image?.naturalHeight || image?.height || 0),
  };
}

function optimizeReplacementImage(image) {
  const { width, height } = imageDimensions(image);
  const scale = Math.min(
    1,
    3200 / Math.max(width, height),
    Math.sqrt(8_000_000 / Math.max(1, width * height)),
  );
  if (scale >= 0.999) return image;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function replacementThumbnail(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const context = canvas.getContext("2d");
  const { width, height } = imageDimensions(image);
  const sourceRatio = width / height;
  const targetRatio = canvas.width / canvas.height;
  let sourceWidth = width;
  let sourceHeight = height;
  let sourceX = 0;
  let sourceY = 0;
  if (sourceRatio > targetRatio) {
    sourceWidth = height * targetRatio;
    sourceX = (width - sourceWidth) / 2;
  } else {
    sourceHeight = width / targetRatio;
    sourceY = (height - sourceHeight) / 2;
  }
  context.fillStyle = "#eef3f0";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/jpeg", 0.82);
}

function renderReplacementQueue() {
  const count = perspectiveState.replacements.length;
  const current = perspectiveState.replacementIndex;
  perspective.replacementQueue.hidden = count === 0;
  perspective.replacementQueueCount.textContent = count
    ? `已选择 ${count} 张 · 当前第 ${current + 1} 张`
    : "已选择 0 张";
  perspective.previousReplacementButton.disabled = current <= 0;
  perspective.nextReplacementButton.disabled = current < 0 || current >= count - 1;
  perspective.replacementThumbs.innerHTML = "";
  perspectiveState.replacements.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `replacement-thumb${index === current ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === current));
    button.setAttribute("aria-label", `选择第 ${index + 1} 张：${item.file.name}`);
    const image = document.createElement("img");
    image.src = item.thumbnail;
    image.alt = "";
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    button.append(image, number);
    button.addEventListener("click", () => selectReplacementIndex(index));
    perspective.replacementThumbs.append(button);
  });
}

function selectReplacementIndex(index) {
  const item = perspectiveState.replacements[index];
  if (!item) return;
  perspectiveState.replacementIndex = index;
  perspectiveState.replacementFile = item.file;
  perspectiveState.replacementImage = item.image;
  const { width, height } = imageDimensions(item.image);
  perspective.replacementName.textContent =
    `第 ${index + 1}/${perspectiveState.replacements.length} 张 · ${item.file.name} · ${width}×${height}`;
  renderReplacementQueue();
  redrawPerspective();
}

async function addReplacementImages(fileList) {
  const incoming = [...(fileList || [])];
  if (!incoming.length) return;
  const existingKeys = new Set(
    perspectiveState.replacements.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`),
  );
  const availableSlots = Math.max(0, MAX_REPLACEMENT_IMAGES - perspectiveState.replacements.length);
  const files = incoming
    .filter((file) => !existingKeys.has(`${file.name}:${file.size}:${file.lastModified}`))
    .slice(0, availableSlots);
  if (!files.length) {
    showToolToast(
      availableSlots
        ? "这些图片已经在列表中。"
        : `一次最多保留 ${MAX_REPLACEMENT_IMAGES} 张替换画面。`,
    );
    perspective.replacementInput.value = "";
    return;
  }

  setStatus(perspective.status, "working", `正在读取 ${files.length} 张替换画面…`);
  const firstNewIndex = perspectiveState.replacements.length;
  const errors = [];
  for (const file of files) {
    try {
      const original = await imageFromFile(file, "替换画面");
      const image = optimizeReplacementImage(original);
      perspectiveState.replacements.push({
        file,
        image,
        thumbnail: replacementThumbnail(image),
      });
    } catch (error) {
      errors.push(`${file.name}：${error.message}`);
    }
  }
  perspective.replacementInput.value = "";
  if (perspectiveState.replacements.length > firstNewIndex) {
    selectReplacementIndex(firstNewIndex);
    if (incoming.length > files.length) {
      showToolToast(`已达到上限，本次最多保留 ${MAX_REPLACEMENT_IMAGES} 张替换画面。`);
    } else if (errors.length) {
      showToolToast(`有 ${errors.length} 张图片未能读取。`);
    }
    return;
  }
  setStatus(perspective.status, "error", errors[0] || "没有读取到可用图片。");
}

function configurePerspectiveCanvas() {
  const image = perspectiveState.backgroundImage;
  if (!image) return;
  const width = Math.min(1400, image.naturalWidth);
  const height = Math.max(1, Math.round(width * image.naturalHeight / image.naturalWidth));
  perspective.canvas.width = width;
  perspective.canvas.height = height;
  perspective.stage.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
  perspective.resolution.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
}

function prepareReplacementCanvas(
  aspect,
  options,
  targetWidth,
  targetHeight,
  source = perspectiveState.replacementImage,
) {
  const { width: sourceWidth, height: sourceHeight } = imageDimensions(source);
  const rasterAspect = resolvePerspectiveRasterAspect(
    sourceWidth,
    sourceHeight,
    aspect,
    options.fitMode,
  );
  const { width, height } = computePerspectiveRasterSize(rasterAspect, targetWidth, targetHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = options.matteColor;
  context.fillRect(0, 0, width, height);
  context.filter = `brightness(${options.brightness})`;
  if (options.fitMode === "warp") {
    context.drawImage(source, 0, 0, width, height);
  } else {
    const fit = computeImageFitRect(
      sourceWidth,
      sourceHeight,
      width,
      height,
      options.fitMode,
    );
    context.drawImage(source, fit.x, fit.y, fit.width, fit.height);
  }
  context.filter = "none";
  return canvas;
}

function drawWarpTriangle(context, sourceCanvas, sourcePoints, destinationPoints) {
  const affine = affineFromTriangles(sourcePoints, destinationPoints);
  if (!affine) return;
  const clipPoints = expandTriangleForOverlap(destinationPoints);
  context.save();
  context.beginPath();
  context.moveTo(clipPoints[0].x, clipPoints[0].y);
  context.lineTo(clipPoints[1].x, clipPoints[1].y);
  context.lineTo(clipPoints[2].x, clipPoints[2].y);
  context.closePath();
  context.clip();
  context.setTransform(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f);
  context.drawImage(sourceCanvas, 0, 0);
  context.restore();
}

function warpImageMesh(context, sourceCanvas, destinationPoints, divisions = 22) {
  const homography = computeUnitSquareHomography(destinationPoints);
  const columns = divisions;
  const rows = Math.max(12, Math.round(divisions * sourceCanvas.height / sourceCanvas.width));
  const sourcePoint = (u, v) => ({ x: u * sourceCanvas.width, y: v * sourceCanvas.height });
  for (let row = 0; row < rows; row += 1) {
    const v0 = row / rows;
    const v1 = (row + 1) / rows;
    for (let column = 0; column < columns; column += 1) {
      const u0 = column / columns;
      const u1 = (column + 1) / columns;
      const s00 = sourcePoint(u0, v0);
      const s10 = sourcePoint(u1, v0);
      const s11 = sourcePoint(u1, v1);
      const s01 = sourcePoint(u0, v1);
      const d00 = projectUnitPoint(homography, u0, v0);
      const d10 = projectUnitPoint(homography, u1, v0);
      const d11 = projectUnitPoint(homography, u1, v1);
      const d01 = projectUnitPoint(homography, u0, v1);
      drawWarpTriangle(context, sourceCanvas, [s00, s10, s11], [d00, d10, d11]);
      drawWarpTriangle(context, sourceCanvas, [s00, s11, s01], [d00, d11, d01]);
    }
  }
}

function polygonPath(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
}

function quadPixelExtent(points) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return {
    width: Math.max(distance(points[0], points[1]), distance(points[3], points[2])),
    height: Math.max(distance(points[0], points[3]), distance(points[1], points[2])),
  };
}

function renderPerspective(
  width,
  height,
  { guides = false, divisions = 22, replacementImage = perspectiveState.replacementImage } = {},
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const background = perspectiveState.backgroundImage;
  context.drawImage(background, 0, 0, width, height);
  const points = perspectiveState.points.map((point) => ({ x: point.x * width, y: point.y * height }));
  const validation = validatePerspectiveQuad(perspectiveState.points);

  if (replacementImage && points.length === 4 && validation.valid) {
    const options = perspectiveOptions();
    const aspect = estimateQuadAspect(perspectiveState.points, width, height);
    const targetExtent = quadPixelExtent(points);
    const prepared = prepareReplacementCanvas(
      aspect,
      options,
      targetExtent.width,
      targetExtent.height,
      replacementImage,
    );
    const warped = document.createElement("canvas");
    warped.width = width;
    warped.height = height;
    const warpedContext = warped.getContext("2d");
    warpedContext.imageSmoothingEnabled = true;
    warpedContext.imageSmoothingQuality = "high";
    warpImageMesh(warpedContext, prepared, points, divisions);

    const mask = document.createElement("canvas");
    mask.width = width;
    mask.height = height;
    const maskContext = mask.getContext("2d");
    if (options.feather > 0) {
      const featherScale = width / perspectiveState.backgroundImage.naturalWidth;
      maskContext.filter = `blur(${Math.max(0.1, options.feather * featherScale)}px)`;
    }
    maskContext.fillStyle = "#fff";
    polygonPath(maskContext, points);
    maskContext.fill();
    maskContext.filter = "none";
    warpedContext.globalCompositeOperation = "destination-in";
    warpedContext.drawImage(mask, 0, 0);
    warpedContext.globalCompositeOperation = "source-over";
    context.save();
    context.globalAlpha = options.opacity;
    context.drawImage(warped, 0, 0);
    context.restore();
  }

  if (guides && points.length) {
    const validColor = points.length < 4 || validation.valid;
    context.save();
    context.lineWidth = Math.max(2, width / 600);
    context.strokeStyle = validColor ? "#dff36a" : "#ef6b6b";
    context.fillStyle = "rgba(23,63,53,.82)";
    context.setLineDash([8, 5]);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    if (points.length === 4) context.closePath();
    context.stroke();
    context.setLineDash([]);
    points.forEach((point, index) => {
      const radius = Math.max(11, width / 75);
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = Math.max(2, width / 700);
      context.strokeStyle = "#fff";
      context.stroke();
      context.fillStyle = "#fff";
      context.font = `800 ${Math.max(12, width / 72)}px system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), point.x, point.y + 0.5);
      context.fillStyle = "rgba(23,63,53,.82)";
    });
    context.restore();
  }
  return canvas;
}

function updatePerspectiveStatus() {
  if (!perspectiveState.backgroundImage) {
    setStatus(perspective.status, "", "请先上传场景背景图。");
    return;
  }
  if (!perspectiveState.replacementImage) {
    setStatus(perspective.status, "", "场景图已准备，请上传需要贴入的课件画面。");
    return;
  }
  if (perspectiveState.points.length < 4) {
    const names = ["左上角", "右上角", "右下角", "左下角"];
    setStatus(
      perspective.status,
      "working",
      `请点击屏幕的${names[perspectiveState.points.length]}（第 ${perspectiveState.points.length + 1} 个点）。`,
    );
    return;
  }
  const validation = validatePerspectiveQuad(perspectiveState.points);
  setStatus(
    perspective.status,
    validation.valid ? "success" : "error",
    validation.valid
      ? "透视定位完成，可以拖动四个编号手柄继续微调。"
      : validation.message,
  );
}

function redrawPerspective() {
  window.cancelAnimationFrame(perspectiveState.animationFrame);
  perspectiveState.animationFrame = window.requestAnimationFrame(() => {
    const context = perspective.canvas.getContext("2d");
    context.clearRect(0, 0, perspective.canvas.width, perspective.canvas.height);
    if (!perspectiveState.backgroundImage) return;
    const rendered = renderPerspective(perspective.canvas.width, perspective.canvas.height, {
      guides: true,
      divisions: perspectiveState.dragIndex >= 0 ? 14 : 22,
    });
    context.drawImage(rendered, 0, 0);
  });
  updatePerspectiveStatus();
  updatePerspectiveControls();
}

async function selectSceneImage(file) {
  try {
    const image = await imageFromFile(file, "场景图");
    perspectiveState.backgroundFile = file;
    perspectiveState.backgroundImage = image;
    perspectiveState.points = [];
    perspectiveState.history = [];
    perspectiveState.activeTemplateId = null;
    perspective.templateName.value = defaultSceneTemplateName(file);
    perspective.sceneName.textContent = `${file.name} · ${image.naturalWidth}×${image.naturalHeight}`;
    perspective.empty.hidden = true;
    setSceneTemplateHint("完成四点定位后，可把背景图和定位保存为常用场景。");
    renderSceneTemplates();
    configurePerspectiveCanvas();
    redrawPerspective();
  } catch (error) {
    setStatus(perspective.status, "error", error.message);
    perspective.sceneInput.value = "";
  }
}

function canvasPointFromEvent(event) {
  const rect = perspective.canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}

function nearestPointIndex(point) {
  const rect = perspective.canvas.getBoundingClientRect();
  const thresholdX = 20 / Math.max(1, rect.width);
  const thresholdY = 20 / Math.max(1, rect.height);
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  perspectiveState.points.forEach((candidate, index) => {
    const distance = Math.hypot(
      (candidate.x - point.x) / thresholdX,
      (candidate.y - point.y) / thresholdY,
    );
    if (distance <= 1 && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

perspective.canvas.addEventListener("pointerdown", (event) => {
  if (!perspectiveState.backgroundImage || !perspectiveState.replacementImage) return;
  const point = canvasPointFromEvent(event);
  if (perspectiveState.points.length < 4) {
    pushPointHistory();
    perspectiveState.points.push(point);
    perspective.canvas.setPointerCapture(event.pointerId);
    redrawPerspective();
    return;
  }
  const index = nearestPointIndex(point);
  if (index < 0) return;
  pushPointHistory();
  perspectiveState.dragIndex = index;
  perspectiveState.dragHistorySaved = true;
  perspective.stage.classList.add("dragging");
  perspective.canvas.setPointerCapture(event.pointerId);
});

perspective.canvas.addEventListener("pointermove", (event) => {
  if (perspectiveState.dragIndex < 0) return;
  const point = canvasPointFromEvent(event);
  const candidate = perspectiveState.points.map((item) => ({ ...item }));
  candidate[perspectiveState.dragIndex] = point;
  if (validatePerspectiveQuad(candidate).valid) {
    perspectiveState.points = candidate;
    redrawPerspective();
  }
});

function stopPerspectiveDrag(event) {
  if (perspectiveState.dragIndex < 0) return;
  if (perspective.canvas.hasPointerCapture(event.pointerId)) {
    perspective.canvas.releasePointerCapture(event.pointerId);
  }
  perspectiveState.dragIndex = -1;
  perspectiveState.dragHistorySaved = false;
  perspective.stage.classList.remove("dragging");
  redrawPerspective();
}

perspective.canvas.addEventListener("pointerup", stopPerspectiveDrag);
perspective.canvas.addEventListener("pointercancel", stopPerspectiveDrag);

perspective.sceneButton.addEventListener("click", () => perspective.sceneInput.click());
perspective.replacementButton.addEventListener("click", () => perspective.replacementInput.click());
perspective.sceneInput.addEventListener("change", (event) => selectSceneImage(event.target.files?.[0]));
perspective.replacementInput.addEventListener("change", (event) => addReplacementImages(event.target.files));
perspective.templateName.addEventListener("input", () => updatePerspectiveControls());
perspective.templateSaveButton.addEventListener("click", () => saveCurrentSceneTemplate());
perspective.templateList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-template-action]");
  const card = button?.closest("[data-template-id]");
  if (!button || !card) return;
  const id = card.dataset.templateId;
  if (button.dataset.templateAction === "use") useSceneTemplate(id);
  if (button.dataset.templateAction === "rename") startSceneTemplateRename(id);
  if (button.dataset.templateAction === "save-rename") commitSceneTemplateRename(id);
  if (button.dataset.templateAction === "cancel-rename") {
    perspectiveState.renameTemplateId = null;
    renderSceneTemplates();
  }
  if (button.dataset.templateAction === "delete") removeStoredSceneTemplate(id);
});
perspective.templateList.addEventListener("keydown", (event) => {
  if (!event.target.matches(".scene-template-rename-input")) return;
  const card = event.target.closest("[data-template-id]");
  if (!card) return;
  if (event.key === "Enter") {
    event.preventDefault();
    commitSceneTemplateRename(card.dataset.templateId);
  }
  if (event.key === "Escape") {
    perspectiveState.renameTemplateId = null;
    renderSceneTemplates();
  }
});
perspective.previousReplacementButton.addEventListener("click", () => {
  selectReplacementIndex(perspectiveState.replacementIndex - 1);
});
perspective.nextReplacementButton.addEventListener("click", () => {
  selectReplacementIndex(perspectiveState.replacementIndex + 1);
});
perspective.undoButton.addEventListener("click", () => {
  const previous = perspectiveState.history.pop();
  if (!previous) return;
  perspectiveState.points = previous;
  redrawPerspective();
});
perspective.resetButton.addEventListener("click", () => {
  if (!perspectiveState.points.length) return;
  pushPointHistory();
  perspectiveState.points = [];
  redrawPerspective();
});

for (const input of [
  perspective.fitMode,
  perspective.matteColor,
  perspective.opacity,
  perspective.brightness,
  perspective.feather,
]) {
  input.addEventListener("input", () => {
    perspective.opacityValue.textContent = `${perspective.opacity.value}%`;
    perspective.brightnessValue.textContent = `${perspective.brightness.value}%`;
    perspective.featherValue.textContent = `${perspective.feather.value} px`;
    const colorOutput = perspective.matteColor.closest(".color-field")?.querySelector("output");
    if (colorOutput) colorOutput.textContent = perspective.matteColor.value.toUpperCase();
    if (input === perspective.fitMode) {
      const fitMessages = {
        warp: "已将完整画面贴满四点区域，不会出现黑边，也不会裁掉左右内容。",
        cover: "已使用裁切铺满；画面边缘可能被裁掉。",
        contain: "已完整显示画面；比例不一致时可能出现留边。",
      };
      setStatus(perspective.status, "success", fitMessages[perspective.fitMode.value]);
    }
    redrawPerspective();
  });
}

function safeExportStem(file, fallback = "替换画面") {
  return String(file?.name || fallback)
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 48) || fallback;
}

function nextAnimationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function exportPerspective(mimeType) {
  if (perspectiveState.exporting) return;
  const validation = validatePerspectiveQuad(perspectiveState.points);
  if (!perspectiveState.backgroundImage || !perspectiveState.replacements.length || !validation.valid) {
    setStatus(perspective.status, "error", validation.message || "请先完成四点定位。 ");
    return;
  }
  const replacements = [...perspectiveState.replacements];
  perspectiveState.exporting = true;
  updatePerspectiveControls();
  try {
    const width = perspectiveState.backgroundImage.naturalWidth;
    const height = perspectiveState.backgroundImage.naturalHeight;
    const extension = mimeType === "image/png" ? "png" : "jpg";
    const formatLabel = extension.toUpperCase();

    if (replacements.length === 1) {
      setStatus(perspective.status, "working", `正在导出 ${formatLabel}…`);
      const canvas = renderPerspective(width, height, {
        guides: false,
        divisions: 38,
        replacementImage: replacements[0].image,
      });
      const blob = await canvasToBlob(canvas, mimeType, 0.94);
      downloadBlob(blob, `场景透视换图-01-${safeExportStem(replacements[0].file)}.${extension}`);
      setStatus(perspective.status, "success", `导出完成，尺寸为 ${width} × ${height}。`);
      return;
    }

    const entries = [];
    for (let index = 0; index < replacements.length; index += 1) {
      const item = replacements[index];
      setStatus(
        perspective.status,
        "working",
        `正在批量生成第 ${index + 1}/${replacements.length} 张 ${formatLabel}…`,
      );
      await nextAnimationFrame();
      const canvas = renderPerspective(width, height, {
        guides: false,
        divisions: 38,
        replacementImage: item.image,
      });
      const blob = await canvasToBlob(canvas, mimeType, 0.94);
      const number = String(index + 1).padStart(2, "0");
      entries.push({
        name: `场景透视换图-${number}-${safeExportStem(item.file)}.${extension}`,
        data: blob,
      });
    }
    setStatus(perspective.status, "working", `正在打包 ${replacements.length} 张图片…`);
    const archive = await createStoredZip(entries);
    downloadBlob(archive, `场景透视换图-${replacements.length}张-${formatLabel}.zip`);
    setStatus(
      perspective.status,
      "success",
      `已批量导出 ${replacements.length} 张 ${formatLabel}，尺寸均为 ${width} × ${height}。`,
    );
  } catch (error) {
    setStatus(perspective.status, "error", `导出失败：${error.message}`);
  } finally {
    perspectiveState.exporting = false;
    updatePerspectiveControls();
  }
}

perspective.pngButton.addEventListener("click", () => exportPerspective("image/png"));
perspective.jpgButton.addEventListener("click", () => exportPerspective("image/jpeg"));
perspective.restartButton.addEventListener("click", () => {
  perspectiveState.backgroundFile = null;
  perspectiveState.backgroundImage = null;
  perspectiveState.replacementFile = null;
  perspectiveState.replacementImage = null;
  perspectiveState.replacements = [];
  perspectiveState.replacementIndex = -1;
  perspectiveState.points = [];
  perspectiveState.history = [];
  perspectiveState.exporting = false;
  perspectiveState.activeTemplateId = null;
  perspectiveState.renameTemplateId = null;
  perspective.sceneInput.value = "";
  perspective.replacementInput.value = "";
  perspective.templateName.value = "";
  perspective.sceneName.textContent = "JPG / PNG / WebP";
  perspective.replacementName.textContent = "最多 18 张 PPT 页面或商品图片";
  perspective.resolution.textContent = "尚未上传场景图";
  perspective.canvas.width = 1200;
  perspective.canvas.height = 675;
  perspective.stage.style.aspectRatio = "16 / 9";
  perspective.canvas.getContext("2d").clearRect(0, 0, 1200, 675);
  perspective.empty.hidden = false;
  setSceneTemplateHint("上传背景图并完成四点定位后即可保存，最多 12 个。");
  renderSceneTemplates();
  renderReplacementQueue();
  redrawPerspective();
});

switchWorkspace(location.hash.replace(/^#/, "") || "courseware", { updateHash: false });
renderReplacementQueue();
updatePerspectiveControls();
refreshSceneTemplates();
