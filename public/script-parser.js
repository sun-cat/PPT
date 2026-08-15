const PAGE_PATTERN = /^\s*第\s*(\d+)\s*页\s*[：:]?\s*$/;
const FIELD_PATTERN =
  /^\s*(页面标题|页面文字|画面提示词|画面描述|布局要求)\s*[：:]\s*(.*)$/;

function trimBlock(lines) {
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines.join("\n").trim();
}

function createPage(pageNumber) {
  return {
    pageNumber,
    titleLines: [],
    textLines: [],
    visualLines: [],
    activeField: null,
  };
}

function finalizePage(page) {
  if (!page) return null;
  return {
    pageNumber: page.pageNumber,
    title: trimBlock(page.titleLines),
    pageText: trimBlock(page.textLines),
    visualPrompt: trimBlock(page.visualLines),
  };
}

export function parseDeckScript(source) {
  const text = String(source || "").replace(/\r\n?/g, "\n").trim();
  if (!text) {
    throw new Error("请先粘贴页面脚本。");
  }

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
      if (rawLine.trim()) warnings.push(`已忽略页码标记之前的内容：${rawLine.trim()}`);
      continue;
    }

    const fieldMatch = rawLine.match(FIELD_PATTERN);
    if (fieldMatch) {
      const [, field, inlineValue] = fieldMatch;
      if (field === "页面标题") current.activeField = "titleLines";
      else if (field === "页面文字") current.activeField = "textLines";
      else current.activeField = "visualLines";
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
    throw new Error("没有识别到“第N页”格式，请检查页码标记。");
  }

  const seen = new Set();
  for (const page of pages) {
    if (seen.has(page.pageNumber)) warnings.push(`第 ${page.pageNumber} 页重复出现。`);
    seen.add(page.pageNumber);
    if (!page.title) warnings.push(`第 ${page.pageNumber} 页缺少页面标题。`);
    if (!page.pageText) warnings.push(`第 ${page.pageNumber} 页缺少页面文字。`);
  }

  const uniqueNumbers = Array.from(new Set(pages.map((page) => page.pageNumber))).sort(
    (a, b) => a - b,
  );
  if (uniqueNumbers[0] !== 1) {
    warnings.push(`页码从第 ${uniqueNumbers[0]} 页开始，建议确认是否缺少第 1 页。`);
  }
  const maxPage = uniqueNumbers.at(-1);
  const missing = [];
  for (let pageNumber = 1; pageNumber <= maxPage; pageNumber += 1) {
    if (!seen.has(pageNumber)) missing.push(pageNumber);
  }
  if (missing.length) {
    warnings.push(`页码不连续，缺少第 ${missing.join("、")} 页。`);
  }

  return { pages, warnings };
}
