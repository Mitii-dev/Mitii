/** Detect soft-block / dedup tool responses that are intentional skips, not failures. */

const SKIP_MARKER = /^\(Skipped \S+ — reason:(\w+) — phase: \w+\)/;

export function isSkippedToolOutput(text?: string): boolean {
  return Boolean(
    text &&
      (SKIP_MARKER.test(text) ||
        /\bSkipped redundant\b|Skipped redundant tool call|cap reached for this task/i.test(text))
  );
}

/** Prefer typed skip metadata when available; fall back to legacy output markers. */
export function isSkippedToolResult(result: { skipped?: boolean; output?: string; error?: string }): boolean {
  if (result.skipped) return true;
  return isSkippedToolOutput(result.output ?? result.error);
}

const SKIP_REASON_LABELS: Record<string, string> = {
  scope: 'Blocked — file scope required',
  budget: 'Blocked — read budget exceeded',
  duplicate: 'Skipped — redundant call',
  cap: 'Blocked — cap reached',
  synthesis: 'Blocked — forcing synthesis',
};

/** Human-readable live-status label for a skipped/blocked tool result, based on its actual reason. */
export function describeSkipLabel(text?: string): string {
  if (!text) return 'Skipped tool call';
  const match = text.match(SKIP_MARKER);
  if (match) return SKIP_REASON_LABELS[match[1]] ?? 'Skipped tool call';
  if (/cap reached for this task/i.test(text)) return 'Blocked — cap reached';
  return 'Skipped — redundant call';
}
