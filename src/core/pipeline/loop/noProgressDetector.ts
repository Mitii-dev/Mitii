/**
 * Detects tool churn / no-progress so the agent loop can force synthesis or advance.
 */

export interface ToolAttemptRecord {
  toolName: string;
  /** Normalized short fingerprint of args + error. */
  fingerprint: string;
  success: boolean;
  error?: string;
}

export interface NoProgressVerdict {
  stuck: boolean;
  reason?: string;
  /** Advise forcing synthesis / skipping further identical calls. */
  forceSynthesis: boolean;
}

const PHASE_LOCK_MARKERS = [
  'not available in this mode/phase',
  'file writes are locked until Phase',
  'Phase 4 (Verify) allows diagnostics',
  'allows only read-only shell commands',
];

export function fingerprintToolCall(toolName: string, args: unknown, error?: string): string {
  let argsKey = '';
  try {
    argsKey = JSON.stringify(args ?? {});
  } catch {
    argsKey = String(args);
  }
  if (argsKey.length > 200) argsKey = argsKey.slice(0, 200);
  const errKey = (error ?? '').slice(0, 120);
  return `${toolName}|${argsKey}|${errKey}`;
}

export function evaluateNoProgress(
  recent: ToolAttemptRecord[],
  options: { window?: number; maxIdenticalFailures?: number; maxProposeFileScope?: number } = {}
): NoProgressVerdict {
  const window = options.window ?? 8;
  const maxIdentical = options.maxIdenticalFailures ?? 2;
  const maxScope = options.maxProposeFileScope ?? 6;
  const slice = recent.slice(-window);

  if (slice.length === 0) return { stuck: false, forceSynthesis: false };

  // Identical failing fingerprint
  const failCounts = new Map<string, number>();
  for (const r of slice) {
    if (r.success) continue;
    failCounts.set(r.fingerprint, (failCounts.get(r.fingerprint) ?? 0) + 1);
  }
  for (const [fp, count] of failCounts) {
    if (count >= maxIdentical) {
      const isPhaseLock = PHASE_LOCK_MARKERS.some((m) => fp.includes(m));
      return {
        stuck: true,
        forceSynthesis: true,
        reason: isPhaseLock
          ? `Repeated phase-lock failure (${count}×). Stop retrying; synthesize or advance.`
          : `Repeated identical tool failure (${count}×). Change approach or synthesize.`,
      };
    }
  }

  const scopeCalls = slice.filter((r) => r.toolName === 'propose_file_scope');
  if (scopeCalls.length >= maxScope) {
    return {
      stuck: true,
      forceSynthesis: false,
      reason: `propose_file_scope called ${scopeCalls.length} times in the recent window — stop re-proposing scope and proceed with accepted paths.`,
    };
  }

  return { stuck: false, forceSynthesis: false };
}

export function isPhaseLockError(error?: string): boolean {
  if (!error) return false;
  return PHASE_LOCK_MARKERS.some((m) => error.includes(m));
}
