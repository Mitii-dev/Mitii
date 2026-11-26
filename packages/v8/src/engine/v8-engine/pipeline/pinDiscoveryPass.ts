import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  DiscoveryBrief,
  PlanningInput,
} from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";

import { filterToolDefinitions } from "../actions";
import type { DiscoveryPassBudget } from "../modules/plan-discovery";
import type { AgentReasonCode } from "../contracts";
import {
  createDiscoveryGrant,
  createDiscoveryObservationCollector,
  isDiscoveryToolAllowed,
} from "../internal/discovery";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import { DEFAULT_TOOL_DEFINITIONS } from "../legacy/policy";
import type { AgentEngineRuntime } from "./runtime";
import { runDiscoverySeedAndShapedPreflight } from "./pinDiscoveryPreflight";
import { buildDiscoveryQualityFloorNudge } from "./pinDiscoveryPassNudges";
import {
  runDiscoveryPassModelLoop,
  type DiscoveryPassStopReason,
} from "./pinDiscoveryPassLoop";
import { buildPinDiscoveryPassMessages } from "./pinDiscoveryPassMessages";
import { setupDiscoveryPass } from "./pinDiscoveryPassSetup";
import { finishDiscoveryPass } from "./pinDiscoveryPassFinish";

export async function runDiscoveryPass(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    query: string;
    objective: string;
    evidence: PlanningInput["evidence"];
    decision: ExecutionDecision;
    pinnedState: RepositoryStateReference | undefined;
    workspaceRoot: string | undefined;
    bus: EventBus;
    signal: AbortSignal;
    budget: RunBudgetTracker;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    taskListRef: TaskListRef;
    windowPolicy: WindowPolicy;
    preferredPaths?: readonly string[];
    /** Index + user-named paths used to validate `preferredPaths` before reads. */
    seedPathHygiene?: {
      knownPaths?: readonly string[];
      trustedPaths?: readonly string[];
    };
    /** Plan mode (non-quick): require file-backed discovery before treating pass as success. */
    qualityFloor?: boolean;
    /** Plan / Agent-visible: multi-file multi-surface thoroughness bar. */
    thoroughEvidence?: boolean;
    /**
     * Medium/large: prefer trusted seed/explicit paths first; only run shaped
     * search when seeds are insufficient.
     */
    seedFirstDiscovery?: boolean;
    /**
     * Plan thorough: do not skip shaped/search solely because preferred paths
     * already name a file — force real exploration.
     */
    forceExploration?: boolean;
    /** Soft symbol nudge even when thoroughEvidence is off (medium band). */
    preferSymbols?: boolean;
    /** Officer taskSize for discovery envelope. */
    taskSize?: "small" | "medium" | "large" | string;
    /**
     * After A/B/C scope lock: shrink the discovery envelope (default factor
     * applied by caller via scaleDiscoveryPassBudget).
     */
    discoveryBudgetOverride?: DiscoveryPassBudget;
    /** Injected when preferred paths were narrowed to a chosen plan scope. */
    discoveryScopeHint?: string;
  },
): Promise<{
  brief: DiscoveryBrief;
  failed: boolean;
  collector: ReturnType<typeof createDiscoveryObservationCollector>;
}> {
  const {
    runId,
    query,
    objective,
    evidence,
    decision,
    pinnedState,
    workspaceRoot,
    bus,
    signal,
    budget,
    reasonCodes,
    warnings,
    taskListRef,
    windowPolicy,
    preferredPaths = [],
    qualityFloor = false,
    thoroughEvidence = false,
    seedFirstDiscovery = false,
    forceExploration = false,
    preferSymbols = false,
    taskSize,
    discoveryBudgetOverride,
    discoveryScopeHint,
  } = params;

  const setup = setupDiscoveryPass({
    runtime,
    runId,
    bus,
    objective,
    evidence,
    decision,
    workspaceRoot,
    signal,
    reasonCodes,
    warnings,
    taskListRef,
    windowPolicy,
    thoroughEvidence,
    preferSymbols,
    taskSize,
    discoveryBudgetOverride,
  });
  const {
    discoveryBudget,
    collector,
    explicitTargets,
    canLoop,
    preferSymbolEvidence,
    requireSymbolEvidence,
    canForceTools,
    minSearches,
  } = setup;

  let stopReason: DiscoveryPassStopReason = "natural";
  if (canLoop) {
    const grant = createDiscoveryGrant(decision.toolGrant, discoveryBudget);
    const tools = filterToolDefinitions({
      grant,
      definitions: runtime.deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS,
      supportsTools: true,
    }).filter((tool) => isDiscoveryToolAllowed(tool.name));

    const {
      uniqueSeeds,
      shapedProfile,
      shapedSeeds,
      seeds,
      rankedPreferred,
      preReadByPath,
      perFileChars,
    } = await runDiscoverySeedAndShapedPreflight({
      runtime,
      runId,
      bus,
      budget,
      collector,
      grant,
      workspaceRoot: workspaceRoot!,
      pinnedState,
      windowPolicy,
      query,
      preferredPaths,
      seedPathHygiene: params.seedPathHygiene,
      qualityFloor,
      seedFirstDiscovery,
      forceExploration,
      discoveryBudget,
      signal,
      reasonCodes,
    });

    const qualityFloorNudge = buildDiscoveryQualityFloorNudge({
      thoroughEvidence,
      preferSymbolEvidence,
    });
    const messages = buildPinDiscoveryPassMessages({
      query,
      objective,
      uniqueSeeds,
      shapedSeeds,
      rankedPreferred: [...rankedPreferred],
      shapedProfile,
      discoveryScopeHint,
      preReadByPath,
      perFileChars,
      windowPolicy,
      seeds,
      qualityFloor,
      preferSymbolEvidence,
      collector,
      qualityFloorNudge,
    });

    stopReason = await runDiscoveryPassModelLoop({
      runtime,
      runId,
      bus,
      signal,
      budget,
      warnings,
      windowPolicy,
      workspaceRoot: workspaceRoot!,
      pinnedState,
      grant,
      tools,
      messages,
      collector,
      discoveryBudget,
      qualityFloor,
      preferSymbolEvidence,
      minSearches,
      canForceTools,
      qualityFloorNudge,
      preReadByPath,
      perFileChars,
      stopReason,
    });
  } else {
    reasonCodes.push("discovery_skipped");
  }

  const finished = finishDiscoveryPass({
    runtime,
    runId,
    bus,
    objective,
    evidence,
    collector,
    explicitTargets,
    qualityFloor,
    thoroughEvidence,
    requireSymbolEvidence,
    minSearches,
    stopReason,
    reasonCodes,
    warnings,
  });
  return { ...finished, collector };
}
