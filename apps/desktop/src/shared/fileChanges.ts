/**
 * Parse write-tool summaries and build chat-facing file-change views.
 * Agent-caused set = write tools ∪ newly dirty ∪ mtime-touched since run start.
 */

export const WRITE_TOOLS = new Set([
  'apply_patch',
  'delete_file',
  'delete_directory',
  'move_file',
]);

/** Tools that may materialize files outside WRITE_TOOLS (generators, scaffolds). */
export const PROCESS_MUTATION_TOOLS = new Set([
  'run_command',
]);

/** Max paths to fetch diffs / show in the expandable list. */
export const FILE_CHANGES_DISPLAY_CAP = 40;

/**
 * Host / VCS / harness internals — never treat as agent product edits.
 * Mirrors v8 `isInternalHostPath` (apps may not deep-import runtime helpers).
 */
export function isHostInternalChangePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!normalized) return true;
  if (
    normalized === '.mitii' ||
    normalized.startsWith('.mitii/') ||
    normalized === '.git' ||
    normalized.startsWith('.git/') ||
    normalized === 'node_modules' ||
    normalized.startsWith('node_modules/')
  ) {
    return true;
  }
  return isEphemeralWorkspacePath(normalized);
}

/**
 * Scratch / temp / debug artifacts created by tests or local harnesses.
 * Matches path segments like `.scratch`, `.tmp-foo`, `.debug-bar.mjs`.
 */
export function isEphemeralWorkspacePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!normalized) return true;
  return normalized.split('/').some((part) => {
    if (!part) return false;
    if (part === '.scratch' || part.startsWith('.scratch.')) return true;
    if (part.startsWith('.tmp-') || part.startsWith('.tmp.')) return true;
    if (part.startsWith('.debug-') || part.startsWith('.debug.')) return true;
    return false;
  });
}

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
  /** Full agent-caused count before display cap. */
  totalCount?: number;
  truncated?: boolean;
  totalAdditions: number;
  totalDeletions: number;
}

export type DirtyPathSnapshot = {
  path: string;
  mtimeMs?: number;
};

/**
 * Union write-tool paths with dirty-tree delta for this run.
 * Includes already-dirty paths whose mtime advanced during the run (generators).
 */
export function collectAgentCausedPaths(input: {
  writePaths: readonly string[];
  beforeDirty: readonly DirtyPathSnapshot[];
  afterDirty: readonly DirtyPathSnapshot[];
  sinceMs?: number;
}): string[] {
  const write = new Set(
    input.writePaths
      .map((path) => path.replace(/\\/g, '/').trim())
      .filter((path) => path.length > 0 && !isHostInternalChangePath(path)),
  );
  const before = new Map<string, number | undefined>();
  for (const row of input.beforeDirty) {
    const path = row.path.replace(/\\/g, '/').trim();
    if (path && !isHostInternalChangePath(path)) before.set(path, row.mtimeMs);
  }
  const since =
    typeof input.sinceMs === 'number' && Number.isFinite(input.sinceMs)
      ? input.sinceMs - 1_500
      : undefined;

  const caused = new Set<string>(write);
  const beforeEmpty = before.size === 0;
  for (const row of input.afterDirty) {
    const path = row.path.replace(/\\/g, '/').trim();
    if (!path || isHostInternalChangePath(path)) continue;
    if (write.has(path)) {
      caused.add(path);
      continue;
    }
    const afterMtime = row.mtimeMs;
    // No reliable baseline — only trust write tools + mtime since run start.
    if (beforeEmpty) {
      if (
        typeof afterMtime === 'number' &&
        typeof since === 'number' &&
        afterMtime >= since
      ) {
        caused.add(path);
      }
      continue;
    }
    if (!before.has(path)) {
      caused.add(path);
      continue;
    }
    const beforeMtime = before.get(path);
    if (
      typeof afterMtime === 'number' &&
      typeof beforeMtime === 'number' &&
      afterMtime > beforeMtime + 1
    ) {
      caused.add(path);
      continue;
    }
    if (
      typeof afterMtime === 'number' &&
      typeof since === 'number' &&
      afterMtime >= since &&
      (typeof beforeMtime !== 'number' || afterMtime > beforeMtime)
    ) {
      caused.add(path);
    }
  }
  return [...caused].sort((a, b) => a.localeCompare(b));
}

export function capPathsForFileChangesDisplay(
  paths: readonly string[],
  cap = FILE_CHANGES_DISPLAY_CAP,
): { displayPaths: string[]; totalCount: number; truncated: boolean } {
  const unique = [
    ...new Set(
      paths
        .map((path) => path.replace(/\\/g, '/').trim())
        .filter((path) => path.length > 0),
    ),
  ];
  const totalCount = unique.length;
  const truncated = totalCount > cap;
  return {
    displayPaths: unique.slice(0, cap),
    totalCount,
    truncated,
  };
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

/** Paths from tool output JSON (preferred over truncated summaries). */
export function parsePathsFromToolOutputPreview(
  preview: string | undefined,
): string[] {
  if (!preview?.trim()) return [];
  try {
    const parsed = JSON.parse(preview) as Record<string, unknown>;
    const out: string[] = [];
    const push = (value: unknown) => {
      if (typeof value === 'string' && value.trim()) out.push(value.trim());
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.trim()) out.push(item.trim());
          else if (item && typeof item === 'object' && 'path' in item) {
            const path = (item as { path?: unknown }).path;
            if (typeof path === 'string' && path.trim()) out.push(path.trim());
          }
        }
      }
    };
    push(parsed.changedFiles);
    push(parsed.paths);
    push(parsed.files);
    if (Array.isArray(parsed.applied)) {
      for (const item of parsed.applied) {
        if (item && typeof item === 'object' && 'path' in item) {
          push((item as { path?: unknown }).path);
        }
      }
    }
    return [
      ...new Set(
        out.map((path) => path.replace(/\\/g, '/')).filter((path) => path.length > 0),
      ),
    ].slice(0, 64);
  } catch {
    return [];
  }
}

export function collectMutatedPathsFromEvent(event: unknown): string[] {
  if (!event || typeof event !== 'object') return [];
  const e = event as Record<string, unknown>;
  const type = e.type;
  if (type !== 'tool_started' && type !== 'tool_completed') return [];
  const toolName = typeof e.toolName === 'string' ? e.toolName : '';
  if (!WRITE_TOOLS.has(toolName)) return [];
  if (type === 'tool_completed' && e.status !== 'succeeded') return [];
  const fromPreview = parsePathsFromToolOutputPreview(
    typeof e.outputPreview === 'string' ? e.outputPreview : undefined,
  );
  const fromSummary = parsePathsFromToolSummary(
    typeof e.summary === 'string' ? e.summary : undefined,
  );
  // Prefer complete outputPreview paths; drop truncated summary fragments.
  const cleanedSummary = fromSummary.filter((path) => {
    if (fromPreview.some((full) => full !== path && full.startsWith(path))) {
      return false;
    }
    return path.includes('.') || path.endsWith('/');
  });
  return [
    ...new Set(
      [...fromPreview, ...cleanedSummary].filter(
        (path) => !isHostInternalChangePath(path),
      ),
    ),
  ].slice(0, 64);
}

/** True when a completed process tool may have materialized workspace files. */
export function isSuccessfulProcessMutationEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;
  if (e.type !== 'tool_completed') return false;
  if (e.status !== 'succeeded') return false;
  const toolName = typeof e.toolName === 'string' ? e.toolName : '';
  return PROCESS_MUTATION_TOOLS.has(toolName);
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

/** Trailing prose CTA that should become the Continue button instead. */
const CONTINUE_CTA_RE =
  /\n*(?:Want me to[\s\S]*?\?\s*)?Say\s+\*{0,2}continue\*{0,2}\b[^\n]*$/i;

/** Drop leftover Continue CTA when a dedicated Continue bar is shown. */
export function stripContinueCtaFromAnswer(text: string): string {
  return text.replace(CONTINUE_CTA_RE, '').trimEnd();
}

/**
 * When the model ends with “Say continue” but runtime sent no nextAction,
 * lift that into a Continue-bar prompt so the user does not have to type it.
 * Prompt is shaped so Decide routes to execute (not repository_answer).
 */
export function extractContinueOffer(answer: string): string | undefined {
  const sayMatch = answer.match(/Say\s+\*{0,2}continue\*{0,2}\b/i);
  if (!sayMatch || sayMatch.index === undefined) return undefined;
  const before = answer.slice(0, sayMatch.index);
  const want = before.match(/Want me to\s+([\s\S]+?)\?\s*$/i)?.[1];
  const detail = want?.replace(/\s+/g, ' ').replace(/\s+next$/i, '').trim();
  if (!detail) return 'Continue with the next step.';
  const capitalized = detail.charAt(0).toUpperCase() + detail.slice(1);
  return `Continue with the next step: ${capitalized}`;
}
