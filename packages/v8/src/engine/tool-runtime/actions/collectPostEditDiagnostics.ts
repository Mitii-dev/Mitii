import type { DiagnosticItem, DiagnosticsPort } from "../contracts";
import {
  DEFAULT_DIAGNOSTICS_SETTLE_POLL_MS,
  DEFAULT_DIAGNOSTICS_SETTLE_STABLE_READS,
  DEFAULT_DIAGNOSTICS_SETTLE_TIMEOUT_MS,
} from "../defaults";
import { filterNewDiagnostics } from "./filterNewDiagnostics";

export interface PostEditDiagnosticsSummary {
  /** Whether the host performed a settle wait (or no-op settle). */
  settled: boolean;
  /** New diagnostics relative to the pre-mutation baseline. */
  newDiagnostics: DiagnosticItem[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  hintCount: number;
  /**
   * True when new error-severity diagnostics appeared after the mutation.
   * Callers use this for repair nudges — it does not roll back the write.
   */
  requiresRepair: boolean;
}

export interface CollectPostEditDiagnosticsParams {
  diagnostics: DiagnosticsPort;
  workspaceRoot: string;
  /** Paths touched by the successful mutation. */
  changedPaths: readonly string[];
  baseline: readonly DiagnosticItem[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  stableReads?: number;
  signal?: AbortSignal;
}

/**
 * After a successful mutation: optionally settle host diagnostics, then
 * compute the delta vs the pre-edit baseline. Never throws — diagnostics
 * failures must not undo a successful write.
 */
export async function collectPostEditDiagnostics(
  params: CollectPostEditDiagnosticsParams,
): Promise<PostEditDiagnosticsSummary> {
  const empty: PostEditDiagnosticsSummary = {
    settled: false,
    newDiagnostics: [],
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    hintCount: 0,
    requiresRepair: false,
  };

  if (params.changedPaths.length === 0) {
    return empty;
  }

  let settled = false;
  try {
    await settleDiagnosticsPort(params.diagnostics, {
      workspaceRoot: params.workspaceRoot,
      paths: params.changedPaths,
      timeoutMs: params.timeoutMs ?? DEFAULT_DIAGNOSTICS_SETTLE_TIMEOUT_MS,
      pollIntervalMs:
        params.pollIntervalMs ?? DEFAULT_DIAGNOSTICS_SETTLE_POLL_MS,
      stableReads:
        params.stableReads ?? DEFAULT_DIAGNOSTICS_SETTLE_STABLE_READS,
      signal: params.signal,
    });
    settled = true;
  } catch {
    settled = false;
  }

  let after: DiagnosticItem[] = [];
  try {
    after = [
      ...(await params.diagnostics.readDiagnostics({
        workspaceRoot: params.workspaceRoot,
        paths: params.changedPaths,
      })),
    ];
  } catch {
    return { ...empty, settled };
  }

  const newDiagnostics = filterNewDiagnostics({
    after,
    baseline: params.baseline,
  });

  return summarizePostEditDiagnostics({ newDiagnostics, settled });
}

export function summarizePostEditDiagnostics(params: {
  newDiagnostics: readonly DiagnosticItem[];
  settled: boolean;
}): PostEditDiagnosticsSummary {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  let hintCount = 0;
  for (const item of params.newDiagnostics) {
    switch (item.severity) {
      case "error":
        errorCount += 1;
        break;
      case "warning":
        warningCount += 1;
        break;
      case "info":
        infoCount += 1;
        break;
      case "hint":
        hintCount += 1;
        break;
      default:
        break;
    }
  }
  return {
    settled: params.settled,
    newDiagnostics: [...params.newDiagnostics],
    errorCount,
    warningCount,
    infoCount,
    hintCount,
    requiresRepair: errorCount > 0,
  };
}

/**
 * Generic settle helper: prefer host `settleDiagnostics`, otherwise poll
 * `readDiagnostics` until consecutive snapshots match or timeout.
 */
export async function settleDiagnosticsPort(
  port: DiagnosticsPort,
  options: {
    workspaceRoot: string;
    paths?: readonly string[];
    timeoutMs: number;
    pollIntervalMs: number;
    stableReads: number;
    signal?: AbortSignal;
  },
): Promise<void> {
  if (port.settleDiagnostics) {
    await port.settleDiagnostics({
      workspaceRoot: options.workspaceRoot,
      paths: options.paths,
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
    });
    return;
  }

  const deadline = Date.now() + Math.max(0, options.timeoutMs);
  const requiredStable = Math.max(1, options.stableReads);
  let lastKey: string | undefined;
  let stableCount = 0;

  while (true) {
    if (options.signal?.aborted) {
      return;
    }
    const snapshot = await port.readDiagnostics({
      workspaceRoot: options.workspaceRoot,
      paths: options.paths,
    });
    const key = diagnosticsSnapshotKey(snapshot);
    if (key === lastKey) {
      stableCount += 1;
      if (stableCount >= requiredStable) {
        return;
      }
    } else {
      lastKey = key;
      stableCount = 1;
    }
    if (Date.now() >= deadline) {
      return;
    }
    await sleep(options.pollIntervalMs, options.signal);
  }
}

function diagnosticsSnapshotKey(
  items: readonly DiagnosticItem[],
): string {
  return items
    .map((d) =>
      [
        d.path,
        d.severity,
        d.message,
        d.startLine ?? "",
        d.startColumn ?? "",
        d.endLine ?? "",
        d.endColumn ?? "",
        d.source ?? "",
        d.code ?? "",
      ].join("\u001f"),
    )
    .sort()
    .join("\u001e");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
