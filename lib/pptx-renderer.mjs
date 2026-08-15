import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const renderScript = path.join(moduleDir, "..", "scripts", "render-pptx-pages.ps1");
let renderQueue = Promise.resolve();

function rendererError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeTemporaryRoot(tempRoot) {
  const base = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  return path.resolve(tempRoot).toLowerCase().startsWith(base);
}

async function renderWithPowerPoint(buffer, { selectedPages = [] } = {}) {
  if (process.platform !== "win32") {
    throw rendererError(
      "可编辑 PPT 需要完整页面渲染。当前版本请在安装了桌面版 Microsoft PowerPoint 的 Windows 电脑上使用；一页一图 PPT 不受影响。",
    );
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mini-ppt-render-"));
  const inputPath = path.join(tempRoot, "input.pptx");
  const outputDir = path.join(tempRoot, "pages");
  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(inputPath, buffer);
    const powershellPath = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    try {
      await execFileAsync(
        powershellPath,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          renderScript,
          "-InputPath",
          inputPath,
          "-OutputDir",
          outputDir,
        ],
        {
          timeout: 180_000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      );
    } catch (error) {
      if (error?.killed || error?.signal) {
        throw rendererError("PowerPoint 页面渲染超时，请关闭占用中的 PowerPoint 窗口后重试。", 504);
      }
      throw rendererError(
        "无法调用本机 PowerPoint 渲染可编辑页面。请确认已安装并激活桌面版 Microsoft PowerPoint，然后关闭弹窗或受保护视图后重试。",
      );
    }

    const pages = [];
    for (const pageNumber of selectedPages) {
      const filename = `slide-${String(pageNumber).padStart(4, "0")}.png`;
      try {
        const image = await readFile(path.join(outputDir, filename));
        if (!image.length) continue;
        pages.push({
          pageNumber,
          dataUrl: `data:image/png;base64,${image.toString("base64")}`,
        });
      } catch {
        // Missing pages are reported by the caller without discarding successful pages.
      }
    }
    if (!pages.length) {
      throw rendererError("PowerPoint 已打开文件，但没有导出任何页面图片。请确认文件可以正常放映后重试。");
    }
    return pages;
  } finally {
    if (safeTemporaryRoot(tempRoot)) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export function renderPptxPageImages(buffer, options = {}) {
  const job = renderQueue.then(() => renderWithPowerPoint(buffer, options));
  renderQueue = job.catch(() => undefined);
  return job;
}
