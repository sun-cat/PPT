import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeGenerationConcurrency,
  runConcurrentTasks,
} from "../public/generation-queue.js";

test("defaults generation concurrency to two and accepts safe presets", () => {
  assert.equal(normalizeGenerationConcurrency(undefined), 2);
  assert.equal(normalizeGenerationConcurrency("1"), 1);
  assert.equal(normalizeGenerationConcurrency("2"), 2);
  assert.equal(normalizeGenerationConcurrency("3"), 3);
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

test("batch guard stops taking new jobs after an upstream timeout", async () => {
  const started = [];
  let halted = false;
  const items = Array.from({ length: 12 }, (_, index) => index + 1);

  await runConcurrentTasks(
    items,
    async (item) => {
      if (halted) return false;
      started.push(item);
      if (item === 1) {
        await new Promise((resolve) => setTimeout(resolve, 4));
        halted = true;
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 12));
      return true;
    },
    3,
  );

  assert.deepEqual(started, [1, 2, 3]);
});
