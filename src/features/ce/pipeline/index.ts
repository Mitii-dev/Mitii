/**
 * Turn pipeline entrypoints.
 * @see ./README.md
 */

export * from './types';
export { classifyArtifacts, classifyArtifactPath } from './classify/artifactClassifier';

export {
  classifyTaskSignals,
  resolveRoute,
  resolveAuditSubtype,
  resolveDocsSubtype,
  isDependencyCleanupAudit,
  buildRoutePolicyText,
} from './route/routeResolver';

export {
  resolvePlanningDepthAxis,
  toInternalPlanningDepth,
  resolvePlanningDepthFromRoute,
  shouldSkipStructuredPlannerForAxis,
  minStepsForAxis,
  maxStepsForAxis,
  describeDepthAxis,
} from './depth/planningDepthResolver';

export { resolveSkillsForRoute } from './skills/skillResolver';

export {
  resolveCapabilities,
  filterToolsByCapabilities,
  GIT_WRITE_AND_RELEASE_TOOLS,
  MCP_FILESYSTEM_TOOLS,
} from './capabilities/capabilityResolver';

export {
  evaluateNoProgress,
  fingerprintToolCall,
  isPhaseLockError,
  type ToolAttemptRecord,
  type NoProgressVerdict,
} from './loop/noProgressDetector';

import type { TaskAnalysis } from '../runtime/TaskAnalyzer';
import type { AgentDepth } from '../../../kernel/config/schema';
import type { ToolExposure } from '../../../kernel/policy/tierPolicy';
import type { PipelineResolution } from './types';
import { classifyTaskSignals, resolveRoute } from './route/routeResolver';
import {
  resolvePlanningDepthAxis,
  toInternalPlanningDepth,
  shouldSkipStructuredPlannerForAxis,
} from './depth/planningDepthResolver';
import { resolveSkillsForRoute } from './skills/skillResolver';
import { resolveCapabilities } from './capabilities/capabilityResolver';
import { classifyArtifacts } from './classify/artifactClassifier';

export interface ResolvePipelineOptions {
  mode: string;
  userDepth?: AgentDepth | string;
  toolExposure?: ToolExposure;
  mdxRepairMode?: boolean;
  resumeSavedPlan?: boolean;
  planning?: boolean;
  planExecution?: boolean;
  orchestrationEnabled?: boolean;
  forceDirect?: boolean;
}

/**
 * Single call that produces route + depth + skills + capabilities for a turn.
 */
export function resolveTurnPipeline(
  userMessage: string,
  taskAnalysis: TaskAnalysis | undefined,
  options: ResolvePipelineOptions
): PipelineResolution {
  const classification = classifyTaskSignals(userMessage, taskAnalysis);
  const artifact = classifyArtifacts(userMessage);
  const route = resolveRoute(userMessage, taskAnalysis, {
    mdxRepairMode: options.mdxRepairMode,
    resumeSavedPlan: options.resumeSavedPlan,
    forceDirect: options.forceDirect,
  });
  const depthAxis = resolvePlanningDepthAxis(route, taskAnalysis, options.userDepth);
  const internalDepth = toInternalPlanningDepth(depthAxis, taskAnalysis);
  const skills = resolveSkillsForRoute(route, taskAnalysis, {
    sourceMode: options.mode === 'ask' || options.mode === 'plan' || options.mode === 'agent' ? options.mode : 'agent',
    planning: options.planning ?? options.mode === 'plan',
  });
  const capabilities = resolveCapabilities(route, {
    mode: options.mode,
    toolExposure: options.toolExposure,
    planExecution: options.planExecution,
  });

  const shouldUsePlanner =
    Boolean(options.orchestrationEnabled !== false) &&
    !shouldSkipStructuredPlannerForAxis(depthAxis, options.mode) &&
    route.executionPath === 'orchestrated' &&
    depthAxis !== 'direct';

  return {
    classification,
    artifact,
    route,
    depthAxis,
    internalDepth,
    skills,
    capabilities,
    shouldUsePlanner,
  };
}
