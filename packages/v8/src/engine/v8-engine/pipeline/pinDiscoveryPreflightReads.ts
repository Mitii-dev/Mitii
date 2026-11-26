/**
 * Pre-read discovery seeds + seed-first shaped fallback when nothing opened.
 */
import type { ToolGrant } from "../../../modules/decision-policy";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  collectShapedDiscoveryHits,
  rankPathsForShapedDiscovery,
  selectShapedDiscoverySeeds,
  type ShapedDiscoveryProfile,
} from "../actions/shapedDiscovery";
import type { DiscoveryPassBudget } from "../modules/plan-discovery";
import type { AgentReasonCode } from "../contracts";
import {
  createDiscoveryObservationCollector,
  discoveryBudgetRemaining,
  discoveryCanReadMore,
  extractDiscoveryReadText,
  hasDiscoveryReadPath,
} from "../internal/discovery";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { AgentEngineRuntime } from "./runtime";
import { executeDiscoveryToolCall } from "./pinDiscoveryTools";

export async function preReadDiscoverySeeds(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  budget: RunBudgetTracker;
  collector: ReturnType<typeof createDiscoveryObservationCollector>;
  grant: ToolGrant;
  workspaceRoot: string;
  pinnedState: RepositoryStateReference | undefined;
  windowPolicy: WindowPolicy;
  seedPaths: readonly string[];
  perFileChars: number;
  signal: AbortSignal;
  preReadByPath: Map<string, string>;
}): Promise<void> {
  const {
    runtime,
    runId,
    bus,
    budget,
    collector,
    grant,
    workspaceRoot,
    pinnedState,
    windowPolicy,
    seedPaths,
    perFileChars,
    signal,
    preReadByPath,
  } = params;

  for (const seedPath of seedPaths) {
    // Do not gate seed reads on search budget — shaped preflight often
    // spends the search allotment before any file is opened.
    if (!discoveryCanReadMore(collector) || signal.aborted) {
      break;
    }
    if (hasDiscoveryReadPath(collector, seedPath)) {
      continue;
    }
    const seedResult = await executeDiscoveryToolCall(runtime, {
      runId,
      bus,
      budget,
      collector,
      grant,
      workspaceRoot,
      pinnedState,
      windowPolicy,
      toolName: "read_file",
      argumentsValue: { path: seedPath },
    });
    if (seedResult?.status === "succeeded") {
      const text = extractDiscoveryReadText(seedResult.output);
      if (text.length > 0) {
        preReadByPath.set(
          seedPath.replace(/\\/g, "/").replace(/^\.\//, ""),
          text.slice(0, perFileChars),
        );
      }
    }
  }
}

export async function maybeSeedFirstShapedFallback(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  budget: RunBudgetTracker;
  collector: ReturnType<typeof createDiscoveryObservationCollector>;
  grant: ToolGrant;
  workspaceRoot: string;
  pinnedState: RepositoryStateReference | undefined;
  windowPolicy: WindowPolicy;
  seedFirstDiscovery: boolean;
  skipShapedSearch: boolean;
  shapedProfile: ShapedDiscoveryProfile | undefined;
  rankedPreferred: readonly string[];
  shapedSeeds: string[];
  qualityFallbackSeeds: string[];
  qualityFloor: boolean;
  discoveryBudget: DiscoveryPassBudget;
  signal: AbortSignal;
  reasonCodes: AgentReasonCode[];
  preReadByPath: Map<string, string>;
  perFileChars: number;
}): Promise<{
  skipShapedSearch: boolean;
  shapedSeeds: string[];
  qualityFallbackSeeds: string[];
}> {
  const {
    runtime,
    runId,
    bus,
    budget,
    collector,
    grant,
    workspaceRoot,
    pinnedState,
    windowPolicy,
    seedFirstDiscovery,
    shapedProfile,
    rankedPreferred,
    qualityFloor,
    discoveryBudget,
    signal,
    reasonCodes,
    preReadByPath,
    perFileChars,
  } = params;

  let skipShapedSearch = params.skipShapedSearch;
  let shapedSeeds = params.shapedSeeds;
  let qualityFallbackSeeds = params.qualityFallbackSeeds;

  // Medium seed-first with empty preferred paths: run shaped search now.
  // Or when preferred seeds failed to open any file — fall back to shaped.
  if (
    !(
      seedFirstDiscovery &&
      skipShapedSearch &&
      shapedProfile &&
      preReadByPath.size === 0 &&
      discoveryBudgetRemaining(collector) &&
      !signal.aborted
    )
  ) {
    return { skipShapedSearch, shapedSeeds, qualityFallbackSeeds };
  }

  skipShapedSearch = false;
  reasonCodes.push("discovery_seed_insufficient_shaped_fallback");
  const globHits = await collectShapedDiscoveryHits({
    profile: shapedProfile,
    shouldContinue: () =>
      discoveryBudgetRemaining(collector) &&
      collector.searches < discoveryBudget.maxSearches &&
      !signal.aborted,
    executeTool: async (toolName, argumentsValue) => {
      const result = await executeDiscoveryToolCall(runtime, {
        runId,
        bus,
        budget,
        collector,
        grant,
        workspaceRoot,
        pinnedState,
        windowPolicy,
        toolName,
        argumentsValue,
      });
      return result?.output;
    },
  });
  shapedSeeds = selectShapedDiscoverySeeds(
    shapedProfile,
    globHits,
    rankedPreferred,
  );
  qualityFallbackSeeds =
    qualityFloor && shapedSeeds.length === 0
      ? rankPathsForShapedDiscovery(shapedProfile, globHits).slice(0, 4)
      : [];
  await preReadDiscoverySeeds({
    runtime,
    runId,
    bus,
    budget,
    collector,
    grant,
    workspaceRoot,
    pinnedState,
    windowPolicy,
    seedPaths: [...shapedSeeds, ...qualityFallbackSeeds],
    perFileChars,
    signal,
    preReadByPath,
  });

  return { skipShapedSearch, shapedSeeds, qualityFallbackSeeds };
}
