const EPSILON = 1e-9;

export function hasDuplicatePageNumbers(numbers) {
  return new Set(numbers).size !== numbers.length;
}

export function parseFeaturedPageNumbers(rawValue, template, availablePageNumbers = []) {
  const requiredCount = template === "showcase" ? 1 : 3;
  const normalized = String(rawValue || "")
    .trim()
    .replace(/[，、；;]/g, ",")
    .replace(/[—~至]/g, "-")
    .replace(/\s+/g, "");
  const available = availablePageNumbers
    .map(Number)
    .filter((number) => Number.isInteger(number));
  const numbers = normalized
    ? normalized.split(",").filter(Boolean).map(Number)
    : available.slice(0, requiredCount);
  if (numbers.length !== requiredCount || numbers.some((number) => !Number.isInteger(number))) {
    throw new Error(template === "showcase"
      ? "顶部主视觉页码需要填写 1 个页码，例如 1。"
      : "重点大图页码需要填写 3 个页码，例如 1,2,3。");
  }
  if (hasDuplicatePageNumbers(numbers)) {
    throw new Error(template === "showcase"
      ? "顶部主视觉页码不能重复。"
      : "重点大图页码不能重复。");
  }
  const availableSet = new Set(available);
  const missing = numbers.filter((number) => !availableSet.has(number));
  if (missing.length) throw new Error(`第 ${missing.join("、")} 页不在已提取页面中。`);
  return numbers;
}

export function computeCollageLayout(width, height, smallPageCount = 11) {
  // A 3:4 cover can fit three 16:9 hero slides and eleven 16:9 thumbnails
  // almost edge to edge. Derive the right column from the full canvas height,
  // then give the remaining width to the thumbnail column so both columns
  // share one top/bottom alignment instead of being centered independently.
  const outer = Math.max(3, Math.round(width * 0.0037));
  const gap = Math.max(3, Math.round(width * 0.0037));
  const heroTop = outer;
  const heroHeight = (height - outer * 2 - gap * 2) / 3;
  const rightWidth = heroHeight * 16 / 9;
  const rightX = width - outer - rightWidth;
  const leftWidth = rightX - gap - outer;
  const count = Math.max(0, Math.min(11, Number(smallPageCount) || 0));
  const thumbHeight = leftWidth * 9 / 16;
  const thumbGap = count === 11
    ? Math.max(0, (height - outer * 2 - thumbHeight * count) / (count - 1))
    : gap;
  const stackHeight = count
    ? thumbHeight * count + thumbGap * Math.max(0, count - 1)
    : 0;
  const thumbTop = count === 11 ? outer : Math.max(outer, (height - stackHeight) / 2);
  return {
    outer,
    gap,
    leftWidth,
    rightX,
    rightWidth,
    heroHeight,
    heroTop,
    thumbHeight,
    thumbGap,
    thumbTop,
  };
}

export function computeShowcaseCollageLayout(width, height, gridPageCount = 12) {
  // A full-width 16:9 hero plus a 3 x 4 grid of 16:9 slides fits naturally
  // inside the same 3:4 cover. Use equal vertical seams so the last row ends
  // on the same bottom inset as the hero starts at the top.
  const outer = Math.max(3, Math.round(width * 0.0037));
  const columnGap = Math.max(3, Math.round(width * 0.0037));
  const heroX = outer;
  const heroY = outer;
  const heroWidth = width - outer * 2;
  const heroHeight = heroWidth * 9 / 16;
  const tileWidth = (heroWidth - columnGap * 2) / 3;
  const tileHeight = tileWidth * 9 / 16;
  const rowGap = Math.max(
    0,
    (height - outer * 2 - heroHeight - tileHeight * 4) / 4,
  );
  const gridTop = heroY + heroHeight + rowGap;
  const count = Math.max(0, Math.min(12, Number(gridPageCount) || 0));
  return {
    outer,
    columnGap,
    rowGap,
    heroX,
    heroY,
    heroWidth,
    heroHeight,
    gridTop,
    tileWidth,
    tileHeight,
    count,
  };
}

export function chunkSequential(items, size) {
  const safeItems = Array.isArray(items) ? items : [];
  const safeSize = Math.max(1, Math.floor(Number(size) || 1));
  const groups = [];
  for (let index = 0; index < safeItems.length; index += safeSize) {
    groups.push(safeItems.slice(index, index + safeSize));
  }
  return groups;
}

export function getBatchCollageGroupSize(layout = "theme-grid", gridCount = 4) {
  if (layout === "theme-grid") {
    return [4, 6, 9, 12].includes(Number(gridCount)) ? 1 + Number(gridCount) : 5;
  }
  const sizes = { two: 2, three: 3, four: 4, five: 5 };
  return sizes[layout] || 5;
}

function batchEdgeMetrics(width, edgeStyle) {
  if (edgeStyle === "flush") {
    return { outer: 4, gap: 5, radius: 2, shadow: false };
  }
  if (edgeStyle === "shadow") {
    return {
      outer: Math.round(width * 0.044),
      gap: Math.round(width * 0.026),
      radius: Math.round(width * 0.014),
      shadow: true,
    };
  }
  return {
    outer: Math.round(width * 0.026),
    gap: Math.round(width * 0.016),
    radius: Math.round(width * 0.008),
    shadow: false,
  };
}

function centeredRows(height, rowHeights, gap) {
  const totalHeight = rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0)
    + gap * Math.max(0, rowHeights.length - 1);
  let y = (height - totalHeight) / 2;
  return rowHeights.map((rowHeight) => {
    const rowY = y;
    y += rowHeight + gap;
    return rowY;
  });
}

function makeSlot(x, y, width) {
  return { x, y, width, height: width * 9 / 16 };
}

function gridSlots(width, columns, count, x, y, gap) {
  const tileWidth = (width - gap * (columns - 1)) / columns;
  const tileHeight = tileWidth * 9 / 16;
  return Array.from({ length: count }, (_, index) => ({
    x: x + (index % columns) * (tileWidth + gap),
    y: y + Math.floor(index / columns) * (tileHeight + gap),
    width: tileWidth,
    height: tileHeight,
  }));
}

export function computeBatchCollageLayout(
  width,
  height,
  {
    layout = "theme-grid",
    variant = "default",
    itemCount,
    gridCount = 4,
    edgeStyle = "classic",
  } = {},
) {
  const safeWidth = Math.max(1, Number(width) || 1080);
  const safeHeight = Math.max(1, Number(height) || 1440);
  const metrics = batchEdgeMetrics(safeWidth, edgeStyle);
  const innerWidth = safeWidth - metrics.outer * 2;
  const fullHeight = innerWidth * 9 / 16;
  const maxCount = getBatchCollageGroupSize(layout, gridCount);
  const count = Math.max(0, Math.min(maxCount, Number(itemCount) || maxCount));
  let slots = [];

  if (layout === "theme-grid") {
    const normalizedGridCount = [4, 6, 9, 12].includes(Number(gridCount))
      ? Number(gridCount)
      : 4;
    const gridItems = Math.max(0, Math.min(normalizedGridCount, count - 1));
    const columns = normalizedGridCount === 4 ? 2 : 3;
    const tileWidth = (innerWidth - metrics.gap * (columns - 1)) / columns;
    const tileHeight = tileWidth * 9 / 16;
    const rows = Math.ceil(gridItems / columns);
    const contentHeight = fullHeight
      + (gridItems ? metrics.gap + rows * tileHeight + Math.max(0, rows - 1) * metrics.gap : 0);
    const top = Math.max(metrics.outer, (safeHeight - contentHeight) / 2);
    if (count) slots.push(makeSlot(metrics.outer, top, innerWidth));
    if (gridItems) {
      slots.push(...gridSlots(
        innerWidth,
        columns,
        gridItems,
        metrics.outer,
        top + fullHeight + metrics.gap,
        metrics.gap,
      ));
    }
  } else if (layout === "two") {
    if (variant === "side-by-side") {
      const tileWidth = (innerWidth - metrics.gap) / 2;
      const tileHeight = tileWidth * 9 / 16;
      const top = (safeHeight - tileHeight) / 2;
      slots = gridSlots(innerWidth, 2, count, metrics.outer, top, metrics.gap);
    } else if (variant === "offset") {
      const tileWidth = innerWidth * 0.78;
      const tileHeight = tileWidth * 9 / 16;
      const step = tileHeight * 0.68;
      const top = (safeHeight - tileHeight - step * Math.max(0, count - 1)) / 2;
      slots = Array.from({ length: count }, (_, index) => makeSlot(
        index % 2 ? safeWidth - metrics.outer - tileWidth : metrics.outer,
        top + index * step,
        tileWidth,
      ));
    } else {
      const rowYs = centeredRows(safeHeight, Array(count).fill(fullHeight), metrics.gap);
      slots = rowYs.map((y) => makeSlot(metrics.outer, y, innerWidth));
    }
  } else if (layout === "three") {
    if (variant === "hero-bottom") {
      const tileWidth = (innerWidth - metrics.gap) / 2;
      const tileHeight = tileWidth * 9 / 16;
      const rowYs = centeredRows(safeHeight, [tileHeight, fullHeight], metrics.gap);
      slots = [
        ...gridSlots(innerWidth, 2, Math.min(2, count), metrics.outer, rowYs[0], metrics.gap),
        ...(count > 2 ? [makeSlot(metrics.outer, rowYs[1], innerWidth)] : []),
      ];
    } else if (variant === "cascade") {
      const tileWidth = innerWidth * 0.73;
      const tileHeight = tileWidth * 9 / 16;
      const step = tileHeight * 0.62;
      const top = (safeHeight - tileHeight - step * Math.max(0, count - 1)) / 2;
      slots = Array.from({ length: count }, (_, index) => makeSlot(
        index % 2 ? safeWidth - metrics.outer - tileWidth : metrics.outer,
        top + index * step,
        tileWidth,
      ));
    } else {
      const tileWidth = (innerWidth - metrics.gap) / 2;
      const tileHeight = tileWidth * 9 / 16;
      const rowYs = centeredRows(safeHeight, [fullHeight, tileHeight], metrics.gap);
      slots = [
        ...(count ? [makeSlot(metrics.outer, rowYs[0], innerWidth)] : []),
        ...(count > 1 ? gridSlots(innerWidth, 2, count - 1, metrics.outer, rowYs[1], metrics.gap) : []),
      ];
    }
  } else if (layout === "four") {
    if (variant === "hero-strip") {
      const tileWidth = (innerWidth - metrics.gap * 2) / 3;
      const tileHeight = tileWidth * 9 / 16;
      const rowYs = centeredRows(safeHeight, [fullHeight, tileHeight], metrics.gap);
      slots = [
        ...(count ? [makeSlot(metrics.outer, rowYs[0], innerWidth)] : []),
        ...(count > 1 ? gridSlots(innerWidth, 3, count - 1, metrics.outer, rowYs[1], metrics.gap) : []),
      ];
    } else if (variant === "cascade") {
      const tileWidth = innerWidth * 0.7;
      const tileHeight = tileWidth * 9 / 16;
      const step = tileHeight * 0.54;
      const top = (safeHeight - tileHeight - step * Math.max(0, count - 1)) / 2;
      slots = Array.from({ length: count }, (_, index) => makeSlot(
        index % 2 ? safeWidth - metrics.outer - tileWidth : metrics.outer,
        top + index * step,
        tileWidth,
      ));
    } else {
      const tileWidth = (innerWidth - metrics.gap) / 2;
      const tileHeight = tileWidth * 9 / 16;
      const rows = Math.ceil(count / 2);
      const contentHeight = rows * tileHeight + Math.max(0, rows - 1) * metrics.gap;
      slots = gridSlots(innerWidth, 2, count, metrics.outer, (safeHeight - contentHeight) / 2, metrics.gap);
    }
  } else {
    const tileWidth = (innerWidth - metrics.gap) / 2;
    const tileHeight = tileWidth * 9 / 16;
    const gridItems = Math.max(0, count - 1);
    const rows = Math.ceil(gridItems / 2);
    const contentHeight = fullHeight
      + (gridItems ? metrics.gap + rows * tileHeight + Math.max(0, rows - 1) * metrics.gap : 0);
    const top = Math.max(metrics.outer, (safeHeight - contentHeight) / 2);
    if (count) slots.push(makeSlot(metrics.outer, top, innerWidth));
    if (gridItems) {
      slots.push(...gridSlots(
        innerWidth,
        2,
        gridItems,
        metrics.outer,
        top + fullHeight + metrics.gap,
        metrics.gap,
      ));
    }
  }

  return { ...metrics, slots };
}

export function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

export function validatePerspectiveQuad(points) {
  if (!Array.isArray(points) || points.length !== 4) {
    return { valid: false, message: "请依次完成四个角的定位。" };
  }
  const area = Math.abs(polygonArea(points));
  if (area < 0.002) {
    return { valid: false, message: "四个角围成的区域太小，请重新定位。" };
  }

  const signs = [];
  for (let index = 0; index < 4; index += 1) {
    const value = cross(
      points[index],
      points[(index + 1) % 4],
      points[(index + 2) % 4],
    );
    if (Math.abs(value) < EPSILON) {
      return { valid: false, message: "相邻三个点不能在同一条直线上。" };
    }
    signs.push(Math.sign(value));
  }
  if (!signs.every((value) => value === signs[0])) {
    return {
      valid: false,
      message: "四边形发生交叉或点位顺序不正确，请按左上、右上、右下、左下重新定位。",
    };
  }
  return { valid: true, message: "" };
}

function solveLinearSystem(matrix, values) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) < EPSILON) {
      throw new Error("无法计算透视区域，请重新定位四个角。");
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) {
      augmented[column][item] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item <= size; item += 1) {
        augmented[row][item] -= factor * augmented[column][item];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

export function computeUnitSquareHomography(points) {
  const validation = validatePerspectiveQuad(points);
  if (!validation.valid) throw new Error(validation.message);
  const source = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const matrix = [];
  const values = [];
  for (let index = 0; index < 4; index += 1) {
    const u = source[index].x;
    const v = source[index].y;
    const x = points[index].x;
    const y = points[index].y;
    matrix.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    values.push(x);
    matrix.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    values.push(y);
  }
  const solved = solveLinearSystem(matrix, values);
  return [
    solved[0], solved[1], solved[2],
    solved[3], solved[4], solved[5],
    solved[6], solved[7], 1,
  ];
}

export function projectUnitPoint(homography, u, v) {
  const denominator = homography[6] * u + homography[7] * v + homography[8];
  if (Math.abs(denominator) < EPSILON) {
    throw new Error("透视区域包含无效位置，请重新定位。 ");
  }
  return {
    x: (homography[0] * u + homography[1] * v + homography[2]) / denominator,
    y: (homography[3] * u + homography[4] * v + homography[5]) / denominator,
  };
}

export function estimateQuadAspect(points, width = 1, height = 1) {
  const scaled = points.map((point) => ({ x: point.x * width, y: point.y * height }));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const horizontal = (distance(scaled[0], scaled[1]) + distance(scaled[3], scaled[2])) / 2;
  const vertical = (distance(scaled[0], scaled[3]) + distance(scaled[1], scaled[2])) / 2;
  return Math.max(0.2, Math.min(5, horizontal / Math.max(1, vertical)));
}

export function expandTriangleForOverlap(points, pixels = 0.9) {
  if (!Array.isArray(points) || points.length !== 3) return [];
  const amount = Math.max(0, Number(pixels) || 0);
  const center = points.reduce(
    (result, point) => ({ x: result.x + point.x / 3, y: result.y + point.y / 3 }),
    { x: 0, y: 0 },
  );
  return points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance < EPSILON || amount === 0) return { ...point };
    const scale = (distance + amount) / distance;
    return {
      x: center.x + dx * scale,
      y: center.y + dy * scale,
    };
  });
}

export function computeImageFitRect(
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  fitMode = "cover",
) {
  const safeSourceWidth = Number(sourceWidth);
  const safeSourceHeight = Number(sourceHeight);
  const safeTargetWidth = Number(targetWidth);
  const safeTargetHeight = Number(targetHeight);
  if (
    ![safeSourceWidth, safeSourceHeight, safeTargetWidth, safeTargetHeight]
      .every((value) => Number.isFinite(value) && value > 0)
  ) {
    throw new Error("图片和目标区域的尺寸必须大于 0。");
  }
  const mode = fitMode === "contain" ? "contain" : "cover";
  const widthScale = safeTargetWidth / safeSourceWidth;
  const heightScale = safeTargetHeight / safeSourceHeight;
  const scale = mode === "contain"
    ? Math.min(widthScale, heightScale)
    : Math.max(widthScale, heightScale);
  const width = safeSourceWidth * scale;
  const height = safeSourceHeight * scale;
  return {
    x: (safeTargetWidth - width) / 2,
    y: (safeTargetHeight - height) / 2,
    width,
    height,
    mode,
  };
}

export function resolvePerspectiveRasterAspect(
  sourceWidth,
  sourceHeight,
  estimatedQuadAspect,
  fitMode = "warp",
) {
  const sourceRatio = Number(sourceWidth) / Number(sourceHeight);
  if (!Number.isFinite(sourceRatio) || sourceRatio <= 0) {
    throw new Error("替换画面的尺寸无效。");
  }
  if (fitMode === "warp") return sourceRatio;
  return Math.max(0.2, Math.min(5, Number(estimatedQuadAspect) || sourceRatio));
}

export function computePerspectiveRasterSize(
  aspect,
  targetWidth,
  targetHeight,
  { minDimension = 480, maxDimension = 4096, oversample = 1.1 } = {},
) {
  const safeAspect = Math.max(0.2, Math.min(5, Number(aspect) || 16 / 9));
  const safeMinimum = Math.max(1, Math.round(Number(minDimension) || 1));
  const safeMaximum = Math.max(safeMinimum, Math.round(Number(maxDimension) || safeMinimum));
  const safeOversample = Math.max(1, Number(oversample) || 1);
  const desiredWidth = Math.max(
    Number(targetWidth) || 0,
    (Number(targetHeight) || 0) * safeAspect,
  ) * safeOversample;
  let width = Math.max(safeMinimum, Math.min(safeMaximum, Math.round(desiredWidth)));
  let height = Math.max(1, Math.round(width / safeAspect));
  if (height > safeMaximum) {
    height = safeMaximum;
    width = Math.max(1, Math.round(height * safeAspect));
  }
  return { width, height };
}

export function affineFromTriangles(source, destination) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const denominator =
    s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < EPSILON) return null;
  const a =
    (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) /
    denominator;
  const c =
    (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) /
    denominator;
  const e =
    (d0.x * (s1.x * s2.y - s2.x * s1.y) +
      d1.x * (s2.x * s0.y - s0.x * s2.y) +
      d2.x * (s0.x * s1.y - s1.x * s0.y)) /
    denominator;
  const b =
    (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) /
    denominator;
  const d =
    (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) /
    denominator;
  const f =
    (d0.y * (s1.x * s2.y - s2.x * s1.y) +
      d1.y * (s2.x * s0.y - s0.x * s2.y) +
      d2.y * (s0.x * s1.y - s1.x * s0.y)) /
    denominator;
  return { a, b, c, d, e, f };
}
