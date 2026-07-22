import { createHash } from 'crypto';

export interface TaskCheckpointIdentity {
  version?: number;
  savedAt?: string;
  cwd?: string;
  branch?: string;
  commit?: string;
  planId?: string;
  goalHash?: string;
  targetProjectId?: string;
  workspaceRevision?: string;
  plan?: string;
  findings?: string;
  gitStatus?: string;
}

export interface CurrentCheckpointContext {
  planId?: string;
  goalHash?: string;
  targetProjectId?: string;
  branch?: string;
  baseCommit?: string;
  workspaceRevision?: string;
}

export type CheckpointResumeVerdict =
  | { ok: true }
  | { ok: false; code: 'CHECKPOINT_TASK_MISMATCH' | 'CHECKPOINT_MISSING_IDENTITY'; reason: string };

/**
 * Hash a stable goal string for checkpoint identity (first 16 hex chars).
 */
export function hashCheckpointGoal(goal: string): string {
  return createHash('sha256').update(goal.trim().toLowerCase()).digest('hex').slice(0, 16);
}

/**
 * Decide whether a persisted `.mitii-state.json` checkpoint may resume the current task.
 */
export function canResumeCheckpoint(
  checkpoint: TaskCheckpointIdentity | null | undefined,
  current: CurrentCheckpointContext
): CheckpointResumeVerdict {
  if (!checkpoint || typeof checkpoint !== 'object') {
    return { ok: false, code: 'CHECKPOINT_MISSING_IDENTITY', reason: 'No checkpoint payload available.' };
  }

  const mismatches: string[] = [];
  requireMatchingField('targetProjectId', current.targetProjectId, checkpoint.targetProjectId, mismatches);
  requireMatchingField('goalHash', current.goalHash, checkpoint.goalHash, mismatches);
  requireMatchingField('planId', current.planId, checkpoint.planId, mismatches);
  requireMatchingField('branch', current.branch, checkpoint.branch, mismatches);
  requireMatchingField('commit', current.baseCommit, checkpoint.commit, mismatches);
  requireMatchingField('workspaceRevision', current.workspaceRevision, checkpoint.workspaceRevision, mismatches);

  if (mismatches.length > 0) {
    return {
      ok: false,
      code: mismatches.some((item) => item.startsWith('checkpoint is missing'))
        ? 'CHECKPOINT_MISSING_IDENTITY'
        : 'CHECKPOINT_TASK_MISMATCH',
      reason: `CHECKPOINT_TASK_MISMATCH: ${mismatches.join('; ')}`,
    };
  }

  return { ok: true };
}

function requireMatchingField(
  field: string,
  currentValue: string | undefined,
  checkpointValue: string | undefined,
  mismatches: string[]
): void {
  if (!currentValue) return;
  if (!checkpointValue) {
    mismatches.push(`checkpoint is missing ${field}`);
    return;
  }
  if (field === 'targetProjectId') {
    if (normalizeId(checkpointValue) !== normalizeId(currentValue)) {
      mismatches.push(`checkpoint target=${checkpointValue} current target=${currentValue}`);
    }
    return;
  }
  if (checkpointValue !== currentValue) {
    mismatches.push(`${field} mismatch`);
  }
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
