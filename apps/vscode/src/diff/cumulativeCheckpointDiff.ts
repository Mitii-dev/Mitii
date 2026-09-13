/**
 * Cumulative changed-path unions across VS Code checkpoint labels.
 * Host-only helper — no V8 dependency.
 */

export interface CheckpointWithPaths {
  id: string;
  label: string;
  createdAt: string;
  /** Workspace-relative paths mutated when this checkpoint was taken. */
  changedPaths?: string[];
}

/**
 * Union of changedPaths from `fromCheckpointId` (inclusive) through the
 * newest checkpoint (index 0). Checkpoints are newest-first.
 */
export function cumulativeChangedPathsSince(
  checkpoints: readonly CheckpointWithPaths[],
  fromCheckpointId: string,
): { paths: string[]; fromIndex: number; toIndex: number } {
  const fromIndex = checkpoints.findIndex((cp) => cp.id === fromCheckpointId);
  if (fromIndex < 0) {
    return { paths: [], fromIndex: -1, toIndex: -1 };
  }
  const set = new Set<string>();
  for (let i = 0; i <= fromIndex; i += 1) {
    const paths = checkpoints[i]?.changedPaths ?? [];
    for (const path of paths) {
      const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').trim();
      if (normalized) set.add(normalized);
    }
  }
  return {
    paths: [...set].sort((a, b) => a.localeCompare(b)),
    fromIndex: 0,
    toIndex: fromIndex,
  };
}
