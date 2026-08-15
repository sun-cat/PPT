export function apiOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
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
    const url = new URL(raw);
    return url.hostname.toLowerCase() === "ark.cn-beijing.volces.com";
  } catch {
    return false;
  }
}

export function imageProviderMode(value) {
  if (isWukongStudioEndpoint(value)) return "wukong";
  if (isVolcengineSeedreamEndpoint(value)) return "volcengine-seedream";
  return "custom";
}

export function normalizeWukongApiKey(value) {
  const raw = String(value || "").trim();
  return raw.replace(/^(?:sk-){2,}/i, "sk-");
}

export function wukongEndpointForDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return ["wkapi.work", "wkapi.pro"].includes(url.hostname.toLowerCase())
      ? url.origin
      : raw;
  } catch {
    return raw;
  }
}

export function sanitizeProviderOverrides(
  settings = {},
  { previousEndpoint = "", ownerOrigin = "" } = {},
) {
  const sanitized = { ...settings };
  const nextOrigin = apiOrigin(settings.endpoint);
  const previousOrigin = apiOrigin(previousEndpoint);
  const normalizedOwner = apiOrigin(ownerOrigin);
  const providerChanged = Boolean(
    nextOrigin && previousOrigin && nextOrigin !== previousOrigin,
  );
  const ownershipMismatch = Boolean(
    nextOrigin && normalizedOwner && nextOrigin !== normalizedOwner,
  );
  const cleared = [];

  const clear = (key) => {
    if (!String(sanitized[key] || "").trim()) return;
    sanitized[key] = "";
    cleared.push(key);
  };

  if (providerChanged || ownershipMismatch) {
    for (const key of ["testEndpoint", "editEndpoint", "extraBody", "extraHeaders"]) {
      clear(key);
    }
  } else if (nextOrigin && !normalizedOwner) {
    // Legacy settings did not record which provider owned an override. A URL
    // pointing at another provider is much more likely to be stale than intentional.
    for (const key of ["testEndpoint", "editEndpoint"]) {
      const overrideOrigin = apiOrigin(sanitized[key]);
      if (overrideOrigin && overrideOrigin !== nextOrigin) clear(key);
    }
  }

  return {
    settings: sanitized,
    cleared,
    providerChanged: providerChanged || ownershipMismatch,
    ownerOrigin: nextOrigin,
  };
}

export function normalizeStoredConnectionStatus(value) {
  return ["verified", "reachable", "configured"].includes(String(value || ""))
    ? String(value)
    : "pending";
}

export function apiSettingsForLocalStorage(
  settings = {},
  { connectionStatus = "pending" } = {},
) {
  return {
    endpoint: String(settings.endpoint || "").trim(),
    editEndpoint: String(settings.editEndpoint || "").trim(),
    apiKey: String(settings.apiKey || ""),
    model: String(settings.model || "").trim(),
    size: String(settings.size || "").trim(),
    quality: String(settings.quality || ""),
    proxyUrl: String(settings.proxyUrl || "").trim(),
    useSystemProxyForWukong: Boolean(settings.useSystemProxyForWukong),
    testEndpoint: String(settings.testEndpoint || "").trim(),
    extraBody: String(settings.extraBody || "").trim(),
    extraHeaders: String(settings.extraHeaders || "").trim(),
    providerOrigin: apiOrigin(settings.endpoint),
    connectionStatus: normalizeStoredConnectionStatus(connectionStatus),
  };
}
