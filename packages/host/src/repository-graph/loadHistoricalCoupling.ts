import type { GitPort } from '@mitii/v8';

const DEFAULT_MAX_COMMITS = 40;
const DEFAULT_MAX_COUPLED_PATHS = 40;

export interface HostHistoricalCouplingEntry {
  relativePath: string;
  coChangeCount: number;
  churnScore?: number;
}

/**
 * Host-side co-change mining for change-impact. V8 never mines git itself;
 * this adapter publishes capped coupling entries via RepositoryGraphPort.
 */
export async function loadHistoricalCouplingFromGit(params: {
  workspaceRoot: string;
  relativePath: string;
  git: GitPort;
  maxCommits?: number;
  maxCoupledPaths?: number;
  signal?: AbortSignal;
}): Promise<readonly HostHistoricalCouplingEntry[]> {
  if (!params.git.log) return [];

  const seed = normalizePath(params.relativePath);
  if (!seed) return [];

  try {
    const result = await params.git.log({
      workspaceRoot: params.workspaceRoot,
      maxCount: params.maxCommits ?? DEFAULT_MAX_COMMITS,
      paths: [seed],
      nameOnly: true,
      signal: params.signal,
    });

    const counts = new Map<string, number>();
    for (const entry of result.entries) {
      const files = (entry.files ?? [])
        .map(normalizePath)
        .filter((path): path is string => Boolean(path) && path !== seed);
      const unique = [...new Set(files)];
      for (const path of unique) {
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
    }

    const maxPaths = params.maxCoupledPaths ?? DEFAULT_MAX_COUPLED_PATHS;
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, maxPaths)
      .map(([relativePath, coChangeCount]) => ({
        relativePath,
        coChangeCount,
        churnScore: Math.min(1, coChangeCount / Math.max(1, result.entries.length)),
      }));
  } catch {
    return [];
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}
