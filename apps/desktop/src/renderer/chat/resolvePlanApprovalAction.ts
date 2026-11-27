/**
 * Plan-card primary action: Build always resumes execute (Cursor-like).
 * Composer mode is switched to agent by the host before resume.
 */

export type PlanApprovalAction = 'resume_execute' | 'keep_plan_only';

export function resolvePlanApprovalAction(
  _mode: string | undefined,
): PlanApprovalAction {
  return 'resume_execute';
}
