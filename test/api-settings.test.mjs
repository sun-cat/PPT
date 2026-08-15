import test from "node:test";
import assert from "node:assert/strict";

import {
  apiOrigin,
  apiSettingsForLocalStorage,
  imageProviderMode,
  isVolcengineSeedreamEndpoint,
  isWukongStudioEndpoint,
  normalizeWukongApiKey,
  normalizeStoredConnectionStatus,
  sanitizeProviderOverrides,
  wukongEndpointForDisplay,
} from "../public/api-settings.js";

test("extracts an API provider origin", () => {
  assert.equal(apiOrigin("https://api.example.com/v1"), "https://api.example.com");
  assert.equal(apiOrigin("not a url"), "");
});

test("recognizes Wukong studio settings from the documented host or path", () => {
  assert.equal(isWukongStudioEndpoint("https://wkapi.work/v1"), true);
  assert.equal(
    isWukongStudioEndpoint("https://proxy.example.com/api/v1/studio"),
    true,
  );
  assert.equal(isWukongStudioEndpoint("https://api.example.com/v1"), false);
});

test("recognizes the official Volcengine Ark image provider", () => {
  assert.equal(
    isVolcengineSeedreamEndpoint("https://ark.cn-beijing.volces.com/api/v3"),
    true,
  );
  assert.equal(
    imageProviderMode("https://ark.cn-beijing.volces.com/api/v3/images/generations"),
    "volcengine-seedream",
  );
  assert.equal(imageProviderMode("https://api.example.com/v1"), "custom");
});

test("normalizes an accidentally duplicated Wukong key prefix", () => {
  assert.equal(normalizeWukongApiKey(" sk-sk-example "), "sk-example");
  assert.equal(normalizeWukongApiKey("sk-example"), "sk-example");
});

test("shows only the simple official Wukong address to learners", () => {
  assert.equal(
    wukongEndpointForDisplay("https://wkapi.work/api/v1/studio"),
    "https://wkapi.work",
  );
  assert.equal(wukongEndpointForDisplay("https://wkapi.work/v1"), "https://wkapi.work");
  assert.equal(
    wukongEndpointForDisplay("https://proxy.example.com/api/v1/studio"),
    "https://proxy.example.com/api/v1/studio",
  );
});

test("clears provider-specific overrides when switching providers", () => {
  const result = sanitizeProviderOverrides(
    {
      endpoint: "https://new.example.com/v1",
      testEndpoint: "https://old.example.com/v1/models",
      editEndpoint: "https://old.example.com/v1/images/edits",
      extraBody: '{"provider":"old"}',
      extraHeaders: '{"X-Old-Key":"secret"}',
      model: "gpt-image-2",
    },
    { previousEndpoint: "https://old.example.com/v1" },
  );

  assert.equal(result.providerChanged, true);
  assert.equal(result.settings.testEndpoint, "");
  assert.equal(result.settings.editEndpoint, "");
  assert.equal(result.settings.extraBody, "");
  assert.equal(result.settings.extraHeaders, "");
  assert.equal(result.settings.model, "gpt-image-2");
});

test("preserves intentional overrides owned by the current provider", () => {
  const result = sanitizeProviderOverrides(
    {
      endpoint: "https://api.example.com/v1",
      testEndpoint: "https://health.example.net/models",
      editEndpoint: "https://images.example.net/edits",
    },
    { ownerOrigin: "https://api.example.com" },
  );

  assert.equal(result.providerChanged, false);
  assert.equal(result.settings.testEndpoint, "https://health.example.net/models");
  assert.equal(result.settings.editEndpoint, "https://images.example.net/edits");
});

test("removes a stale cross-provider legacy test endpoint", () => {
  const result = sanitizeProviderOverrides({
    endpoint: "https://new.example.com/v1",
    testEndpoint: "https://old.example.com/v1/models",
  });

  assert.deepEqual(result.cleared, ["testEndpoint"]);
  assert.equal(result.settings.testEndpoint, "");
});

test("keeps the API key and compatibility fields for long-term local use", () => {
  const stored = apiSettingsForLocalStorage({
    endpoint: " https://api.example.com/v1 ",
    apiKey: "test-key",
    model: "gpt-image-2",
    extraHeaders: '{"X-Provider-Key":"local-secret"}',
    useSystemProxyForWukong: true,
  });

  assert.equal(stored.endpoint, "https://api.example.com/v1");
  assert.equal(stored.apiKey, "test-key");
  assert.equal(stored.extraHeaders, '{"X-Provider-Key":"local-secret"}');
  assert.equal(stored.useSystemProxyForWukong, true);
  assert.equal(stored.providerOrigin, "https://api.example.com");
  assert.equal(stored.connectionStatus, "pending");
});

test("persists only recognized API connection states", () => {
  assert.equal(normalizeStoredConnectionStatus("verified"), "verified");
  assert.equal(normalizeStoredConnectionStatus("reachable"), "reachable");
  assert.equal(normalizeStoredConnectionStatus("configured"), "configured");
  assert.equal(normalizeStoredConnectionStatus("error"), "pending");
  assert.equal(
    apiSettingsForLocalStorage(
      { endpoint: "https://wkapi.work/api/v1/studio" },
      { connectionStatus: "reachable" },
    ).connectionStatus,
    "reachable",
  );
});
