import type { TaskAnalysis } from '../../runtime/TaskAnalyzer';
import type { AgentDepth } from '../../../../kernel/config/schema';
import type {
  InternalPlanningDepth,
  PlanningDepthAxis,
  RouteResolution,
} from '../types';
import { isDependencyCleanupAudit } from '../route/routeResolver';

/**
 * Product axis: direct (no structured plan) | quick (short plan) | deep (full plan).
 * Maps onto internal PlanningDepth used by PlanExecutor.
 */
export function resolvePlanningDepthAxis(
  route: RouteResolution,
  taskAnalysis?: TaskAnalysis,
  userDepth: AgentDepth | string = 'auto'
): PlanningDepthAxis {
  if (userDepth === 'quick') return 'quick';
  if (userDepth === 'deep') return 'deep';

  if (
    route.executionPath === 'direct' ||
    route.executionPath === 'log_audit' ||
    route.intent === 'question' ||
    taskAnalysis?.kind === 'simple_edit' ||
    taskAnalysis?.kind === 'debugging'
  ) {
    return 'direct';
  }

  if (route.intent === 'docs' && route.docsSubtype === 'readme') {
    return taskAnalysis?.complexity === 'high' ? 'quick' : 'direct';
  }

  if (route.intent === 'docs') {
    return taskAnalysis?.complexity === 'high' ? 'deep' : 'quick';
  }

  if (route.intent === 'audit' && isDependencyCleanupAudit(route.auditSubtype)) {
    return 'deep';
  }

  if (route.intent === 'audit') {
    return 'quick';
  }

  if (taskAnalysis?.complexity === 'high' || route.executionPath === 'orchestrated') {
    return taskAnalysis?.complexity === 'high' ? 'deep' : 'quick';
  }

  if (!taskAnalysis?.shouldPlan) return 'direct';
  return 'quick';
}

export function toInternalPlanningDepth(axis: PlanningDepthAxis, taskAnalysis?: TaskAnalysis): InternalPlanningDepth {
  switch (axis) {
    case 'direct':
      return taskAnalysis?.kind === 'simple_edit' || taskAnalysis?.kind === 'debugging' ? 'micro' : 'none';
    case 'quick':
      return taskAnalysis?.complexity === 'low' ? 'short' : 'standard';
    case 'deep':
      return 'full';
  }
}

/** @deprecated Prefer resolvePlanningDepthAxis + toInternalPlanningDepth. */
export function resolvePlanningDepthFromRoute(
  route: RouteResolution,
  taskAnalysis?: TaskAnalysis,
  userDepth: AgentDepth | string = 'auto'
): InternalPlanningDepth {
  return toInternalPlanningDepth(resolvePlanningDepthAxis(route, taskAnalysis, userDepth), taskAnalysis);
}

export function shouldSkipStructuredPlannerForAxis(axis: PlanningDepthAxis, mode: string): boolean {
  if (mode !== 'agent') return false;
  return axis === 'direct';
}

export function minStepsForAxis(axis: PlanningDepthAxis, route?: RouteResolution): number {
  if (axis === 'direct') return 1;
  if (axis === 'quick') return 1;
  // Deep audits that are cleanup-shaped still need multiple phases, but not a hard 8.
  if (route?.intent === 'audit' && isDependencyCleanupAudit(route.auditSubtype)) return 4;
  if (axis === 'deep') return 2;
  return 1;
}

export function maxStepsForAxis(axis: PlanningDepthAxis, route?: RouteResolution): number | undefined {
  if (axis === 'direct') return 2;
  if (axis === 'quick') return 6;
  if (route?.intent === 'audit' && isDependencyCleanupAudit(route.auditSubtype)) return undefined;
  if (axis === 'deep') return undefined;
  return 6;
}

export function describeDepthAxis(axis: PlanningDepthAxis): string {
  switch (axis) {
    case 'direct':
      return 'Execute directly with at most 1–2 steps; skip the structured planner.';
    case 'quick':
      return 'Use a short plan (about 2–6 steps); avoid duplicate discovery.';
    case 'deep':
      return 'Use a full multi-phase plan as needed; avoid duplicate discovery/verification.';
  }
}
