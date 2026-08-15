import assert from "node:assert/strict";
import test from "node:test";
import { buildImageOnlyPptx, SLIDE_SIZE } from "../lib/presentation.mjs";

const onePixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4Gf9QAAAABJRU5ErkJggg==";

test("exports a non-empty 16:9 image-only PPTX", async () => {
  assert.equal(SLIDE_SIZE.width / SLIDE_SIZE.height, 16 / 9);
  const buffer = await buildImageOnlyPptx({
    slides: [{ imageDataUrl: onePixelPng }, { imageDataUrl: onePixelPng }],
  });
  assert.ok(buffer.length > 10_000);
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
});
