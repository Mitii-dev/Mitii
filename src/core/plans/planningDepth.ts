import type { TaskAnalysis } from '../runtime/TaskAnalyzer';

/** Skill-aligned planning depth budgets (see planning-and-task-breakdown). */
export type PlanningDepth = 'none' | 'micro' | 'short' | 'standard' | 'full';

export function resolvePlanningDepth(taskAnalysis?: TaskAnalysis): PlanningDepth {
  if (!taskAnalysis) return 'standard';
  if (taskAnalysis.kind === 'audit' || taskAnalysis.complexity === 'high') return 'full';
  if (taskAnalysis.kind === 'simple_edit') return 'micro';
  if (taskAnalysis.kind === 'question' || taskAnalysis.kind === 'log_audit') return 'none';
  if (!taskAnalysis.shouldPlan) return 'none';
  if (taskAnalysis.complexity === 'low') return 'short';
  return 'standard';
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
  if (taskAnalysis?.kind === 'audit') return 8;
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
