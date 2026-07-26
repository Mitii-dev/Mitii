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

/**
 * Strip the output-wrangling idioms models reach for on retry (`2>&1`, `| head -N`, `| tail -N`,
 * `| cat`, `|| true`, `; echo $?`, temp-file redirects) so a command re-issued with a different
 * wrapper still fingerprints the same as its predecessor. Without this, `pnpm run build`,
 * `pnpm run build 2>&1`, and `pnpm run build 2>&1 | head -120` look like three distinct attempts
 * and the identical-failure counter never trips, letting the model burn dozens of calls retrying
 * the same underlying command under different syntax.
 */
function normalizeCommandForFingerprint(command: string): string {
  return command
    .replace(/\/tmp\/[^\s"']+/gi, '<tmp>')
    .replace(/\s+2>&1\b/gi, '')
    .replace(/\s*\|\|\s*(?:true|echo\b[^|;]*)/gi, '')
    .replace(/;\s*echo\s+["']?(?:exit(?:_code)?\s*[:=]\s*)?\$\?[^\n]*/gi, '')
    .replace(/\s*\|\s*(?:head|tail)(?:\s+(?:-n\s*)?-?\d+)?/gi, '')
    .replace(/\s*\|\s*cat\b/gi, '')
    // `npx tsc --noEmit`, `pnpm exec tsc --noEmit`, `yarn tsc --noEmit`, and bare `tsc --noEmit`
    // invoke the exact same binary with the exact same flags — only the package-manager
    // wrapper differs. Without collapsing these to one fingerprint, a model that switches
    // wrappers between retries (as models under repeated-failure pressure tend to) never
    // trips the identical-failure guard, and burns a fresh LLM call on each "new" wrapper.
    .replace(/^(?:npx\s+(?:--yes\s+)?|pnpm\s+(?:exec|dlx)\s+|yarn\s+(?:dlx\s+)?|npm\s+exec\s+(?:--\s+)?)(?=tsc\b)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprintToolCall(toolName: string, args: unknown, error?: string): string {
  let argsKey = '';
  try {
    if (
      toolName === 'run_command' &&
      args &&
      typeof args === 'object' &&
      typeof (args as Record<string, unknown>).command === 'string'
    ) {
      argsKey = normalizeCommandForFingerprint((args as Record<string, unknown>).command as string);
    } else {
      argsKey = JSON.stringify(args ?? {});
    }
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
