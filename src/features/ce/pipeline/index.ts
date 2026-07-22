/**
 * Turn pipeline entrypoints.
 * @see ./README.md
 */

export * from './types';
export {
  classifyArtifacts,
  classifyArtifactPath,
  isStaleDiagnosticLogPath,
  resolveProjectMentions,
} from './classify/artifactClassifier';

export {
  extractTaskFeatures,
  askIntentFromFeatures,
  type TaskFeatureSignals,
  type InteractionIntent,
} from './classify/taskFeatures';

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
import type { KnownProjectRef, PipelineResolution, SkillResolution } from './types';
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
  /** Optional workspace project catalog used to resolve `@project` mentions. */
  knownProjects?: readonly KnownProjectRef[];
  /** Optional catalog-backed decision produced outside this pure policy pipeline. */
  skillResolution?: SkillResolution;
}

/**
 * Skill resolution branches on 'agent' vs everything else (e.g. picking the agent-plan vs
 * planning-and-task-breakdown support skill). Collapsing an unrecognized mode straight to
 * 'agent' silently gave Review-mode turns agent-flavored skill selection; only fold truly
 * unknown values into 'agent', and let known non-agent modes (ask/plan/review) stay themselves.
 */
function normalizeSourceMode(mode: string): 'ask' | 'plan' | 'agent' | 'review' {
  switch (mode) {
    case 'ask':
    case 'plan':
    case 'agent':
    case 'review':
      return mode;
    default:
      return 'agent';
  }
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
  const artifact = classifyArtifacts(userMessage, { knownProjects: options.knownProjects });
  const route = resolveRoute(userMessage, taskAnalysis, {
    mdxRepairMode: options.mdxRepairMode,
    resumeSavedPlan: options.resumeSavedPlan,
    forceDirect: options.forceDirect,
  });
  const depthAxis = resolvePlanningDepthAxis(route, taskAnalysis, options.userDepth);
  const internalDepth = toInternalPlanningDepth(depthAxis, taskAnalysis);
  const skills = options.skillResolution ?? resolveSkillsForRoute(route, taskAnalysis, userMessage, {
      sourceMode: normalizeSourceMode(options.mode),
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
