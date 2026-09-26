/**
 * Yield so host HTTP / UI (explorer open, tree reload) can run between
 * sync better-sqlite3 / analysis bursts on the same Node thread.
 * Every `macrotaskEvery` files, use setTimeout(0) so queued I/O is flushed.
 */
export async function yieldIndexingEventLoop(
  processedCount: number,
  macrotaskEvery = 4,
): Promise<void> {
  if (processedCount > 0 && processedCount % macrotaskEvery === 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    return;
  }
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
