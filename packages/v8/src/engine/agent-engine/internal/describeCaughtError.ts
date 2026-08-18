/**
 * Renders a caught error for a warning/log message without losing its
 * identity the way `String(error)` does. Node fs/network errors carry a
 * `.code` (ENOENT, EACCES, ETIMEDOUT, ...) that is the single most useful
 * fact for diagnosing a swallowed failure; `String(error)` drops it.
 */
export function describeCaughtError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    const base = error.message || error.name || "Error";
    return code && !base.includes(code) ? `${base} (${code})` : base;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
