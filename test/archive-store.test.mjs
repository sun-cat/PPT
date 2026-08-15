import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { archiveStoreMetadata } from "../public/archive-store.js";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

test("uses separate IndexedDB stores for archive metadata and large project images", () => {
  assert.equal(archiveStoreMetadata.databaseName, "mini-hanghai-courseware-archive-v1");
  assert.equal(archiveStoreMetadata.projectStore, "projects");
  assert.equal(archiveStoreMetadata.summaryStore, "summaries");
});

test("serves and exposes the courseware time capsule UI", () => {
  assert.match(serverSource, /\["\/archive-store\.js"/);
  assert.match(indexSource, /id="archiveButton"/);
  assert.match(indexSource, /id="archiveDialog"/);
  assert.match(indexSource, /课件时光舱/);
});

test("archive redownload only uses the local PPT export route", () => {
  const start = appSource.indexOf("async function downloadArchivedPpt");
  const end = appSource.indexOf("async function removeArchivedProject", start);
  assert.ok(start >= 0 && end > start, "archive download function was not found");
  const downloadSource = appSource.slice(start, end);
  assert.match(downloadSource, /downloadPptxFile/);
  assert.doesNotMatch(downloadSource, /generate-image|generateOne|images\/generations/);
});
