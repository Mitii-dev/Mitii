/**
 * Parse write-tool summaries and build chat-facing file-change views.
 */

export const WRITE_TOOLS = new Set([
  'apply_patch',
  'delete_file',
  'delete_directory',
  'move_file',
]);

export interface DesktopFileChangeEntry {
  path: string;
  status: 'A' | 'M' | 'D' | '?';
  additions: number;
  deletions: number;
  patchPreview?: string;
}

export interface DesktopFileChanges {
  runId?: string;
  files: DesktopFileChangeEntry[];
  totalAdditions: number;
  totalDeletions: number;
}

export function parsePathsFromToolSummary(
  summary: string | undefined,
): string[] {
  if (!summary) return [];
  const found: string[] = [];

  const pathsMatch = /\bpaths=([^\s]+)/i.exec(summary);
  if (pathsMatch?.[1] && pathsMatch[1] !== 'none') {
    for (const part of pathsMatch[1].split(',')) {
      const trimmed = part.trim();
      if (trimmed.length > 0 && !trimmed.startsWith('+')) {
        found.push(trimmed);
      }
    }
  }

  const singlePath = /\bpath=([^\s]+)/i.exec(summary);
  if (singlePath?.[1]) found.push(singlePath[1]);

  const fromPath = /\bfrom=([^\s]+)/i.exec(summary);
  if (fromPath?.[1]) found.push(fromPath[1]);

  const toPath = /\bto=([^\s]+)/i.exec(summary);
  if (toPath?.[1]) found.push(toPath[1]);

  return [
    ...new Set(
      found
        .map((path) => path.replace(/\\/g, '/').trim())
        .filter((path) => path.length > 0),
    ),
  ];
}

export function collectMutatedPathsFromEvent(event: unknown): string[] {
  if (!event || typeof event !== 'object') return [];
  const e = event as Record<string, unknown>;
  const type = e.type;
  if (type !== 'tool_started' && type !== 'tool_completed') return [];
  const toolName = typeof e.toolName === 'string' ? e.toolName : '';
  if (!WRITE_TOOLS.has(toolName)) return [];
  if (type === 'tool_completed' && e.status !== 'succeeded') return [];
  return parsePathsFromToolSummary(
    typeof e.summary === 'string' ? e.summary : undefined,
  );
}

/** Count +/- lines from a unified diff string. */
export function countDiffStats(diff: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

export function inferStatusFromDiff(
  diff: string,
  fallback: DesktopFileChangeEntry['status'] = 'M',
): DesktopFileChangeEntry['status'] {
  if (/^new file mode/m.test(diff) || /\/dev\/null/.test(diff)) {
    if (/^--- \/dev\/null/m.test(diff)) return 'A';
    if (/^\+\+\+ \/dev\/null/m.test(diff)) return 'D';
  }
  if (/^deleted file mode/m.test(diff)) return 'D';
  return fallback;
}
