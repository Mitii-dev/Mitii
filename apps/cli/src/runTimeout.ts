/** Env fallback for automation / benchmark harnesses that cannot pass flags. */
export const RUN_TIMEOUT_ENV = 'MITII_RUN_TIMEOUT_SECONDS';

export type RunTimeoutResolution =
  | { ok: true; maxWallTimeMs?: number }
  | { ok: false; message: string };

function parseSeconds(raw: string | number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = typeof raw === 'number' ? raw : Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) return Number.NaN;
  return value;
}

/**
 * Resolve the host wall-time budget for one run. `--timeout <seconds>` wins
 * over `MITII_RUN_TIMEOUT_SECONDS`; neither set → engine default budget.
 */
export function resolveRunWallTimeMs(params: {
  flagSeconds?: number;
  env?: Readonly<Record<string, string | undefined>>;
}): RunTimeoutResolution {
  const fromFlag = parseSeconds(params.flagSeconds);
  if (fromFlag !== undefined) {
    return Number.isNaN(fromFlag)
      ? { ok: false, message: 'mitii: --timeout must be a positive number of seconds' }
      : { ok: true, maxWallTimeMs: Math.round(fromFlag * 1000) };
  }
  const envRaw = params.env?.[RUN_TIMEOUT_ENV];
  if (envRaw === undefined || envRaw.trim().length === 0) {
    return { ok: true };
  }
  const fromEnv = parseSeconds(envRaw);
  if (fromEnv === undefined || Number.isNaN(fromEnv)) {
    return {
      ok: false,
      message: `mitii: ${RUN_TIMEOUT_ENV} must be a positive number of seconds (got "${envRaw}")`,
    };
  }
  return { ok: true, maxWallTimeMs: Math.round(fromEnv * 1000) };
}
