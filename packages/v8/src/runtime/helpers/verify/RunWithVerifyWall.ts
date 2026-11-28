/**
 * Race a verification runner promise against the verify wall (S12-TIME).
 */

export type VerifyWallResult<T> =
  | { timedOut: false; value: T }
  | { timedOut: true; elapsedMs: number };

/**
 * Await `work` or fail open as timed-out when `wallMs` elapses.
 * Clears the timer when work wins.
 */
export async function runWithVerifyWall<T>(params: {
  wallMs: number;
  work: Promise<T>;
}): Promise<VerifyWallResult<T>> {
  const wallMs = Math.max(1, params.wallMs);
  const started = Date.now();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), wallMs);
  });

  try {
    const raced = await Promise.race([
      params.work.then((value) => ({ kind: "ok" as const, value })),
      timeout,
    ]);
    if (raced.kind === "timeout") {
      return { timedOut: true, elapsedMs: Date.now() - started };
    }
    return { timedOut: false, value: raced.value };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
