import {
  analyzeKeywordCoverage,
  noteToPublishText,
  parseKeywordList,
  parseNoteModelOutput,
  titleWeightedLength,
  validateNoteRequest,
} from "/note-writing.js?v=20260811-seeding-notes-v3";

const $ = (selector, root = document) => root.querySelector(selector);
const storageKey = "mini-hanghai-note-draft-v1";
const settingsStorageKey = "mini-hanghai-text-api-settings-v1";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com";
const DEEPSEEK_NOTE_MODEL = "deepseek-v4-flash";
const LEGACY_DEEPSEEK_MODELS = new Set(["deepseek-chat", "deepseek-reasoner"]);

const fields = {
  sourceTitle: $("#noteSourceTitle"),
  source: $("#noteSource"),
  noteType: $("#noteType"),
  audience: $("#noteAudience"),
  audiencePain: $("#noteAudiencePain"),
  targetLength: $("#noteLength"),
  coreKeyword: $("#noteCoreKeyword"),
  longTailKeywords: $("#noteLongTailKeywords"),
  requiredFacts: $("#noteRequiredFacts"),
  forbiddenClaims: $("#noteForbiddenClaims"),
};

const textApiFields = {
  endpoint: $("#textApiEndpoint"),
  apiKey: $("#textApiKey"),
  model: $("#textApiModel"),
  protocol: $("#textApiProtocol"),
  proxyUrl: $("#textApiProxyUrl"),
  extraBody: $("#textApiExtraBody"),
  extraHeaders: $("#textApiExtraHeaders"),
};

let noteResult = null;
let selectedTitleIndex = 0;
let textConnectionState = "";
let textConnectionLabel = "文字 API 未配置";
let mockTextMode = false;
let draftSaveTimer;
let textProviderOrigin = "";
let noteGenerating = false;
let keywordSuggesting = false;

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2800);
}

function setStatus(state, message) {
  const element = $("#noteGenerationStatus");
  element.className = `tool-status${state ? ` ${state}` : ""}`;
  element.textContent = message;
}

function renderConnectionElement(state, label, description = label) {
  const element = $("#connectionState");
  element.className = `connection-state ${state || ""}`.trim();
  $("span", element).textContent = label;
  element.title = description;
  element.setAttribute("aria-label", description);
}

function setTextConnectionState(state, label, description = label) {
  textConnectionState = state;
  textConnectionLabel = label;
  const element = $("#connectionState");
  element.dataset.textState = state;
  element.dataset.textLabel = label;
  element.dataset.textDescription = description;
  if (document.body.dataset.activeWorkspace === "notes") {
    renderConnectionElement(state, label, description);
  }
  const localState = $("#noteTextApiState");
  localState.className = `note-api-state ${state || ""}`.trim();
  localState.textContent = label;
}

function apiOrigin(value) {
  try {
    return new URL(String(value || "").trim()).origin;
  } catch {
    return "";
  }
}

function isDeepSeekEndpoint(value) {
  try {
    return new URL(String(value || "").trim()).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

function needsDeepSeekModelUpgrade(model) {
  const value = String(model || "").trim().toLowerCase();
  return !value || LEGACY_DEEPSEEK_MODELS.has(value);
}

function renderDeepSeekPresetState() {
  const button = $("#textApiDeepSeekPreset");
  if (!button) return;
  const selected = isDeepSeekEndpoint(textApiFields.endpoint.value);
  button.classList.toggle("selected", selected);
  button.setAttribute("aria-pressed", String(selected));
  button.textContent = selected ? "✓ 已选择 DeepSeek" : "一键填写 DeepSeek";
  button.closest(".provider-preset")?.classList.toggle("is-selected", selected);
}

function collectTextSettings() {
  return {
    endpoint: textApiFields.endpoint.value.trim(),
    apiKey: textApiFields.apiKey.value,
    model: textApiFields.model.value.trim(),
    protocol: textApiFields.protocol.value,
    proxyUrl: textApiFields.proxyUrl.value.trim(),
    extraBody: textApiFields.extraBody.value.trim(),
    extraHeaders: textApiFields.extraHeaders.value.trim(),
    providerOrigin: apiOrigin(textApiFields.endpoint.value),
    connectionStatus: textConnectionState || "configured",
  };
}

function applyTextSettings(settings = {}) {
  for (const key of [
    "endpoint",
    "apiKey",
    "model",
    "protocol",
    "proxyUrl",
    "extraBody",
    "extraHeaders",
  ]) {
    if (settings[key] != null && textApiFields[key]) textApiFields[key].value = settings[key];
  }
  const upgradedDeepSeekModel =
    isDeepSeekEndpoint(textApiFields.endpoint.value) &&
    needsDeepSeekModelUpgrade(textApiFields.model.value);
  if (upgradedDeepSeekModel) {
    textApiFields.model.value = DEEPSEEK_NOTE_MODEL;
    textApiFields.protocol.value = "auto";
  }
  renderDeepSeekPresetState();
  const hasEndpoint = Boolean(textApiFields.endpoint.value.trim());
  textProviderOrigin = settings.providerOrigin || apiOrigin(textApiFields.endpoint.value);
  const status = settings.connectionStatus;
  setTextConnectionState(
    status === "verified" && !upgradedDeepSeekModel ? "verified" : hasEndpoint ? "configured" : "",
    status === "verified" && !upgradedDeepSeekModel
      ? "文字 API 已连接"
      : hasEndpoint
        ? "文字 API 已配置"
        : "文字 API 未配置",
  );
}

function persistTextSettings() {
  localStorage.setItem(settingsStorageKey, JSON.stringify(collectTextSettings()));
}

function noteDraft() {
  return {
    version: 2,
    sourceTitle: fields.sourceTitle.value,
    source: fields.source.value,
    noteType: fields.noteType.value,
    audience: fields.audience.value,
    audiencePain: fields.audiencePain.value,
    targetLength: fields.targetLength.value,
    coreKeyword: fields.coreKeyword.value,
    longTailKeywords: fields.longTailKeywords.value,
    requiredFacts: fields.requiredFacts.value,
    forbiddenClaims: fields.forbiddenClaims.value,
    result: noteResult,
    selectedTitleIndex,
    updatedAt: Date.now(),
  };
}

function saveNoteDraft({ notify = false } = {}) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(noteDraft()));
    $("#noteSaveState").textContent = `已保存到本机 · ${new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date())}`;
    if (notify) toast("笔记草稿已保存在这台电脑");
  } catch {
    $("#noteSaveState").textContent = "本机保存失败，请下载文本备份";
  }
}

function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => saveNoteDraft(), 450);
}

function restoreNoteDraft(data = {}) {
  for (const key of [
    "sourceTitle",
    "source",
    "noteType",
    "audience",
    "audiencePain",
    "targetLength",
    "coreKeyword",
    "longTailKeywords",
    "requiredFacts",
    "forbiddenClaims",
  ]) {
    if (data[key] != null && fields[key]) fields[key].value = data[key];
  }
  if (data.result) {
    try {
      noteResult = parseNoteModelOutput(data.result);
      selectedTitleIndex = Math.max(
        0,
        Math.min(noteResult.titles.length - 1, Number(data.selectedTitleIndex) || 0),
      );
    } catch {
      noteResult = null;
    }
  }
  updateInputStatus();
  renderNoteResult();
}

function collectNoteRequest({ includeExistingDraft = false, variationMode = false, revisionMode = false } = {}) {
  return validateNoteRequest({
    sourceTitle: fields.sourceTitle.value,
    source: fields.source.value,
    noteType: fields.noteType.value,
    audience: fields.audience.value,
    audiencePain: fields.audiencePain.value,
    targetLength: fields.targetLength.value,
    coreKeyword: fields.coreKeyword.value,
    longTailKeywords: fields.longTailKeywords.value,
    requiredFacts: fields.requiredFacts.value,
    forbiddenClaims: fields.forbiddenClaims.value,
    existingDraft: includeExistingDraft
      ? $("#notePublishOutput")?.value.trim() || noteResult?.body || ""
      : "",
    variationMode,
    revisionMode,
  });
}

function updateInputStatus() {
  const sourceLength = fields.source.value.trim().length;
  const longTails = parseKeywordList(fields.longTailKeywords.value);
  $("#noteSourceCount").textContent = `${sourceLength} 字`;
  $("#noteKeywordCount").textContent = `${longTails.length} / 8 个`;
  $("#noteSourceState").textContent = sourceLength >= 80 ? "课件依据已准备" : "至少需要 80 个字";
  $("#noteKeywordState").textContent =
    longTails.length === 0
      ? "长尾关键词未填写，将只使用核心关键词"
      : longTails.length <= 8
        ? `已填写 ${longTails.length} 个选填长尾关键词`
        : "长尾关键词最多填写 8 个";
}

function currentCoverage() {
  return noteResult
    ? analyzeKeywordCoverage(
        noteResult,
        fields.coreKeyword.value,
        fields.longTailKeywords.value,
      )
    : null;
}

function renderKeywordCoverage() {
  const panel = $("#noteKeywordCoverage");
  const coverage = currentCoverage();
  panel.innerHTML = "";
  if (!coverage) {
    panel.append("生成后会检查核心关键词；填写了长尾关键词时再检查长尾词覆盖。");
    panel.className = "keyword-coverage empty";
    return;
  }
  panel.className = `keyword-coverage ${coverage.passed ? "passed" : "warning"}`;
  const title = document.createElement("strong");
  title.textContent = coverage.passed ? "关键词覆盖检查通过" : "还有关键词需要补齐";
  const core = document.createElement("p");
  core.textContent = `${coverage.coreFound ? "已使用" : "未使用"}核心关键词：${coverage.coreKeyword}`;
  panel.append(title, core);
  if (parseKeywordList(fields.longTailKeywords.value).length) {
    const used = document.createElement("p");
    used.textContent = `已使用长尾词：${coverage.usedLongTail.join("、") || "无"}`;
    const missing = document.createElement("p");
    missing.textContent = `遗漏长尾词：${coverage.missingLongTail.join("、") || "无"}`;
    panel.append(used, missing);
  } else {
    const optional = document.createElement("p");
    optional.textContent = "未填写长尾关键词，本次不检查长尾词。";
    panel.append(optional);
  }
}

function renderStringList(element, items, emptyText) {
  element.innerHTML = "";
  if (!items?.length) {
    const empty = document.createElement("li");
    empty.textContent = emptyText;
    element.appendChild(empty);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    element.appendChild(li);
  }
}

function updatePublishMeta(value = $("#notePublishOutput")?.value || "") {
  const lines = String(value).split(/\r?\n/);
  const title = lines.find((line) => line.trim())?.trim() || "";
  const titleLength = titleWeightedLength(title);
  const bodyLength = noteResult?.body?.replace(/\s+/g, "").length || 0;
  const output = $("#notePublishCount");
  output.textContent = `标题 ${titleLength}/20 · 正文约 ${bodyLength} 字`;
  output.classList.toggle("warning", titleLength > 20);
}

function syncNoteFromPublishText(value) {
  if (!noteResult) return;
  const lines = String(value || "").replace(/\r/g, "").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const title = String(lines.shift() || "").trim();
  let hashtags = [];
  const lastLine = String(lines.at(-1) || "").trim();
  if (lastLine && lastLine.split(/\s+/).every((item) => /^#[^#\s]+$/u.test(item))) {
    hashtags = lastLine.split(/\s+/).filter(Boolean).slice(0, 8);
    lines.pop();
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (title) noteResult.titles[selectedTitleIndex] = title;
  noteResult.body = lines.join("\n").trim();
  noteResult.hashtags = hashtags;
  updatePublishMeta(value);
}

function renderNoteResult() {
  const empty = $("#noteResultEmpty");
  const content = $("#noteResultContent");
  if (!noteResult) {
    empty.hidden = false;
    content.hidden = true;
    renderKeywordCoverage();
    return;
  }
  empty.hidden = true;
  content.hidden = false;
  const titleList = $("#noteTitleOptions");
  titleList.innerHTML = "";
  noteResult.titles.forEach((title, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `note-title-option${index === selectedTitleIndex ? " active" : ""}`;
    const label = document.createElement("span");
    label.textContent = title;
    const count = document.createElement("small");
    count.textContent = `${titleWeightedLength(title)}/20`;
    button.append(label, count);
    button.addEventListener("click", () => {
      selectedTitleIndex = index;
      renderNoteResult();
      scheduleDraftSave();
    });
    titleList.appendChild(button);
  });
  const publishText = noteToPublishText(noteResult, selectedTitleIndex);
  $("#notePublishOutput").value = publishText;
  updatePublishMeta(publishText);
  $("#notePosterOutput").textContent = noteResult.posterText || "未生成大字报文案";
  renderStringList($("#noteImagePlan"), noteResult.imagePlan, "未生成配图建议");
  const facts = noteResult.factBasis.map((item) =>
    item.source ? `${item.fact}（依据：${item.source}）` : item.fact,
  );
  renderStringList($("#noteFactBasis"), facts, "模型未返回事实依据，请人工核对正文");
  renderKeywordCoverage();
}

function setBusy(button, busy, busyText, normalText) {
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
  button.textContent = busy ? busyText : normalText;
  button.setAttribute("aria-busy", String(busy));
}

async function postJson(url, payload, signal) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
  return body;
}

async function generateNote({ revise = false, variation = false } = {}) {
  if (noteGenerating || keywordSuggesting) return;
  let request;
  try {
    request = collectNoteRequest({
      includeExistingDraft: revise || variation,
      variationMode: variation,
      revisionMode: revise,
    });
  } catch (error) {
    setStatus("error", error.message);
    toast(error.message);
    return;
  }
  const settings = collectTextSettings();
  if (!mockTextMode && (!settings.endpoint || !settings.model)) {
    setStatus("error", "请先配置并检测文字处理 API。");
    openTextApiDialog();
    return;
  }
  if (!mockTextMode && isDeepSeekEndpoint(settings.endpoint) && !settings.apiKey.trim()) {
    setStatus("error", "请先填写自己的 DeepSeek API Key。");
    openTextApiDialog();
    return;
  }
  noteGenerating = true;
  const button = variation
    ? $("#regenerateNoteButton")
    : revise
      ? $("#reviseNoteButton")
      : $("#generateNoteButton");
  const normalText = variation ? "再生成一条" : revise ? "按要求优化" : "生成课件笔记";
  const generationButtons = [
    $("#generateNoteButton"),
    $("#reviseNoteButton"),
    $("#regenerateNoteButton"),
    $("#suggestNoteKeywordsButton"),
  ];
  generationButtons.forEach((item) => { item.disabled = true; });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 185_000);
  setBusy(
    button,
    true,
    variation ? "正在换角度生成…" : revise ? "正在按要求优化…" : "正在生成种草笔记…",
    normalText,
  );
  setStatus(
    "working",
    variation
      ? "正在更换切入场景和内容组合，生成另一条笔记…"
      : "正在提炼一个种草角度、整理关键词并生成笔记…",
  );
  try {
    const body = await postJson(
      "/api/generate-note",
      { ...settings, ...request },
      controller.signal,
    );
    noteResult = parseNoteModelOutput(body.note);
    selectedTitleIndex = 0;
    renderNoteResult();
    saveNoteDraft();
    const coverage = currentCoverage();
    const longTailCount = parseKeywordList(fields.longTailKeywords.value).length;
    setStatus(
      coverage.passed ? "success" : "warning",
      coverage.passed
        ? longTailCount
          ? "笔记已生成，核心关键词和选填长尾词均已自然覆盖。"
          : "笔记已生成，核心关键词已自然覆盖。"
        : `笔记已生成，但还有 ${coverage.missingLongTail.length + (coverage.coreFound ? 0 : 1)} 个关键词未覆盖，可点击“按要求优化”。`,
    );
    setTextConnectionState("verified", mockTextMode ? "模拟文字 API 已连接" : "文字 API 已连接");
  } catch (error) {
    setStatus(
      "error",
      error?.name === "AbortError" ? "生成超过 185 秒，已自动停止，请稍后重试。" : error.message,
    );
  } finally {
    clearTimeout(timeout);
    noteGenerating = false;
    setBusy(button, false, "", normalText);
    generationButtons.forEach((item) => { item.disabled = false; });
  }
}

async function suggestNoteKeywords() {
  if (noteGenerating || keywordSuggesting) return;
  const source = fields.source.value.trim();
  const coreKeyword = fields.coreKeyword.value.trim();
  if (source.length < 80) {
    setStatus("error", "请先导入至少 80 个字的课件依据，再推荐关键词。");
    fields.source.focus();
    return;
  }
  if (coreKeyword.length < 2) {
    setStatus("error", "请先填写核心关键词，再推荐长尾关键词。");
    fields.coreKeyword.focus();
    return;
  }
  const settings = collectTextSettings();
  if (!mockTextMode && (!settings.endpoint || !settings.model)) {
    setStatus("error", "请先配置并检测文字处理 API。");
    openTextApiDialog();
    return;
  }
  if (!mockTextMode && isDeepSeekEndpoint(settings.endpoint) && !settings.apiKey.trim()) {
    setStatus("error", "请先填写自己的 DeepSeek API Key。");
    openTextApiDialog();
    return;
  }
  keywordSuggesting = true;
  const button = $("#suggestNoteKeywordsButton");
  const generationButtons = [
    $("#generateNoteButton"),
    $("#reviseNoteButton"),
    $("#regenerateNoteButton"),
  ];
  generationButtons.forEach((item) => { item.disabled = true; });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  setBusy(button, true, "正在推荐…", "AI 推荐关键词");
  setStatus("working", "正在根据课件、目标读者和读者痛点整理关键词灵感…");
  try {
    const body = await postJson(
      "/api/suggest-note-keywords",
      {
        ...settings,
        sourceTitle: fields.sourceTitle.value,
        source,
        coreKeyword,
        audience: fields.audience.value,
        audiencePain: fields.audiencePain.value,
      },
      controller.signal,
    );
    const keywords = parseKeywordList(body.keywords).slice(0, 8);
    if (!keywords.length) throw new Error("文字模型没有返回可用的关键词。");
    fields.longTailKeywords.value = keywords.join("\n");
    updateInputStatus();
    renderKeywordCoverage();
    saveNoteDraft();
    setStatus("success", `已根据当前课件推荐 ${keywords.length} 个关键词灵感，可继续手动修改。`);
    toast("关键词灵感已填入，不代表小红书实时搜索量");
  } catch (error) {
    setStatus(
      "error",
      error?.name === "AbortError" ? "关键词推荐超过 60 秒，已自动停止。" : error.message,
    );
  } finally {
    clearTimeout(timeout);
    keywordSuggesting = false;
    setBusy(button, false, "", "AI 推荐关键词");
    generationButtons.forEach((item) => { item.disabled = false; });
  }
}

function importCurrentCourseware() {
  const title = $("#deckTitle")?.value?.trim() || "当前课件";
  const script = $("#scriptInput")?.value?.trim() || "";
  if (!script) {
    toast("当前课件还没有页纲内容，请先填写课件或直接粘贴资料。");
    return false;
  }
  fields.sourceTitle.value = title;
  fields.source.value = script;
  updateInputStatus();
  saveNoteDraft();
  toast("当前课件内容已带入笔记工作台");
  return true;
}

function openTextApiDialog() {
  renderDeepSeekPresetState();
  if (!$("#textApiDialog").open) $("#textApiDialog").showModal();
  $("#textApiTestResult").className = "test-result neutral";
  $("#textApiTestResult").textContent = textConnectionState === "verified"
    ? "当前文字 API 已连接；修改参数后需要重新检测"
    : "填写完成后，请先检测文字模型连接";
  requestAnimationFrame(() =>
    (textApiFields.endpoint.value ? textApiFields.apiKey : textApiFields.endpoint).focus({
      preventScroll: true,
    }),
  );
}

function closeTextApiDialog() {
  textApiFields.apiKey.type = "password";
  $("#toggleTextApiKey").textContent = "显示";
  $("#textApiDialog").close();
}

function setTextApiTestResult(state, message) {
  const element = $("#textApiTestResult");
  element.className = `test-result ${state}`;
  element.textContent = message;
}

async function testTextConnection() {
  const settings = collectTextSettings();
  if (!mockTextMode && (!settings.endpoint || !settings.model)) {
    setTextApiTestResult("error", "请填写文字处理 API 地址和模型名称。");
    return;
  }
  if (!mockTextMode && isDeepSeekEndpoint(settings.endpoint) && !settings.apiKey.trim()) {
    setTextApiTestResult("error", "请填写自己的 DeepSeek API Key 后再检测连接。");
    textApiFields.apiKey.focus();
    return;
  }
  const button = $("#testTextApiButton");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  setBusy(button, true, "检测中…", "检测连接");
  setTextApiTestResult("working", "正在检测地址、鉴权、模型和文字返回…");
  try {
    const body = mockTextMode
      ? { verified: true, message: "模拟文字接口连接正常。" }
      : await postJson("/api/test-text-connection", settings, controller.signal);
    setTextConnectionState(
      body.verified ? "verified" : "warning",
      body.verified ? "文字 API 已连接" : "文字 API 待检测",
    );
    persistTextSettings();
    setTextApiTestResult(body.verified ? "success" : "warning", body.message);
  } catch (error) {
    setTextConnectionState("error", "文字 API 连接失败");
    setTextApiTestResult(
      "error",
      error?.name === "AbortError" ? "连接检测超过 20 秒，已自动停止。" : error.message,
    );
  } finally {
    clearTimeout(timeout);
    setBusy(button, false, "", "检测连接");
  }
}

function saveTextSettings() {
  const settings = collectTextSettings();
  if (!settings.endpoint || !settings.model) {
    setTextApiTestResult("error", "请先选择文字服务商，并确认 API 地址和模型名称。");
    return;
  }
  if (isDeepSeekEndpoint(settings.endpoint) && !settings.apiKey.trim()) {
    setTextApiTestResult("error", "请填写自己的 DeepSeek API Key 后再保存。");
    textApiFields.apiKey.focus();
    return;
  }
  setTextConnectionState(
    settings.endpoint
      ? textConnectionState === "verified"
        ? "verified"
        : "configured"
      : "",
    settings.endpoint
      ? textConnectionState === "verified"
        ? "文字 API 已连接"
        : "文字 API 已配置"
      : "文字 API 未配置",
  );
  persistTextSettings();
  closeTextApiDialog();
  toast(settings.endpoint ? "文字接口设置已保存到当前电脑" : "文字接口设置已清空");
}

function clearTextSettings() {
  if (!window.confirm("确定清除保存在这台电脑上的文字 API 地址、Key 和高级设置吗？")) return;
  localStorage.removeItem(settingsStorageKey);
  applyTextSettings({
    endpoint: "",
    apiKey: "",
    model: "",
    protocol: "auto",
    proxyUrl: "",
    extraBody: "",
    extraHeaders: "",
    connectionStatus: "",
  });
  setTextApiTestResult("neutral", "本机文字 API 配置已清除");
}

function useDeepSeekPreset() {
  const previousOrigin = apiOrigin(textApiFields.endpoint.value);
  const nextOrigin = apiOrigin(DEEPSEEK_ENDPOINT);
  const providerChanged = Boolean(previousOrigin && previousOrigin !== nextOrigin);
  if (providerChanged) {
    textApiFields.apiKey.value = "";
    textApiFields.extraHeaders.value = "";
  }
  textApiFields.endpoint.value = DEEPSEEK_ENDPOINT;
  textApiFields.model.value = DEEPSEEK_NOTE_MODEL;
  textApiFields.protocol.value = "auto";
  textProviderOrigin = nextOrigin;
  setTextConnectionState("configured", "DeepSeek 待检测");
  renderDeepSeekPresetState();
  persistTextSettings();
  setTextApiTestResult(
    "neutral",
    providerChanged
      ? "已切换到 DeepSeek，旧服务商的 Key 已清除。请粘贴自己的 DeepSeek API Key。"
      : "已填写 DeepSeek 官方地址和笔记推荐模型，请粘贴自己的 API Key 后检测。",
  );
  textApiFields.apiKey.focus();
  toast("已选择 DeepSeek，请填写自己的 API Key");
}

async function copyNote() {
  if (!noteResult) return;
  const text = $("#notePublishOutput").value.trim() || noteToPublishText(noteResult, selectedTitleIndex);
  try {
    await navigator.clipboard.writeText(text);
    toast("标题、正文和标签已复制");
  } catch {
    toast("复制失败，请在发布文案框中手动复制");
  }
}

function downloadNote() {
  if (!noteResult) return;
  const text = $("#notePublishOutput").value.trim() || noteToPublishText(noteResult, selectedTitleIndex);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stem = (fields.sourceTitle.value.trim() || "课件笔记")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .slice(0, 60);
  anchor.href = url;
  anchor.download = `${stem}-小红书笔记.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("笔记文本已下载");
}

for (const field of Object.values(fields)) {
  field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
    updateInputStatus();
    renderKeywordCoverage();
    scheduleDraftSave();
  });
}

$("#noteImportCoursewareButton").addEventListener("click", importCurrentCourseware);
$("#writeCoursewareNoteButton").addEventListener("click", () => {
  if (importCurrentCourseware()) location.hash = "notes";
});
$("#generateNoteButton").addEventListener("click", () => generateNote());
$("#reviseNoteButton").addEventListener("click", () => generateNote({ revise: true }));
$("#regenerateNoteButton").addEventListener("click", () => generateNote({ variation: true }));
$("#suggestNoteKeywordsButton").addEventListener("click", suggestNoteKeywords);
$("#noteSaveButton").addEventListener("click", () => saveNoteDraft({ notify: true }));
$("#copyNoteButton").addEventListener("click", copyNote);
$("#downloadNoteButton").addEventListener("click", downloadNote);
$("#noteTextSettingsButton").addEventListener("click", openTextApiDialog);
$("#closeTextApiDialog").addEventListener("click", closeTextApiDialog);
$("#saveTextApiButton").addEventListener("click", saveTextSettings);
$("#clearTextApiButton").addEventListener("click", clearTextSettings);
$("#testTextApiButton").addEventListener("click", testTextConnection);
$("#textApiDeepSeekPreset").addEventListener("click", useDeepSeekPreset);
$("#toggleTextApiKey").addEventListener("click", () => {
  const visible = textApiFields.apiKey.type === "password";
  textApiFields.apiKey.type = visible ? "text" : "password";
  $("#toggleTextApiKey").textContent = visible ? "隐藏" : "显示";
});
$("#textApiEndpoint").addEventListener("input", () => {
  const nextOrigin = apiOrigin(textApiFields.endpoint.value);
  if (textProviderOrigin && nextOrigin && textProviderOrigin !== nextOrigin) {
    textApiFields.apiKey.value = "";
    textApiFields.extraHeaders.value = "";
    textConnectionState = "configured";
    textProviderOrigin = nextOrigin;
    setTextApiTestResult(
      "neutral",
      "已识别为新的文字 API 服务商，旧 Key 和额外请求头已自动清除。",
    );
  }
  if (
    isDeepSeekEndpoint(textApiFields.endpoint.value) &&
    needsDeepSeekModelUpgrade(textApiFields.model.value)
  ) {
    textApiFields.model.value = DEEPSEEK_NOTE_MODEL;
    textApiFields.protocol.value = "auto";
  }
  renderDeepSeekPresetState();
});

for (const field of [textApiFields.apiKey, textApiFields.model, textApiFields.protocol]) {
  field.addEventListener(field.tagName === "SELECT" ? "change" : "input", () => {
    if (textConnectionState === "verified") {
      setTextConnectionState("configured", "文字 API 参数已修改");
    }
  });
}
$("#notePublishOutput").addEventListener("input", (event) => {
  if (!noteResult) return;
  syncNoteFromPublishText(event.target.value);
  renderKeywordCoverage();
  scheduleDraftSave();
});
$("#textApiDialog").addEventListener("click", (event) => {
  if (event.target === $("#textApiDialog")) closeTextApiDialog();
});
window.addEventListener("open-note-api-settings", openTextApiDialog);
window.addEventListener("workspacechange", (event) => {
  if (event.detail?.workspace === "notes") {
    renderConnectionElement(
      textConnectionState,
      textConnectionLabel,
      $("#connectionState").dataset.textDescription || textConnectionLabel,
    );
  }
});

async function boot() {
  try {
    applyTextSettings(JSON.parse(localStorage.getItem(settingsStorageKey) || "null") || {});
  } catch {
    applyTextSettings({});
  }
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    mockTextMode = Boolean(config.mockTextMode);
    if (mockTextMode) setTextConnectionState("verified", "模拟文字 API 已连接");
  } catch {
    // The main app reports local service failures.
  }
  try {
    const draft = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (draft) restoreNoteDraft(draft);
    else {
      updateInputStatus();
      renderNoteResult();
    }
  } catch {
    updateInputStatus();
    renderNoteResult();
  }
}

boot();
