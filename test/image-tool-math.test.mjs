import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCollageLayout,
  computeImageFitRect,
  computePerspectiveRasterSize,
  computeShowcaseCollageLayout,
  computeUnitSquareHomography,
  expandTriangleForOverlap,
  hasDuplicatePageNumbers,
  parseFeaturedPageNumbers,
  projectUnitPoint,
  resolvePerspectiveRasterAspect,
  validatePerspectiveQuad,
} from "../public/image-tool-math.js";

test("uses a compact near-seamless collage grid", () => {
  const layout = computeCollageLayout(1080, 1440, 11);
  assert.ok(layout.outer <= 4);
  assert.ok(layout.gap <= 4);
  assert.equal(layout.heroTop, layout.outer);
  assert.equal(layout.thumbTop, layout.outer);
  assert.ok(Math.abs(layout.heroHeight / layout.rightWidth - 9 / 16) < 1e-10);
  assert.ok(Math.abs(layout.thumbHeight / layout.leftWidth - 9 / 16) < 1e-10);
  assert.ok(Math.abs(layout.rightX + layout.rightWidth + layout.outer - 1080) < 1e-8);
  assert.ok(Math.abs(layout.heroTop + layout.heroHeight * 3 + layout.gap * 2 + layout.outer - 1440) < 1e-8);
  assert.ok(layout.thumbGap <= 4.6);
  assert.ok(Math.abs(layout.thumbTop + layout.thumbHeight * 11 + layout.thumbGap * 10 + layout.outer - 1440) < 1e-8);
});

test("keeps shorter thumbnail stacks compact and vertically centered", () => {
  const layout = computeCollageLayout(1080, 1440, 8);
  assert.equal(layout.thumbGap, layout.gap);
  assert.ok(layout.thumbTop > layout.outer);
  assert.ok(layout.thumbTop + layout.thumbHeight * 8 + layout.thumbGap * 7 < 1440 - layout.outer);
});

test("lays out a full-width 16:9 hero above a 3 by 4 slide matrix", () => {
  const layout = computeShowcaseCollageLayout(1080, 1440, 12);
  assert.equal(layout.count, 12);
  assert.ok(Math.abs(layout.heroHeight / layout.heroWidth - 9 / 16) < 1e-10);
  assert.ok(Math.abs(layout.tileHeight / layout.tileWidth - 9 / 16) < 1e-10);
  assert.ok(Math.abs(layout.heroX + layout.heroWidth + layout.outer - 1080) < 1e-8);
  assert.ok(Math.abs(layout.outer + layout.tileWidth * 3 + layout.columnGap * 2 + layout.outer - 1080) < 1e-8);
  assert.ok(Math.abs(layout.gridTop + layout.tileHeight * 4 + layout.rowGap * 3 + layout.outer - 1440) < 1e-8);
  assert.ok(layout.rowGap <= 8);
});

test("accepts one showcase page while still rejecting true duplicate page numbers", () => {
  assert.equal(hasDuplicatePageNumbers([1]), false);
  assert.equal(hasDuplicatePageNumbers([1, 2, 3]), false);
  assert.equal(hasDuplicatePageNumbers([1, 1, 3]), true);
});

test("showcase accepts page 1 without raising the classic three-page duplicate error", () => {
  assert.deepEqual(parseFeaturedPageNumbers("1", "showcase", [1, 2, 3, 4]), [1]);
  assert.deepEqual(parseFeaturedPageNumbers("1,2,3", "classic", [1, 2, 3, 4]), [1, 2, 3]);
  assert.throws(
    () => parseFeaturedPageNumbers("1,1,3", "classic", [1, 2, 3, 4]),
    /重点大图页码不能重复/,
  );
});

const quad = [
  { x: 0.1, y: 0.2 },
  { x: 0.85, y: 0.1 },
  { x: 0.92, y: 0.82 },
  { x: 0.18, y: 0.9 },
];

test("accepts a convex four-point perspective region", () => {
  assert.equal(validatePerspectiveQuad(quad).valid, true);
});

test("rejects an intersecting perspective region", () => {
  const invalid = [quad[0], quad[2], quad[1], quad[3]];
  assert.equal(validatePerspectiveQuad(invalid).valid, false);
});

test("maps all unit-square corners to the requested quadrilateral", () => {
  const homography = computeUnitSquareHomography(quad);
  const sourceCorners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  sourceCorners.forEach(([u, v], index) => {
    const projected = projectUnitPoint(homography, u, v);
    assert.ok(Math.abs(projected.x - quad[index].x) < 1e-8);
    assert.ok(Math.abs(projected.y - quad[index].y) < 1e-8);
  });
});

test("supports the five common screen perspective directions", () => {
  const scenarios = {
    正面屏幕: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
    向左倾斜: [
      { x: 0.22, y: 0.1 },
      { x: 0.86, y: 0.2 },
      { x: 0.8, y: 0.82 },
      { x: 0.1, y: 0.9 },
    ],
    向右倾斜: [
      { x: 0.12, y: 0.2 },
      { x: 0.8, y: 0.1 },
      { x: 0.92, y: 0.9 },
      { x: 0.2, y: 0.82 },
    ],
    上宽下窄: [
      { x: 0.08, y: 0.1 },
      { x: 0.92, y: 0.1 },
      { x: 0.76, y: 0.9 },
      { x: 0.24, y: 0.9 },
    ],
    上窄下宽: [
      { x: 0.24, y: 0.1 },
      { x: 0.76, y: 0.1 },
      { x: 0.92, y: 0.9 },
      { x: 0.08, y: 0.9 },
    ],
  };

  for (const [name, points] of Object.entries(scenarios)) {
    assert.equal(validatePerspectiveQuad(points).valid, true, name);
    const homography = computeUnitSquareHomography(points);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], index) => {
      const projected = projectUnitPoint(homography, u, v);
      assert.ok(Math.abs(projected.x - points[index].x) < 1e-8, `${name} x`);
      assert.ok(Math.abs(projected.y - points[index].y) < 1e-8, `${name} y`);
    });
  }
});

test("expands perspective mesh triangles so neighboring clips overlap", () => {
  const triangle = [
    { x: 10, y: 10 },
    { x: 110, y: 10 },
    { x: 10, y: 90 },
  ];
  const expanded = expandTriangleForOverlap(triangle, 1);
  const center = triangle.reduce(
    (result, point) => ({ x: result.x + point.x / 3, y: result.y + point.y / 3 }),
    { x: 0, y: 0 },
  );
  expanded.forEach((point, index) => {
    assert.ok(
      Math.hypot(point.x - center.x, point.y - center.y) >
        Math.hypot(triangle[index].x - center.x, triangle[index].y - center.y),
    );
  });
});

test("cover fit always fills the target screen without exposed matte edges", () => {
  const fit = computeImageFitRect(2560, 1440, 1600, 1000, "cover");
  assert.ok(fit.x <= 0);
  assert.ok(fit.y <= 0);
  assert.ok(fit.x + fit.width >= 1600);
  assert.ok(fit.y + fit.height >= 1000);
  assert.equal(fit.mode, "cover");
});

test("contain fit preserves the whole image and may intentionally leave bars", () => {
  const fit = computeImageFitRect(2560, 1440, 1600, 1000, "contain");
  assert.equal(fit.x, 0);
  assert.ok(fit.y > 0);
  assert.equal(fit.width, 1600);
  assert.ok(fit.height < 1000);
  assert.equal(fit.mode, "contain");
});

test("warp mode keeps the replacement image aspect so the full page reaches all four corners", () => {
  assert.equal(resolvePerspectiveRasterAspect(2560, 1440, 1.41, "warp"), 16 / 9);
  assert.equal(resolvePerspectiveRasterAspect(2560, 1440, 1.41, "cover"), 1.41);
});

test("sizes perspective source rasters from the real screen pixels with a safe cap", () => {
  assert.deepEqual(computePerspectiveRasterSize(16 / 9, 2400, 1200), {
    width: 2640,
    height: 1485,
  });
  const capped = computePerspectiveRasterSize(16 / 9, 6000, 3400);
  assert.equal(capped.width, 4096);
  assert.equal(capped.height, 2304);
});
