import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const toolsSource = await readFile(new URL("../public/tools.js", import.meta.url), "utf8");
const noteToolSource = await readFile(new URL("../public/note-tool.js", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const sceneTemplateStoreSource = await readFile(
  new URL("../public/scene-template-store.js", import.meta.url),
  "utf8",
);

test("PPT collage and perspective tools do not read API credentials", () => {
  assert.doesNotMatch(toolsSource, /apiKey|IMAGE_API_KEY|Authorization|Bearer/i);
  assert.doesNotMatch(sceneTemplateStoreSource, /fetch\(|apiKey|Authorization|Bearer/i);
});

test("scene replacement queue accepts up to 18 images", () => {
  assert.match(toolsSource, /const MAX_REPLACEMENT_IMAGES = 18;/);
  assert.match(toolsSource, /MAX_REPLACEMENT_IMAGES - perspectiveState\.replacements\.length/);
});

test("scene replacement exports every uploaded image in one local ZIP", () => {
  assert.match(toolsSource, /const replacements = \[\.\.\.perspectiveState\.replacements\]/);
  assert.match(toolsSource, /for \(let index = 0; index < replacements\.length; index \+= 1\)/);
  assert.match(toolsSource, /createStoredZip\(entries\)/);
  assert.match(toolsSource, /批量导出 PNG/);
  assert.match(toolsSource, /批量导出 JPG/);
});

test("scene perspective rendering overlaps mesh clips and masks the outer screen edge", () => {
  assert.match(toolsSource, /expandTriangleForOverlap\(destinationPoints\)/);
  assert.match(toolsSource, /resolvePerspectiveRasterAspect\(/);
  assert.match(toolsSource, /computePerspectiveRasterSize\(rasterAspect, targetWidth, targetHeight\)/);
  assert.match(toolsSource, /options\.fitMode === "warp"/);
  assert.match(toolsSource, /context\.drawImage\(source, 0, 0, width, height\)/);
  assert.match(toolsSource, /globalCompositeOperation = "destination-in"/);
  assert.match(toolsSource, /imageSmoothingQuality = "high"/);
});

test("local tools only fetch the local PPT extraction route", () => {
  const fetchTargets = [...toolsSource.matchAll(/fetch\(\s*["'`]([^"'`]+)["'`]/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(fetchTargets, ["/api/extract-ppt-images"]);
  assert.doesNotMatch(toolsSource, /images\/generations|generate-image/i);
});

test("PPT extraction route only reads or locally renders the uploaded PPTX", () => {
  const start = serverSource.indexOf(
    'if (request.method === "POST" && url.pathname === "/api/extract-ppt-images")',
  );
  const end = serverSource.indexOf('if (request.method === "GET")', start);
  assert.ok(start >= 0 && end > start, "PPT extraction route was not found");
  const routeSource = serverSource.slice(start, end);
  assert.match(routeSource, /extractPptxPageImages/);
  assert.match(routeSource, /renderPptxPageImages/);
  assert.doesNotMatch(routeSource, /apiKey|Authorization|generateSlideImage|testImageApiConnection/i);
});

test("note drafts exclude text API credentials and generation only calls localhost routes", () => {
  const draftStart = noteToolSource.indexOf("function noteDraft()");
  const draftEnd = noteToolSource.indexOf("function saveNoteDraft", draftStart);
  assert.ok(draftStart >= 0 && draftEnd > draftStart, "note draft serializer was not found");
  const draftSource = noteToolSource.slice(draftStart, draftEnd);
  assert.doesNotMatch(draftSource, /apiKey|endpoint|extraHeaders|proxyUrl/);

  const fetchTargets = [...noteToolSource.matchAll(/fetch\(\s*["'`]([^"'`]+)["'`]/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(fetchTargets, ["/api/config"]);
  assert.match(noteToolSource, /postJson\(\s*["']\/api\/generate-note["']/);
  assert.match(noteToolSource, /postJson\(\s*["']\/api\/suggest-note-keywords["']/);
  assert.match(noteToolSource, /postJson\(\s*["']\/api\/test-text-connection["']/);
});
