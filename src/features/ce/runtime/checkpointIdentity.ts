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
 * Missing identity fields on legacy checkpoints are treated as unsafe to resume when the
 * current task declares a target project or goal hash.
 */
export function canResumeCheckpoint(
  checkpoint: TaskCheckpointIdentity | null | undefined,
  current: CurrentCheckpointContext
): CheckpointResumeVerdict {
  if (!checkpoint || typeof checkpoint !== 'object') {
    return { ok: false, code: 'CHECKPOINT_MISSING_IDENTITY', reason: 'No checkpoint payload available.' };
  }

  const mismatches: string[] = [];
  if (current.targetProjectId) {
    if (!checkpoint.targetProjectId) {
      return {
        ok: false,
        code: 'CHECKPOINT_MISSING_IDENTITY',
        reason: `CHECKPOINT_TASK_MISMATCH: checkpoint has no targetProjectId; current target=${current.targetProjectId}`,
      };
    }
    if (normalizeId(checkpoint.targetProjectId) !== normalizeId(current.targetProjectId)) {
      mismatches.push(
        `checkpoint target=${checkpoint.targetProjectId} current target=${current.targetProjectId}`
      );
    }
  }

  if (current.goalHash) {
    if (!checkpoint.goalHash) {
      return {
        ok: false,
        code: 'CHECKPOINT_MISSING_IDENTITY',
        reason: 'CHECKPOINT_TASK_MISMATCH: checkpoint has no goalHash for the current task.',
      };
    }
    if (checkpoint.goalHash !== current.goalHash) {
      mismatches.push('goalHash mismatch');
    }
  }

  if (current.planId && checkpoint.planId && checkpoint.planId !== current.planId) {
    mismatches.push(`checkpoint planId=${checkpoint.planId} current planId=${current.planId}`);
  }

  if (current.branch && checkpoint.branch && checkpoint.branch !== current.branch) {
    mismatches.push(`checkpoint branch=${checkpoint.branch} current branch=${current.branch}`);
  }

  if (current.baseCommit && checkpoint.commit && checkpoint.commit !== current.baseCommit) {
    mismatches.push(`checkpoint commit=${checkpoint.commit} current commit=${current.baseCommit}`);
  }

  if (
    current.workspaceRevision &&
    checkpoint.workspaceRevision &&
    checkpoint.workspaceRevision !== current.workspaceRevision
  ) {
    mismatches.push('workspaceRevision mismatch');
  }

  if (mismatches.length > 0) {
    return {
      ok: false,
      code: 'CHECKPOINT_TASK_MISMATCH',
      reason: `CHECKPOINT_TASK_MISMATCH: ${mismatches.join('; ')}`,
    };
  }

  return { ok: true };
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
