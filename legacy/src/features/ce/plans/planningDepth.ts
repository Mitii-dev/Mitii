import type { TaskAnalysis } from '../runtime/TaskAnalyzer';
import {
  resolvePlanningDepthAxis,
  toInternalPlanningDepth,
  minStepsForAxis,
  shouldSkipStructuredPlannerForAxis,
  resolveRoute,
  isDependencyCleanupAudit,
} from '../pipeline';

/** Skill-aligned planning depth budgets (see planning-and-task-breakdown). */
export type PlanningDepth = 'none' | 'micro' | 'short' | 'standard' | 'full';

/**
 * Resolve internal planning depth.
 * Prefer pipeline `resolvePlanningDepthAxis` for new code; this wraps it for compatibility.
 */
export function resolvePlanningDepth(taskAnalysis?: TaskAnalysis, userMessage = ''): PlanningDepth {
  const route = resolveRoute(userMessage || taskAnalysis?.summary || '', taskAnalysis);
  const axis = resolvePlanningDepthAxis(route, taskAnalysis, 'auto');
  return toInternalPlanningDepth(axis, taskAnalysis);
}

/** Agent structured planner should skip for none/micro — execute directly. */
export function shouldSkipStructuredPlanner(depth: PlanningDepth, mode: string): boolean {
  if (mode !== 'agent') return false;
  return depth === 'none' || depth === 'micro';
}

export function maxStepsForPlanningDepth(
  depth: PlanningDepth,
  taskAnalysis?: TaskAnalysis
): number | undefined {
  const route = resolveRoute(taskAnalysis?.summary ?? '', taskAnalysis);
  if (taskAnalysis?.kind === 'audit' && isDependencyCleanupAudit(route.auditSubtype ?? taskAnalysis.auditSubtype)) {
    return undefined;
  }
  if (taskAnalysis?.kind === 'audit' || depth === 'full') return undefined;
  switch (depth) {
    case 'none':
      return 1;
    case 'micro':
      return 2;
    case 'short':
      return 4;
    case 'standard':
      return 6;
  }
}

export function minStepsForPlanningDepth(
  depth: PlanningDepth,
  taskAnalysis?: TaskAnalysis
): number {
  const route = resolveRoute(taskAnalysis?.summary ?? '', taskAnalysis);
  const subtype = route.auditSubtype ?? taskAnalysis?.auditSubtype;
  // No hard-coded audit minimum of 8 — cleanup audits use depth-aware mins.
  if (taskAnalysis?.kind === 'audit' && isDependencyCleanupAudit(subtype)) {
    return minStepsForAxis('deep', { ...route, auditSubtype: subtype, intent: 'audit' });
  }
  if (depth === 'none' || depth === 'micro') return 1;
  if (depth === 'short') return 1;
  if (depth === 'full' && taskAnalysis?.complexity === 'high') return 4;
  if (taskAnalysis?.shouldPlan) return 2;
  return 1;
}

export function describePlanningDepthBudget(depth: PlanningDepth): string {
  switch (depth) {
    case 'none':
      return 'Use no plan unless one step is unavoidable.';
    case 'micro':
      return 'Use 1-2 steps maximum.';
    case 'short':
      return 'Use 2-4 steps maximum.';
    case 'standard':
      return 'Use 3-6 steps maximum.';
    case 'full':
      return 'Use as many steps as needed, but avoid duplicate discovery and verification steps.';
  }
}

export { shouldSkipStructuredPlannerForAxis };
