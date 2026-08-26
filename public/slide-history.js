export const MAX_SLIDE_HISTORY = 6;

function createHistoryId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `slide-history-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStyleFields(fields = {}) {
  return {
    style: String(fields.style || "").trim(),
    elements: String(fields.elements || "").trim(),
    extra: String(fields.extra || "").trim(),
  };
}

export function createSlideHistorySnapshot(slide, styleFields = {}, options = {}) {
  if (!slide?.imageDataUrl) return null;
  return {
    id: String(options.id || createHistoryId()),
    createdAt: Number(options.createdAt || Date.now()),
    title: String(slide.title || ""),
    pageText: String(slide.pageText || ""),
    visualPrompt: String(slide.visualPrompt || ""),
    pageStylePrompt: String(slide.pageStylePrompt || ""),
    prompt: String(slide.prompt || ""),
    imageDataUrl: String(slide.imageDataUrl),
    styleFields: normalizeStyleFields(styleFields),
  };
}

export function prependSlideHistory(history, snapshot, limit = MAX_SLIDE_HISTORY) {
  const previous = Array.isArray(history) ? history : [];
  if (!snapshot?.imageDataUrl) return previous.slice(0, limit);
  return [
    snapshot,
    ...previous.filter((item) => item?.imageDataUrl && item.id !== snapshot.id),
  ].slice(0, limit);
}

export function prepareSlideHistoryRestore(slide, historyId, currentStyleFields = {}) {
  const history = Array.isArray(slide?.history) ? slide.history : [];
  const selected = history.find((item) => item.id === historyId);
  if (!selected?.imageDataUrl) {
    throw new Error("这个历史版本已经不存在，请重新打开历史记录。");
  }

  const remaining = history.filter((item) => item.id !== historyId);
  const current = createSlideHistorySnapshot(slide, currentStyleFields);
  return {
    selected,
    history: current
      ? prependSlideHistory(remaining, current)
      : remaining.slice(0, MAX_SLIDE_HISTORY),
  };
}
