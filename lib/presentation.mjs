import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs");

export const SLIDE_SIZE = { width: 1600, height: 900 };
const SLIDE_INCHES = { width: 13.333333, height: 7.5 };

function validateDataUrl(dataUrl) {
  const value = String(dataUrl || "");
  const match = value.match(/^data:(image\/[^;]+);base64,(.+)$/s);
  if (!match) throw new Error("存在无效的图片数据，无法导出 PPT。");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) throw new Error("存在空图片，无法导出 PPT。");
  return value;
}

export async function buildImageOnlyPptx({ slides }) {
  if (!Array.isArray(slides) || !slides.length) {
    throw new Error("至少需要一张已生成的图片才能导出 PPT。");
  }

  const presentation = new PptxGenJS();
  presentation.defineLayout({
    name: "IMAGE2_WIDE",
    width: SLIDE_INCHES.width,
    height: SLIDE_INCHES.height,
  });
  presentation.layout = "IMAGE2_WIDE";
  presentation.author = "生财有术mini航海原创PPT课件";
  presentation.subject = "16:9 image-only presentation";
  presentation.title = "生财有术mini航海原创PPT课件";
  presentation.company = "";
  presentation.lang = "zh-CN";

  slides.forEach((item, index) => {
    const data = validateDataUrl(item.imageDataUrl);
    const slide = presentation.addSlide();
    slide.background = { color: "000000" };
    slide.addImage({
      data,
      x: 0,
      y: 0,
      w: SLIDE_INCHES.width,
      h: SLIDE_INCHES.height,
      sizing: {
        type: "cover",
        w: SLIDE_INCHES.width,
        h: SLIDE_INCHES.height,
      },
      altText: `第 ${index + 1} 页完整画面`,
      objectName: `slide-image-${String(index + 1).padStart(2, "0")}`,
    });
  });

  const output = await presentation.write({
    outputType: "nodebuffer",
    compression: true,
  });
  return Buffer.from(output);
}
