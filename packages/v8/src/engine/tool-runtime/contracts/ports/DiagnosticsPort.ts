export interface DiagnosticItem {
  path: string;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  source?: string;
  code?: string;
}

/**
 * Options for waiting until host diagnostics for paths are stable.
 * Timeouts and poll intervals come from Tool Runtime defaults or host policy —
 * callers must not invent language-specific wait heuristics here.
 */
export interface DiagnosticsSettleOptions {
  workspaceRoot: string;
  paths?: readonly string[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

/**
 * Host Problems / language-service diagnostics.
 *
 * `settleDiagnostics` is optional: hosts with async analyzers wait until the
 * diagnostic set for the given paths is stable or the timeout elapses.
 * Synchronous adapters may omit it (immediate read is correct).
 */
export interface DiagnosticsPort {
  readDiagnostics(params: {
    workspaceRoot: string;
    paths?: readonly string[];
  }): Promise<DiagnosticItem[]>;

  settleDiagnostics?(options: DiagnosticsSettleOptions): Promise<void>;
}
