import test from "node:test";
import assert from "node:assert/strict";
import PptxGenJS from "pptxgenjs";
import { buildImageOnlyPptx } from "../lib/presentation.mjs";
import { extractPptxPageImages, parsePptPageRange } from "../lib/pptx-images.mjs";

const redPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4Gf9QAAAABJRU5ErkJggg==";

async function buildEditablePptx() {
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  const slide = presentation.addSlide();
  slide.background = { color: "F2FBF7" };
  slide.addText("这是可编辑标题", {
    x: 0.8,
    y: 0.8,
    w: 5.6,
    h: 0.7,
    fontFace: "Microsoft YaHei",
    fontSize: 28,
    color: "145C52",
  });
  slide.addShape(presentation.ShapeType.roundRect, {
    x: 0.8,
    y: 2,
    w: 4,
    h: 2,
    fill: { color: "CDEFE4" },
    line: { color: "66B7A5" },
  });
  return Buffer.from(
    await presentation.write({ outputType: "nodebuffer", compression: true }),
  );
}

test("parses blank, single and ranged PPT page selections", () => {
  assert.deepEqual(parsePptPageRange("", 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(parsePptPageRange("1, 3-4，2", 5), [1, 2, 3, 4]);
  assert.throws(() => parsePptPageRange("2-8", 5), /不能超过第 5 页/);
});

test("extracts full-slide images from an image-only PPTX", async () => {
  const pptx = await buildImageOnlyPptx({
    slides: [
      { pageNumber: 1, imageDataUrl: redPng },
      { pageNumber: 2, imageDataUrl: redPng },
      { pageNumber: 3, imageDataUrl: redPng },
    ],
  });
  const result = await extractPptxPageImages(Buffer.from(pptx), { pageRange: "2-3" });
  assert.equal(result.totalPages, 3);
  assert.deepEqual(result.selectedPages, [2, 3]);
  assert.deepEqual(result.pages.map((page) => page.pageNumber), [2, 3]);
  assert.ok(result.pages.every((page) => page.dataUrl.startsWith("data:image/png;base64,")));
  assert.equal(result.extractionMode, "embedded");
});

test("renders the full slide when a PPTX contains editable layers", async () => {
  const pptx = await buildEditablePptx();
  let rendererCalled = false;
  const result = await extractPptxPageImages(pptx, {
    renderPages: async (_buffer, options) => {
      rendererCalled = true;
      assert.deepEqual(options.selectedPages, [1]);
      return [{ pageNumber: 1, dataUrl: redPng }];
    },
  });

  assert.equal(rendererCalled, true);
  assert.equal(result.extractionMode, "rendered");
  assert.deepEqual(result.layeredPages, [1]);
  assert.deepEqual(result.pages.map((page) => page.pageNumber), [1]);
});

test("does not silently extract one layer from an editable PPTX", async () => {
  const pptx = await buildEditablePptx();
  await assert.rejects(
    () => extractPptxPageImages(pptx),
    /需要调用本机 PowerPoint 渲染完整页面/,
  );
});
