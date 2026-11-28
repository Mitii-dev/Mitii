/**
 * Run live discovery pass + post-discovery clarify gates for enrichment planning.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import {
  askNeedsPlanScopeFork,
  thinDiscoveryBriefForClarify,
  type DiscoveryBrief,
  type PlanStrategyDecision,
  type PlanningInput,
} from "../../../modules/planning";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  recordDiscoveryEvidence,
  collectTrustedSeedPaths,
} from "../actions";
import {
  clarifyAfterInsufficientPlanDiscovery,
  shouldClarifyAfterPlanDiscovery,
} from "../modules/plan-discovery";
import type { DiscoveryPassBudget } from "../modules/plan-discovery";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import { runDiscoveryPass } from "./pinAndDiscovery";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";

export type EnrichmentDiscoveryPhaseResult = {
  discoveryBrief: DiscoveryBrief | undefined;
  strategyOverride: PlanStrategyDecision;
};

export async function runEnrichmentPlanningDiscoveryPhase(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  signal: AbortSignal;
  windowPolicy: WindowPolicy;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  shared: ExecuteStartSharedState;
  taskListRef: TaskListRef;
  runEvidence: RunEvidence;
  decision: ExecutionDecision;
  planningInput: PlanningInput;
  strategyOverride: PlanStrategyDecision;
  discoveryPreferredPaths: readonly string[];
  discoveryBudgetOverride: DiscoveryPassBudget | undefined;
  discoveryScopeHint: string | undefined;
  contextPaths: string[];
  candidateRelativePaths: string[];
  planQualityFloor: boolean;
  thoroughEvidence: boolean;
  mediumOrLarge: boolean;
  scopeChoiceResolved: boolean;
}): Promise<EnrichmentDiscoveryPhaseResult> {
  const {
    runtime,
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    budget,
    reasonCodes,
    warnings,
    shared,
    taskListRef,
    runEvidence,
    decision,
    planningInput,
    discoveryPreferredPaths,
    discoveryBudgetOverride,
    discoveryScopeHint,
    contextPaths,
    candidateRelativePaths,
    planQualityFloor,
    thoroughEvidence,
    mediumOrLarge,
    scopeChoiceResolved,
  } = params;

  let strategyOverride = params.strategyOverride;
  let discoveryBrief = planningInput.discoveryBrief;

  if (strategyOverride.strategy !== "discover_and_plan") {
    return { discoveryBrief, strategyOverride };
  }

  const discovery = await runDiscoveryPass(runtime, {
    runId,
    query: planningInput.query,
    objective:
      planningInput.evidence.requestedOutcomes?.[0] ?? planningInput.query,
    evidence: planningInput.evidence,
    decision,
    pinnedState: shared.pinnedState,
    workspaceRoot: input.workspaceRoot,
    bus,
    signal,
    budget,
    reasonCodes,
    warnings,
    taskListRef,
    windowPolicy,
    preferredPaths: discoveryPreferredPaths,
    seedPathHygiene: {
      knownPaths: [...contextPaths, ...candidateRelativePaths],
      trustedPaths: collectTrustedSeedPaths({
        seedPaths: shared.executionSeed?.paths,
        evidenceTargets: planningInput.evidence.targets,
        query: planningInput.query,
      }),
    },
    qualityFloor: planQualityFloor,
    thoroughEvidence,
    seedFirstDiscovery: mediumOrLarge,
    preferSymbols: mediumOrLarge,
    // Thorough Plan / Agent-visible: keep searching even when a preferred path is known.
    forceExploration: thoroughEvidence,
    taskSize: planningInput.evidence.taskSize,
    ...(discoveryBudgetOverride ? { discoveryBudgetOverride } : {}),
    ...(discoveryScopeHint ? { discoveryScopeHint } : {}),
  });
  discoveryBrief = discovery.brief;
  recordDiscoveryEvidence(runEvidence, {
    brief: discovery.brief,
    collector: discovery.collector,
    failed: discovery.failed,
  });
  runtime.emitEvidenceUpdated(bus, runId, runEvidence);
  // Discovery ran; skip Planning's Discover phase.
  strategyOverride = { ...strategyOverride, skipDiscover: true };
  // Use the discovery pass failure flag — never recompute with weaker options.
  // Clear single-outcome asks (and already-chosen A/B/C) draft from evidence
  // instead of forcing harness A/B/C chips.
  if (
    shouldClarifyAfterPlanDiscovery({
      qualityFloor: planQualityFloor,
      discoveryFailed: discovery.failed,
    })
  ) {
    const needsScopeFork = askNeedsPlanScopeFork({
      clarity: planningInput.evidence.clarity,
      primaryIntent: planningInput.evidence.primaryIntent,
      requestedOutcomes: planningInput.evidence.requestedOutcomes,
      query: planningInput.query,
    });
    if (scopeChoiceResolved || !needsScopeFork) {
      if (
        scopeChoiceResolved &&
        !reasonCodes.includes("plan_scope_choice_honored")
      ) {
        reasonCodes.push("plan_scope_choice_honored");
      }
      warnings.push(
        scopeChoiceResolved
          ? "Discovery quality floor was not fully met, but a plan scope choice was already resolved — drafting a concrete plan from available evidence."
          : "Discovery quality floor was not fully met, but the ask is a clear single outcome — drafting a concrete plan from available evidence (no A/B/C fork).",
      );
    } else {
      reasonCodes.push("plan_mode_discovery_insufficient");
      strategyOverride = clarifyAfterInsufficientPlanDiscovery(
        strategyOverride.confidence,
        { thorough: thoroughEvidence },
      );
      // Strip seed-read surfaces so Planning cannot draft Change skeletons.
      discoveryBrief = thinDiscoveryBriefForClarify(discoveryBrief);
    }
  }

  return { discoveryBrief, strategyOverride };
}
