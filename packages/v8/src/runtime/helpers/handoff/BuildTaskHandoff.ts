/** Minimal handoff payload when pausing / promoting a task list item. */
export interface TaskHandoff {
  fromTaskId?: string;
  toTaskId?: string;
  reason: string;
  reasonCodes: string[];
}

export function buildTaskHandoff(params: {
  fromTaskId?: string;
  toTaskId?: string;
  reason: string;
}): TaskHandoff {
  return {
    fromTaskId: params.fromTaskId,
    toTaskId: params.toTaskId,
    reason: params.reason,
    reasonCodes: ["task_handoff"],
  };
}
