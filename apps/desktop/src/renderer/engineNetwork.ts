/**
 * Local engine HTTP can briefly fail while apply_patch / FS watch bursts
 * saturate the single-threaded Node process ("Failed to fetch" in Chromium).
 */

const TRANSIENT_ENGINE_NETWORK =
  /failed to fetch|network\s*error|networkerror|load failed|econnrefused|econnreset|socket hang up/i;

export function isTransientEngineNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError && TRANSIENT_ENGINE_NETWORK.test(err.message)) {
    return true;
  }
  if (err instanceof Error) {
    return (
      TRANSIENT_ENGINE_NETWORK.test(err.message) ||
      TRANSIENT_ENGINE_NETWORK.test(err.name)
    );
  }
  return TRANSIENT_ENGINE_NETWORK.test(String(err));
}

/** Retry transient engine blips; rethrow non-transient failures immediately. */
export async function withEngineFetchRetry<T>(
  run: () => Promise<T>,
  options?: { attempts?: number; delayMs?: number },
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 3);
  const delayMs = Math.max(0, options?.delayMs ?? 120);
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await run();
    } catch (err) {
      last = err;
      if (!isTransientEngineNetworkError(err) || i === attempts - 1) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}
