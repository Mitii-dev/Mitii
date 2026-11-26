/**
 * Shaped/search preflight: hygiene, profile, glob hits, and seed candidate list.
 */
import type { ToolGrant } from "../../../modules/decision-policy";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  collectForceExplorationFallbackHits,
  collectShapedDiscoveryHits,
  hasExplicitFilePathTargets,
  rankPathsForShapedDiscovery,
  resolveShapedDiscoveryProfile,
  selectShapedDiscoverySeeds,
  type ShapedDiscoveryProfile,
} from "../actions/shapedDiscovery";
import { resolveDiscoverySeedPaths } from "../actions/discoverySeedPaths";
import type { DiscoveryPassBudget } from "../modules/plan-discovery";
import type { AgentReasonCode } from "../contracts";
import {
  createDiscoveryObservationCollector,
  discoveryBudgetRemaining,
} from "../internal/discovery";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { AgentEngineRuntime } from "./runtime";
import { executeDiscoveryToolCall } from "./pinDiscoveryTools";

export type DiscoveryPreflightSearchResult = {
  shapedProfile: ShapedDiscoveryProfile | undefined;
  rankedPreferred: readonly string[];
  preferredPaths: readonly string[];
  skipShapedSearch: boolean;
  globHits: string[];
  shapedSeeds: string[];
  qualityFallbackSeeds: string[];
  uniqueSeeds: string[];
  seeds: string[];
};

export async function runDiscoveryPreflightSearch(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  budget: RunBudgetTracker;
  collector: ReturnType<typeof createDiscoveryObservationCollector>;
  grant: ToolGrant;
  workspaceRoot: string;
  pinnedState: RepositoryStateReference | undefined;
  windowPolicy: WindowPolicy;
  query: string;
  preferredPaths: readonly string[];
  seedPathHygiene?: {
    knownPaths?: readonly string[];
    trustedPaths?: readonly string[];
  };
  qualityFloor: boolean;
  seedFirstDiscovery: boolean;
  forceExploration: boolean;
  discoveryBudget: DiscoveryPassBudget;
  signal: AbortSignal;
  reasonCodes: AgentReasonCode[];
}): Promise<DiscoveryPreflightSearchResult> {
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
    query,
    qualityFloor,
    seedFirstDiscovery,
    forceExploration,
    discoveryBudget,
    signal,
    reasonCodes,
  } = params;

  // Never spend read_file on prose tokens or unresolvable basenames/globs.
  const seedHygiene = resolveDiscoverySeedPaths({
    paths: params.preferredPaths,
    knownPaths: params.seedPathHygiene?.knownPaths,
    trustedPaths: params.seedPathHygiene?.trustedPaths,
  });
  const preferredPaths = seedHygiene.kept;
  if (seedHygiene.dropped.length > 0 || seedHygiene.rewritten.length > 0) {
    reasonCodes.push("discovery_seed_paths_filtered");
  }

  const shapedProfile = resolveShapedDiscoveryProfile(query);
  const rankedPreferred = shapedProfile
    ? rankPathsForShapedDiscovery(shapedProfile, preferredPaths)
    : preferredPaths;
  // When the prompt already names concrete files, skip broad shaped globs
  // (**/routes/**/*.ts etc.) and seed-read those paths instead.
  // Medium seed-first: same — prefer trusted/explicit seeds before shaped search.
  // Plan thorough forceExploration keeps search so known entry files cannot
  // short-circuit discovery to a hollow one-file plan.
  const hasSeedFilePaths = hasExplicitFilePathTargets([
    ...rankedPreferred,
    ...preferredPaths,
  ]);
  let skipShapedSearch = hasSeedFilePaths && !forceExploration;
  if (hasSeedFilePaths && forceExploration) {
    reasonCodes.push("discovery_force_exploration");
  } else if (skipShapedSearch) {
    reasonCodes.push("discovery_explicit_paths_skip_shaped_search");
  }
  if (seedFirstDiscovery && hasSeedFilePaths) {
    reasonCodes.push("discovery_seed_first");
  }
  const executeSearchTool = async (
    toolName: "glob_files" | "search_files",
    argumentsValue: Record<string, unknown>,
  ) => {
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
  };
  const searchShouldContinue = () =>
    discoveryBudgetRemaining(collector) &&
    collector.searches < discoveryBudget.maxSearches &&
    !signal.aborted;

  let globHits: string[] =
    shapedProfile && !skipShapedSearch
      ? await collectShapedDiscoveryHits({
          profile: shapedProfile,
          shouldContinue: searchShouldContinue,
          executeTool: executeSearchTool,
        })
      : [];

  // Plan thorough with no matching profile: still search from query tokens.
  if (
    forceExploration &&
    !shapedProfile &&
    !skipShapedSearch &&
    searchShouldContinue()
  ) {
    reasonCodes.push("discovery_force_exploration_fallback");
    globHits = await collectForceExplorationFallbackHits({
      query,
      shouldContinue: searchShouldContinue,
      executeTool: executeSearchTool,
    });
  }

  const shapedSeeds = shapedProfile
    ? selectShapedDiscoverySeeds(shapedProfile, globHits, rankedPreferred)
    : [];
  // Quality floor: if scoring filtered every hit, still try top ranked paths.
  const qualityFallbackSeeds =
    qualityFloor && shapedSeeds.length === 0 && shapedProfile && !skipShapedSearch
      ? rankPathsForShapedDiscovery(shapedProfile, globHits).slice(0, 4)
      : [];
  // No profile: use fallback search hits as additional seed candidates.
  const fallbackSeeds =
    !shapedProfile && globHits.length > 0
      ? globHits.filter((path) => path.includes(".")).slice(0, 4)
      : [];
  // Seed-first: preferred / trusted paths before shaped hits.
  const seeds = (
    seedFirstDiscovery
      ? [
          ...rankedPreferred,
          ...preferredPaths,
          ...shapedSeeds,
          ...qualityFallbackSeeds,
          ...fallbackSeeds,
        ]
      : [
          ...shapedSeeds,
          ...qualityFallbackSeeds.filter((path) => !shapedSeeds.includes(path)),
          ...fallbackSeeds.filter(
            (path) =>
              !shapedSeeds.includes(path) &&
              !qualityFallbackSeeds.includes(path),
          ),
          ...rankedPreferred.filter(
            (path) =>
              !shapedSeeds.includes(path) &&
              !qualityFallbackSeeds.includes(path) &&
              !fallbackSeeds.includes(path),
          ),
        ]
  )
    .map((path) => path.trim())
    .filter((path) => path.length > 0 && path.includes("."));
  const uniqueSeeds: string[] = [];
  const seenSeed = new Set<string>();
  for (const path of seeds) {
    const key = path.replace(/\\/g, "/").toLowerCase();
    if (seenSeed.has(key)) continue;
    seenSeed.add(key);
    uniqueSeeds.push(path);
    if (uniqueSeeds.length >= Math.min(6, discoveryBudget.maxFileReads)) {
      break;
    }
  }

  return {
    shapedProfile,
    rankedPreferred,
    preferredPaths,
    skipShapedSearch,
    globHits,
    shapedSeeds,
    qualityFallbackSeeds,
    uniqueSeeds,
    seeds,
  };
}
