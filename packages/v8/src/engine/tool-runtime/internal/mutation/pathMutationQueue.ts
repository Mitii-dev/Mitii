/**
 * Serialize mutations that touch the same relative path (concurrent tools).
 * Distinct paths still run in parallel. Deadlock-safe: acquire keys sorted.
 */

const pathQueues = new Map<string, Promise<unknown>>();

export async function withPathMutationQueue<T>(
  relativePaths: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const keys = [
    ...new Set(
      relativePaths
        .map((path) => path.trim())
        .filter((path) => path.length > 0),
    ),
  ].sort();

  if (keys.length === 0) {
    return fn();
  }

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const prior = Promise.all(keys.map((key) => pathQueues.get(key))).then(
    () => undefined,
  );

  const chained = prior.then(() => gate);
  for (const key of keys) {
    pathQueues.set(key, chained);
  }

  await prior;
  try {
    return await fn();
  } finally {
    release();
    for (const key of keys) {
      if (pathQueues.get(key) === chained) {
        pathQueues.delete(key);
      }
    }
  }
}

/** Test helper: clear queue state between specs. */
export function resetPathMutationQueuesForTests(): void {
  pathQueues.clear();
}
