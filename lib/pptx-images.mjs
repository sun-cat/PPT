import path from "node:path";
import JSZip from "jszip";

const SUPPORTED_IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["svg", "image/svg+xml"],
]);

function userError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function parsePptPageRange(value, totalPages) {
  const total = Number(totalPages);
  if (!Number.isInteger(total) || total < 1) {
    throw userError("PPTX 中没有可读取的页面。");
  }

  const raw = String(value || "").trim();
  if (!raw) return Array.from({ length: total }, (_, index) => index + 1);

  const result = new Set();
  const tokens = raw
    .replace(/[，、；;]/g, ",")
    .split(/[\s,]+/)
    .filter(Boolean);

  for (const token of tokens) {
    const single = token.match(/^(\d+)$/);
    const range = token.match(/^(\d+)\s*[-—~至]\s*(\d+)$/);
    if (!single && !range) {
      throw userError(`页码范围“${token}”格式不正确，请填写 1-5 或 1,3,6-9。`);
    }

    const start = Number(single?.[1] || range[1]);
    const end = Number(single?.[1] || range[2]);
    if (start < 1 || end < 1 || start > end) {
      throw userError(`页码范围“${token}”无效。`);
    }
    if (end > total) {
      throw userError(`PPTX 共 ${total} 页，页码范围不能超过第 ${total} 页。`);
    }
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      result.add(pageNumber);
    }
  }

  if (!result.size) throw userError("请填写需要提取的页码范围。");
  return [...result].sort((a, b) => a - b);
}

function slideNumber(filename) {
  return Number(filename.match(/slide(\d+)\.xml$/i)?.[1] || 0);
}

function attributesOf(xmlTag) {
  const attributes = {};
  for (const match of xmlTag.matchAll(/([\w:.-]+)\s*=\s*["']([^"']*)["']/g)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function resolveRelationshipTarget(slideFilename, target) {
  const normalized = path.posix.normalize(
    path.posix.join(path.posix.dirname(slideFilename), target),
  );
  return normalized.replace(/^\/+/, "");
}

function imageRelationshipMap(relsXml, slideFilename) {
  const relationships = new Map();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/gi)) {
    const attributes = attributesOf(match[0]);
    if (!/\/image$/i.test(attributes.Type || "")) continue;
    if (!attributes.Id || !attributes.Target) continue;
    relationships.set(
      attributes.Id,
      resolveRelationshipTarget(slideFilename, attributes.Target),
    );
  }
  return relationships;
}

function embeddedImageIds(slideXml) {
  return [...slideXml.matchAll(/<a:blip\b[^>]*\br:embed=["']([^"']+)["'][^>]*>/gi)].map(
    (match) => match[1],
  );
}

function imageMimeType(filename) {
  const extension = path.posix.extname(filename).slice(1).toLowerCase();
  return SUPPORTED_IMAGE_TYPES.get(extension) || "";
}

function slideRequiresRendering(slideXml) {
  const pictureCount = (slideXml.match(/<p:pic\b/gi) || []).length;
  const hasEditableDrawing = /<p:(?:sp|graphicFrame|grpSp|cxnSp|contentPart)\b/i.test(
    slideXml,
  );
  const hasEmbeddedObject = /<(?:p:oleObj|p:control|mc:AlternateContent)\b/i.test(slideXml);
  return pictureCount !== 1 || hasEditableDrawing || hasEmbeddedObject;
}

function validateRenderedPages(renderedPages, selectedPages) {
  const selectedSet = new Set(selectedPages);
  const pages = [];
  for (const page of Array.isArray(renderedPages) ? renderedPages : []) {
    const pageNumber = Number(page?.pageNumber);
    const dataUrl = String(page?.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
    if (!selectedSet.has(pageNumber) || !match || !match[2]) continue;
    pages.push({
      pageNumber,
      mimeType: match[1],
      byteLength: Buffer.from(match[2], "base64").length,
      dataUrl,
    });
  }
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

async function selectLargestImage(zip, filenames) {
  const candidates = [];
  for (const filename of new Set(filenames)) {
    const entry = zip.file(filename);
    const mimeType = imageMimeType(filename);
    if (!entry || !mimeType) continue;
    const buffer = await entry.async("nodebuffer");
    candidates.push({ filename, mimeType, buffer });
  }
  candidates.sort((a, b) => b.buffer.length - a.buffer.length);
  return candidates[0] || null;
}

export async function extractPptxPageImages(
  buffer,
  { pageRange = "", renderPages = null } = {},
) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
    throw userError("PPTX 文件为空或已损坏。");
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buffer, {
      checkCRC32: false,
      createFolders: false,
    });
  } catch {
    throw userError("无法读取这个文件。请确认文件是 .pptx，而不是旧版 .ppt。", 415);
  }

  const slideFiles = Object.keys(zip.files)
    .filter((filename) => /^ppt\/slides\/slide\d+\.xml$/i.test(filename))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (!slideFiles.length) {
    throw userError("这个文件中没有找到 PPTX 页面。", 415);
  }

  const selectedPages = parsePptPageRange(pageRange, slideFiles.length);
  const slideXmlByPage = new Map();
  const layeredPages = [];
  for (const pageNumber of selectedPages) {
    const slideXml = await zip.file(slideFiles[pageNumber - 1])?.async("string");
    if (slideXml) slideXmlByPage.set(pageNumber, slideXml);
    if (!slideXml || slideRequiresRendering(slideXml)) layeredPages.push(pageNumber);
  }

  if (layeredPages.length) {
    if (typeof renderPages !== "function") {
      throw userError(
        "这个 PPT 包含可编辑文字或多个图层，需要调用本机 PowerPoint 渲染完整页面。请在安装了桌面版 PowerPoint 的 Windows 电脑上重试。",
        422,
      );
    }
    const renderedPages = validateRenderedPages(
      await renderPages(buffer, {
        selectedPages,
        totalPages: slideFiles.length,
      }),
      selectedPages,
    );
    const renderedSet = new Set(renderedPages.map((page) => page.pageNumber));
    return {
      totalPages: slideFiles.length,
      selectedPages,
      pages: renderedPages,
      missingPages: selectedPages.filter((pageNumber) => !renderedSet.has(pageNumber)),
      extractionMode: "rendered",
      layeredPages,
    };
  }

  const pages = [];
  const missingPages = [];

  for (const pageNumber of selectedPages) {
    const slideFilename = slideFiles[pageNumber - 1];
    const slideXml = slideXmlByPage.get(pageNumber);
    const relsFilename = `${path.posix.dirname(slideFilename)}/_rels/${path.posix.basename(slideFilename)}.rels`;
    const relsXml = await zip.file(relsFilename)?.async("string");
    if (!slideXml || !relsXml) {
      missingPages.push(pageNumber);
      continue;
    }

    const relationships = imageRelationshipMap(relsXml, slideFilename);
    const referenced = embeddedImageIds(slideXml)
      .map((id) => relationships.get(id))
      .filter(Boolean);
    const filenames = referenced.length ? referenced : [...relationships.values()];
    const image = await selectLargestImage(zip, filenames);
    if (!image) {
      missingPages.push(pageNumber);
      continue;
    }

    pages.push({
      pageNumber,
      mimeType: image.mimeType,
      byteLength: image.buffer.length,
      dataUrl: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
    });
  }

  if (!pages.length) {
    throw userError(
      "没有提取到整页图片。该功能适用于本工具导出的“一页一张整图”PPTX；普通可编辑 PPT 请先导出为图片。",
      422,
    );
  }

  return {
    totalPages: slideFiles.length,
    selectedPages,
    pages,
    missingPages,
    extractionMode: "embedded",
    layeredPages: [],
  };
}
