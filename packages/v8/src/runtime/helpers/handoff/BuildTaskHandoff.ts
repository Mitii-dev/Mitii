/**
 * Thin suspend/result sketch (P7). Full linked-list notes use
 * `buildTaskHandoffNote` / `advanceTaskWithHandoff` (S13).
 */
export interface TaskHandoff {
  fromTaskId?: string;
  toTaskId?: string;
  reason: string;
  reasonCodes: string[];
  /** Truncated doneSummary when a full note was produced. */
  doneSummary?: string;
}

export function buildTaskHandoff(params: {
  fromTaskId?: string;
  toTaskId?: string;
  reason: string;
  doneSummary?: string;
}): TaskHandoff {
  return {
    fromTaskId: params.fromTaskId,
    toTaskId: params.toTaskId,
    reason: params.reason,
    ...(params.doneSummary ? { doneSummary: params.doneSummary } : {}),
    reasonCodes: ["task_handoff"],
  };
}
