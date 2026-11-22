
import type {
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";

import type { V8EngineThresholdsOverrides } from "../policy";
import { V8_ENGINE_THRESHOLDS } from "../policy";
import {
  type MutateReadinessBudget,
} from "../modules/mutate-readiness";
import {
  bindBudgetConsumptionSnapshot,
  buildEvidenceExhaustedTerminalOutcome,
  shouldOfferContinueAfterEvidenceExhaustion,
} from "../actions/resolveEvidenceTerminal";
import { upsertLedgerEntry } from "../actions/runEvidence";

export function pickV8ThresholdOverrides(
  raw: V8EngineThresholdsOverrides | Record<string, number> | undefined,
): V8EngineThresholdsOverrides | undefined {
  if (!raw) return undefined;
  const next: V8EngineThresholdsOverrides = {};
  for (const key of Object.keys(V8_ENGINE_THRESHOLDS) as Array<
    keyof typeof V8_ENGINE_THRESHOLDS
  >) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = value;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/** bind+recovery spent → hard STOP (no Continue rediscovery). */
export function finishEvidenceRailExhausted(params: {
  reason: "recovery_exhausted" | "miss_not_local";
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  evidence: RunEvidence | undefined;
  budget: MutateReadinessBudget;
  nudgesUsed: number;
  recoveryUsed: boolean;
  readonlyTurnsOnStep: number;
}): ToolLoopOutcome {
  const terminal = buildEvidenceExhaustedTerminalOutcome({
    reason: params.reason,
  });
  params.reasonCodes.push(...terminal.reasonCodesToPush);
  // Policy lock: Continue after exhaustion is illegal.
  void shouldOfferContinueAfterEvidenceExhaustion();
  const snapshot = bindBudgetConsumptionSnapshot({
    maxTurns: params.budget.readonlyTurnsBeforeGate,
    maxPaths: params.budget.maxEvidencePaths,
    maxNudges: params.budget.maxEvidenceGateNudgesBeforePatchDemand,
    recoveryTurns: params.budget.evidenceRecoveryTurns,
    recoveryPaths: params.budget.evidenceRecoveryMaxPaths,
    nudgesUsed: params.nudgesUsed,
    recoveryUsed: params.recoveryUsed,
    readonlyTurnsOnStep: params.readonlyTurnsOnStep,
  });
  params.warnings.push(
    `Bind budget exhausted (nudges=${snapshot.nudgesUsed}/${snapshot.maxNudges}, recoveryUsed=${String(snapshot.recoveryUsed)}).`,
  );
  params.runtime.emit(params.bus, {
    type: "warning",
    runId: params.runId,
    message: "Bind/evidence budget exhausted — discovery rail terminal.",
    code: "bind_budget_consumed",
    data: snapshot,
    at: params.runtime.isoNow(),
  });
  if (params.evidence) {
    upsertLedgerEntry(params.evidence, {
      id: "bind-budget-exhausted",
      kind: "stop",
      summary: `Bind budget exhausted: nudges ${String(snapshot.nudgesUsed)}/${String(snapshot.maxNudges)}, recovery=${String(snapshot.recoveryUsed)}`,
      status: "evidence_exhausted",
      paths: [],
      issueIds: [],
    });
  }
  return {
    kind: "failed",
    answer: terminal.answer,
    extraReasons: terminal.extraReasons,
    error: terminal.error,
  };
}
