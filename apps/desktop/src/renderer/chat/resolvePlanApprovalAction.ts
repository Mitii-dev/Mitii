/**
 * Plan-approval card primary action depends on the composer mode.
 * Agent → resume execute. Plan/ask → keep the plan without writing files.
 */

export type PlanApprovalAction = 'resume_execute' | 'keep_plan_only';

export function resolvePlanApprovalAction(
  mode: string | undefined,
): PlanApprovalAction {
  return mode === 'agent' ? 'resume_execute' : 'keep_plan_only';
}
