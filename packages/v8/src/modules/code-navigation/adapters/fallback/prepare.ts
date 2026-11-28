import type {
  CodeNavigationCallOptions,
  CodeNavigationPort,
} from "../../contracts";

/** Port method: `prepare` (primary best-effort, then fallback). */
export async function fallbackPrepare(params: {
  primary: CodeNavigationPort;
  fallback: CodeNavigationPort;
  relativePath: string;
  options?: CodeNavigationCallOptions;
}): Promise<void> {
  try {
    await params.primary.prepare?.(params.relativePath, params.options);
  } catch {
    // Primary prepare failure must not block graph fallback.
  }
  await params.fallback.prepare?.(params.relativePath, params.options);
}
