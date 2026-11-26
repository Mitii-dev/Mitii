import type { ToolGrant } from "../../../modules/decision-policy";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";

import type { ShapedDiscoveryProfile } from "../actions/shapedDiscovery";
import type { DiscoveryPassBudget } from "../modules/plan-discovery";
import type { AgentReasonCode } from "../contracts";
import type { createDiscoveryObservationCollector } from "../internal/discovery";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { AgentEngineRuntime } from "./runtime";
import { runDiscoveryPreflightSearch } from "./pinDiscoveryPreflightSearch";
import {
  maybeSeedFirstShapedFallback,
  preReadDiscoverySeeds,
} from "./pinDiscoveryPreflightReads";

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
  /**
   * Seed-path hygiene inputs: `knownPaths` is the run's (partial) path index;
   * `trustedPaths` are paths the user named and are never dropped as unindexed.
   */
  seedPathHygiene?: {
    knownPaths?: readonly string[];
    trustedPaths?: readonly string[];
  };
  qualityFloor: boolean;
  seedFirstDiscovery: boolean;
  /**
   * When true (Plan thorough), keep shaped/search even if preferred paths
   * already name concrete files.
   */
  forceExploration?: boolean;
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
    qualityFloor,
    seedFirstDiscovery,
    forceExploration = false,
    discoveryBudget,
    signal,
    reasonCodes,
  } = params;

  const search = await runDiscoveryPreflightSearch({
    runtime,
    runId,
    bus,
    budget,
    collector,
    grant,
    workspaceRoot,
    pinnedState,
    windowPolicy,
    query: params.query,
    preferredPaths: params.preferredPaths,
    seedPathHygiene: params.seedPathHygiene,
    qualityFloor,
    seedFirstDiscovery,
    forceExploration,
    discoveryBudget,
    signal,
    reasonCodes,
  });

  const preReadByPath = new Map<string, string>();
  const perFileChars = Math.min(
    4_000,
    windowPolicy.compaction.toolResultContentChars,
  );
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
    seedPaths: search.uniqueSeeds,
    perFileChars,
    signal,
    preReadByPath,
  });

  const fallback = await maybeSeedFirstShapedFallback({
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
    skipShapedSearch: search.skipShapedSearch,
    shapedProfile: search.shapedProfile,
    rankedPreferred: search.rankedPreferred,
    shapedSeeds: search.shapedSeeds,
    qualityFallbackSeeds: search.qualityFallbackSeeds,
    qualityFloor,
    discoveryBudget,
    signal,
    reasonCodes,
    preReadByPath,
    perFileChars,
  });

  return {
    uniqueSeeds: search.uniqueSeeds,
    shapedProfile: search.shapedProfile,
    shapedSeeds: fallback.shapedSeeds,
    seeds: search.seeds,
    rankedPreferred: search.rankedPreferred,
    preReadByPath,
    perFileChars,
  };
}
