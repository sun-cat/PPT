import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeGenerationConcurrency,
  runConcurrentTasks,
} from "../public/generation-queue.js";

test("defaults generation concurrency to two and accepts safe presets", () => {
  assert.equal(normalizeGenerationConcurrency(undefined), 2);
  assert.equal(normalizeGenerationConcurrency("2"), 2);
  assert.equal(normalizeGenerationConcurrency("4"), 4);
  assert.equal(normalizeGenerationConcurrency("6"), 6);
  assert.equal(normalizeGenerationConcurrency("20"), 2);
});

test("runs image jobs with the selected concurrency and preserves result order", async () => {
  let active = 0;
  let maxActive = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];

  const results = await runConcurrentTasks(
    items,
    async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active -= 1;
      return item * 10;
    },
    4,
  );

  assert.equal(maxActive, 4);
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70]);
});
