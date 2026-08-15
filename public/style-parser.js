const PAGE_PATTERN = /^\s*第\s*(\d+)\s*页\s*[：:]?\s*$/;
const FIELD_PATTERN =
  /^\s*(画面风格|页面风格|视觉风格|添加元素|画面元素|补充要求)\s*[：:]\s*(.*)$/;

function trimBlock(lines) {
  return lines.join("\n").trim();
}

function createPage(pageNumber) {
  return {
    pageNumber,
    styleLines: [],
    elementLines: [],
    extraLines: [],
    activeField: null,
  };
}

function finalizePage(page) {
  if (!page) return null;
  const style = trimBlock(page.styleLines);
  const elements = trimBlock(page.elementLines);
  const extra = trimBlock(page.extraLines);
  const prompt = [
    style ? `本页画面风格：\n${style}` : "",
    elements ? `本页需要添加的视觉元素：\n${elements}` : "",
    extra ? `本页补充要求：\n${extra}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    pageNumber: page.pageNumber,
    style,
    elements,
    extra,
    prompt,
  };
}

export function parsePageStyleScript(source) {
  const text = String(source || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { pages: [], warnings: [] };

  const pages = [];
  const warnings = [];
  let current = null;

  for (const rawLine of text.split("\n")) {
    const pageMatch = rawLine.match(PAGE_PATTERN);
    if (pageMatch) {
      const finished = finalizePage(current);
      if (finished) pages.push(finished);
      current = createPage(Number.parseInt(pageMatch[1], 10));
      continue;
    }

    if (!current) {
      if (rawLine.trim()) {
        warnings.push(`已忽略页码标记之前的内容：${rawLine.trim()}`);
      }
      continue;
    }

    const fieldMatch = rawLine.match(FIELD_PATTERN);
    if (fieldMatch) {
      const [, field, inlineValue] = fieldMatch;
      if (["画面风格", "页面风格", "视觉风格"].includes(field)) {
        current.activeField = "styleLines";
      } else if (["添加元素", "画面元素"].includes(field)) {
        current.activeField = "elementLines";
      } else {
        current.activeField = "extraLines";
      }
      if (inlineValue) current[current.activeField].push(inlineValue);
      continue;
    }

    if (current.activeField) {
      current[current.activeField].push(rawLine);
    } else if (rawLine.trim()) {
      warnings.push(`第 ${current.pageNumber} 页有未归类内容：${rawLine.trim()}`);
    }
  }

  const finished = finalizePage(current);
  if (finished) pages.push(finished);
  if (!pages.length) {
    throw new Error("没有识别到“第N页”，请按照示例填写逐页要求。");
  }

  const seen = new Set();
  for (const page of pages) {
    if (seen.has(page.pageNumber)) {
      warnings.push(`第 ${page.pageNumber} 页的画面要求重复出现，后面的内容会合并使用。`);
    }
    seen.add(page.pageNumber);
    if (!page.prompt) {
      warnings.push(`第 ${page.pageNumber} 页没有填写画面风格或添加元素。`);
    }
  }

  return { pages, warnings };
}
