export const allowedGenerationConcurrency = [2, 4, 6];

export function normalizeGenerationConcurrency(value, fallback = 2) {
  const parsed = Number.parseInt(String(value), 10);
  return allowedGenerationConcurrency.includes(parsed) ? parsed : fallback;
}

export async function runConcurrentTasks(items, worker, concurrency = 2) {
  const taskItems = Array.from(items || []);
  if (!taskItems.length) return [];

  const workerCount = Math.min(
    normalizeGenerationConcurrency(concurrency),
    taskItems.length,
  );
  const results = new Array(taskItems.length);
  let cursor = 0;

  const runWorker = async () => {
    while (cursor < taskItems.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(taskItems[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}
