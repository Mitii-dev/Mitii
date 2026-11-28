/**
 * Discovery-pass start: emit, budget, task list, symbol/search policy.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import { CODE_INTELLIGENCE_TOOL_IDS } from "../../../modules/decision-policy";
import type {
  DiscoveryTarget,
  PlanningInput,
} from "../../../modules/planning";
import type { WindowPolicy } from "../../../modules/window-budget";

import { inferDiscoveryTargetKind } from "../actions";
import {
  resolveDiscoveryPassBudget,
  resolvePlanDiscoveryMinSearches,
  shouldPreferDiscoverySymbolEvidence,
  shouldRequireDiscoverySymbolEvidence,
  type DiscoveryPassBudget,
} from "../modules/plan-discovery";
import type { AgentReasonCode } from "../contracts";
import {
  createDiscoveryObservationCollector,
  createDiscoveryTaskList,
} from "../internal/discovery";
import type { EventBus } from "../internal/EventBus";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";

export type DiscoveryPassSetup = {
  discoveryBudget: DiscoveryPassBudget;
  collector: ReturnType<typeof createDiscoveryObservationCollector>;
  explicitTargets: DiscoveryTarget[];
  canLoop: boolean;
  preferSymbolEvidence: boolean;
  requireSymbolEvidence: boolean;
  canForceTools: boolean;
  minSearches: number;
};

export function setupDiscoveryPass(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  objective: string;
  evidence: PlanningInput["evidence"];
  decision: ExecutionDecision;
  workspaceRoot: string | undefined;
  signal: AbortSignal;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  taskListRef: TaskListRef;
  windowPolicy: WindowPolicy;
  thoroughEvidence: boolean;
  preferSymbols: boolean;
  taskSize?: "small" | "medium" | "large" | string;
  discoveryBudgetOverride?: DiscoveryPassBudget;
}): DiscoveryPassSetup {
  const {
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
  } = params;

  runtime.emitStage(bus, runId, "discovery", "started");
  runtime.emit(bus, {
    type: "discovery_started",
    runId,
    objective: objective.slice(0, 500),
    at: runtime.isoNow(),
  });
  reasonCodes.push("discovery_started");

  const discoveryBudget =
    discoveryBudgetOverride ??
    resolveDiscoveryPassBudget(taskSize, windowPolicy.contextWindowTokens);
  const discoveryList = createDiscoveryTaskList();
  taskListRef.current = discoveryList;
  runtime.emitTaskListUpdated(bus, runId, discoveryList);

  const collector = createDiscoveryObservationCollector(discoveryBudget);
  const explicitTargets: DiscoveryTarget[] = (evidence.targets ?? []).map(
    (target) => ({
      kind: inferDiscoveryTargetKind(target.kind),
      value: target.value,
      reason: target.explicit ? "Explicit request target" : "Inferred target",
      explicit: target.explicit,
    }),
  );

  const canLoop =
    Boolean(runtime.deps.tools) &&
    Boolean(workspaceRoot) &&
    runtime.deps.llm.capabilities.supportsTools &&
    !signal.aborted;

  const preferSymbolEvidence = shouldPreferDiscoverySymbolEvidence({
    thorough: thoroughEvidence,
    preferSymbols,
    allowedTools: decision.toolGrant.allowedTools,
    reasonCodes: decision.reasonCodes,
    codeIntelligenceToolIds: CODE_INTELLIGENCE_TOOL_IDS,
  });
  const canForceTools =
    runtime.deps.llm.capabilities.supportsForcedToolChoice !== false;
  const requireSymbolEvidence = shouldRequireDiscoverySymbolEvidence({
    thorough: thoroughEvidence,
    allowedTools: decision.toolGrant.allowedTools,
    reasonCodes: decision.reasonCodes,
    codeIntelligenceToolIds: CODE_INTELLIGENCE_TOOL_IDS,
    supportsForcedToolChoice: canForceTools,
  });
  const minSearches = resolvePlanDiscoveryMinSearches({
    thorough: thoroughEvidence,
    taskSize,
  });
  if (preferSymbolEvidence && !requireSymbolEvidence) {
    warnings.push(
      "Code-intelligence tools are granted but this model cannot force tool_choice=required; discovery will nudge for symbols without failing the quality floor.",
    );
  }

  return {
    discoveryBudget,
    collector,
    explicitTargets,
    canLoop,
    preferSymbolEvidence,
    requireSymbolEvidence,
    canForceTools,
    minSearches,
  };
}
