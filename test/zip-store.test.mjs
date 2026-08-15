import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createStoredZip } from "../public/zip-store.js";

test("createStoredZip creates a valid ZIP with ordered UTF-8 filenames", async () => {
  const archive = await createStoredZip(
    [
      { name: "场景透视换图-01-第一页.png", data: new Uint8Array([1, 2, 3]) },
      { name: "场景透视换图-02-第二页.jpg", data: new Blob([new Uint8Array([4, 5, 6, 7])]) },
    ],
    { date: new Date(2026, 7, 10, 12, 30, 0) },
  );
  const zip = await JSZip.loadAsync(await archive.arrayBuffer());
  assert.deepEqual(Object.keys(zip.files), [
    "场景透视换图-01-第一页.png",
    "场景透视换图-02-第二页.jpg",
  ]);
  assert.deepEqual(
    [...await zip.file("场景透视换图-01-第一页.png").async("uint8array")],
    [1, 2, 3],
  );
  assert.deepEqual(
    [...await zip.file("场景透视换图-02-第二页.jpg").async("uint8array")],
    [4, 5, 6, 7],
  );
});
