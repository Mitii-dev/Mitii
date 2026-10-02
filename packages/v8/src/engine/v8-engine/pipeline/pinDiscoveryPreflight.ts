import type { ToolGrant } from "../../../modules/decision-policy";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  collectShapedDiscoveryHits,
  hasExplicitFilePathTargets,
  rankPathsForShapedDiscovery,
  resolveShapedDiscoveryProfile,
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
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { AgentEngineRuntime } from "./runtime";
import { executeDiscoveryToolCall } from "./pinDiscoveryTools";

export type DiscoverySeedAndShapedPreflightResult = {
  uniqueSeeds: string[];
  shapedProfile: ShapedDiscoveryProfile | undefined;
  shapedSeeds: string[];
  /** Full seed list before uniqueness/cap (used for empty-pre-read nudge). */
  seeds: string[];
  rankedPreferred: readonly string[];
  preReadByPath: Map<string, string>;
  perFileChars: number;
};

/**
 * Deterministic shaped-discovery preflight + preferred-path pre-read.
 * Medium seed-first may fall back to shaped search when seeds open nothing.
 */
export async function runDiscoverySeedAndShapedPreflight(params: {
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
  qualityFloor: boolean;
  seedFirstDiscovery: boolean;
  discoveryBudget: DiscoveryPassBudget;
  signal: AbortSignal;
  reasonCodes: AgentReasonCode[];
}): Promise<DiscoverySeedAndShapedPreflightResult> {
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
    preferredPaths,
    qualityFloor,
    seedFirstDiscovery,
    discoveryBudget,
    signal,
    reasonCodes,
  } = params;

  const shapedProfile = resolveShapedDiscoveryProfile(query);
  const rankedPreferred = shapedProfile
    ? rankPathsForShapedDiscovery(shapedProfile, preferredPaths)
    : preferredPaths;
  // When the prompt already names concrete files, skip broad shaped globs
  // (**/routes/**/*.ts etc.) and seed-read those paths instead.
  // Medium seed-first: same — prefer trusted/explicit seeds before shaped search.
  const hasSeedFilePaths = hasExplicitFilePathTargets([
    ...rankedPreferred,
    ...preferredPaths,
  ]);
  let skipShapedSearch = hasSeedFilePaths;
  if (skipShapedSearch) {
    reasonCodes.push("discovery_explicit_paths_skip_shaped_search");
  }
  if (seedFirstDiscovery && hasSeedFilePaths) {
    reasonCodes.push("discovery_seed_first");
  }
  let globHits: string[] =
    shapedProfile && !skipShapedSearch
      ? await collectShapedDiscoveryHits({
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
        })
      : [];
  let shapedSeeds = shapedProfile
    ? selectShapedDiscoverySeeds(shapedProfile, globHits, rankedPreferred)
    : [];
  // Quality floor: if scoring filtered every hit, still try top ranked paths.
  let qualityFallbackSeeds =
    qualityFloor && shapedSeeds.length === 0 && shapedProfile && !skipShapedSearch
      ? rankPathsForShapedDiscovery(shapedProfile, globHits).slice(0, 4)
      : [];
  // Seed-first: preferred / trusted paths before shaped hits.
  const seeds = (
    seedFirstDiscovery
      ? [
          ...rankedPreferred,
          ...preferredPaths,
          ...shapedSeeds,
          ...qualityFallbackSeeds,
        ]
      : [
          ...shapedSeeds,
          ...qualityFallbackSeeds.filter((path) => !shapedSeeds.includes(path)),
          ...rankedPreferred.filter(
            (path) =>
              !shapedSeeds.includes(path) &&
              !qualityFallbackSeeds.includes(path),
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
  const preReadByPath = new Map<string, string>();
  const perFileChars = Math.min(
    4_000,
    windowPolicy.compaction.toolResultContentChars,
  );
  for (const seedPath of uniqueSeeds) {
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

  // Medium seed-first with empty preferred paths: run shaped search now.
  // Or when preferred seeds failed to open any file — fall back to shaped.
  if (
    seedFirstDiscovery &&
    skipShapedSearch &&
    shapedProfile &&
    preReadByPath.size === 0 &&
    discoveryBudgetRemaining(collector) &&
    !signal.aborted
  ) {
    skipShapedSearch = false;
    reasonCodes.push("discovery_seed_insufficient_shaped_fallback");
    globHits = await collectShapedDiscoveryHits({
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
    for (const seedPath of [...shapedSeeds, ...qualityFallbackSeeds]) {
      if (!discoveryCanReadMore(collector) || signal.aborted) break;
      if (hasDiscoveryReadPath(collector, seedPath)) continue;
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

  return {
    uniqueSeeds,
    shapedProfile,
    shapedSeeds,
    seeds,
    rankedPreferred,
    preReadByPath,
    perFileChars,
  };
}
