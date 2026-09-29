import type { ExecutionDecision } from "../../../modules/decision-policy";
import { buildVerificationGrant } from "../../../modules/decision-policy";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import { VERIFICATION_SCHEMA_VERSION } from "../../../modules/verification";
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationInput,
  VerificationResult,
} from "../../../modules/verification";

import {
  decideVerificationGate,
  requiresMutationForExecute,
  resolveVerificationProjects,
  recordBuildStateDeltaEvidence,
  recordStopEvidence,
  recordVerificationEvidence,
} from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import type { AgentEngineRuntime } from "./runtime";
import type { VerificationGateOutcome } from "./types";
import {
  applyVerificationAcceptSideEffects,
  commitMutations,
  emitVerificationCompleted,
} from "./verificationArtifacts";
export { isVerificationRetryAsk } from "./verificationRetryAsk";

export function captureBuildStateFromVerificationResult(
  runtime: AgentEngineRuntime,
  params: {
    input: VerificationInput;
    result: VerificationResult;
    phase: "before" | "after";
  },
): RepoBuildState | undefined {
  return runtime.deps.verification?.buildStateFromResult?.(
    params.input,
    params.result,
    {
      phase: params.phase,
      capturedAt: runtime.isoNow(),
    },
  );
}

export function applyRepoBuildStateComparisonReasonCodes(
  runtime: AgentEngineRuntime,
  params: {
    before: RepoBuildState | undefined;
    after: RepoBuildState;
    reasonCodes: AgentReasonCode[];
  },
): RepoBuildStateComparison | undefined {
  const comparison = runtime.deps.verification?.compareBuildStates?.({
    before: params.before,
    after: params.after,
  });
  if (!comparison) {
    return undefined;
  }
  if (comparison.reasonCodes.includes("errors_cleared")) {
    params.reasonCodes.push("repo_build_state_errors_cleared");
  }
  if (comparison.reasonCodes.includes("errors_remaining")) {
    params.reasonCodes.push("repo_build_state_errors_remaining");
  }
  if (comparison.reasonCodes.includes("new_errors_introduced")) {
    params.reasonCodes.push("repo_build_state_new_errors");
  }
  return comparison;
}

/**
 * Gate completion on Verification when the decision requires it and a
 * mutation changed files. Commits on accept; leaves rollback to the caller
 * on reject (after an optional repair pass for verification_failed only).
 */
export async function runVerificationGate(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    bus: EventBus;
    decision: ExecutionDecision;
    primaryTaskIntent?: string;
    input: AgentEngineStartInput;
    pinnedState: RepositoryStateReference | undefined;
    changedFiles: readonly string[];
    mutationCheckpointIds: readonly string[];
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    repoBuildStateBefore?: RepoBuildState;
    onRepoBuildStateAfter?: (state: RepoBuildState) => void;
    evidence?: RunEvidence;
    windowPolicy: WindowPolicy;
    logVerbosity?: AgentLogVerbosity;
  },
): Promise<VerificationGateOutcome> {
  const {
    runId,
    bus,
    decision,
    primaryTaskIntent,
    input,
    pinnedState,
    changedFiles,
    mutationCheckpointIds,
    reasonCodes,
    warnings,
    repoBuildStateBefore,
    onRepoBuildStateAfter,
    evidence,
    windowPolicy,
  } = params;

  const missingInfrastructure: string[] = [];
  if (runtime.deps.verification === undefined) {
    missingInfrastructure.push("verification port");
  }
  if (pinnedState === undefined) {
    missingInfrastructure.push("pinned state");
  }
  if (input.workspaceRoot === undefined) {
    missingInfrastructure.push("workspace root");
  }
  const canVerify = missingInfrastructure.length === 0;

  let verificationResult: VerificationResult | undefined;
  let comparison: RepoBuildStateComparison | undefined;

  const shouldRunVerificationChecks =
    changedFiles.length > 0 &&
    canVerify &&
    (decision.verification.required || Boolean(repoBuildStateBefore));

  if (shouldRunVerificationChecks) {
    runtime.emitStage(bus, runId, "verifying", "started");
    const verificationGrant = buildVerificationGrant(decision.toolGrant);
    const projects = resolveVerificationProjects(input);
    verificationResult = await runtime.deps.verification!.verify({
      schemaVersion: VERIFICATION_SCHEMA_VERSION,
      workspaceRoot: input.workspaceRoot!,
      pinnedState: pinnedState!,
      changedFiles: [...changedFiles],
      projects,
      verification: decision.verification.required
        ? decision.verification
        : {
            ...decision.verification,
            required: true,
            allowUnavailable: true,
          },
      grant: verificationGrant,
      changeScope: "localized",
      baselineDiagnostics: repoBuildStateBefore?.diagnostics,
      stateReadiness: input.repositoryState?.readiness ?? "ready",
      maxChecks: windowPolicy.maxVerificationChecks,
    });
    const afterState = captureBuildStateFromVerificationResult(runtime, {
      input: {
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        workspaceRoot: input.workspaceRoot!,
        pinnedState: pinnedState!,
        changedFiles: [...changedFiles],
        projects,
        verification: decision.verification,
        grant: verificationGrant,
        changeScope: "localized",
        stateReadiness: input.repositoryState?.readiness ?? "ready",
        baselineDiagnostics: repoBuildStateBefore?.diagnostics,
      },
      result: verificationResult,
      phase: "after",
    });
    if (afterState) {
      onRepoBuildStateAfter?.(afterState);
      recordBuildStateDeltaEvidence(evidence, {
        before: repoBuildStateBefore,
        after: afterState,
      });
      reasonCodes.push("repo_build_state_after_captured");
      comparison = applyRepoBuildStateComparisonReasonCodes(runtime, {
        before: repoBuildStateBefore,
        after: afterState,
        reasonCodes,
      });
    }
    recordVerificationEvidence(evidence, {
      verification: verificationResult,
      before: repoBuildStateBefore,
    });
    emitVerificationCompleted(runtime, bus, runId, verificationResult);
    runtime.emitEvidenceUpdated(bus, runId, evidence);
    if (afterState) {
      runtime.emitRepoBuildStateCaptured(bus, runId, afterState);
    }
    if (comparison) {
      runtime.emit(bus, {
        type: "verification_comparison",
        runId,
        beforeErrorCount: comparison.beforeErrorCount,
        afterErrorCount: comparison.afterErrorCount,
        clearedErrorCount: comparison.clearedErrorCount,
        newErrorCount: comparison.newErrorCount,
        remainingErrorCount: comparison.remainingErrorCount,
        newWarningCount: comparison.newWarningCount,
        clearedWarningCount: comparison.clearedWarningCount,
        failedCheckIdsAfter: comparison.failedCheckIdsAfter.slice(0, 16),
        reasonCodes: comparison.reasonCodes.slice(0, 16),
        at: runtime.isoNow(),
      });
    }
  }

  const decisionOutcome = decideVerificationGate({
    verificationRequired: decision.verification.required,
    allowUnavailable: decision.verification.allowUnavailable,
    changedFileCount: changedFiles.length,
    mutationRequired: requiresMutationForExecute({
      route: decision.route,
      maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
      primaryTaskIntent,
      reasonCodes: decision.reasonCodes,
      allowedTools: decision.toolGrant.allowedTools,
    }),
    canVerify,
    missingInfrastructure,
    verification: verificationResult,
    comparison,
  });

  if (decisionOutcome.action === "accept") {
    applyVerificationAcceptSideEffects(runtime, {
      bus,
      runId,
      acceptKind: decisionOutcome.acceptKind,
      verification: verificationResult,
      reasonCodes,
      warnings,
    });
    commitMutations(runtime, mutationCheckpointIds, {
      runId,
      bus,
      warnings,
      logVerbosity: input.logVerbosity,
    });
    recordStopEvidence(evidence, decisionOutcome.acceptKind);
    runtime.emitEvidenceUpdated(bus, runId, evidence);
    return {
      kind: "ok",
      acceptKind: decisionOutcome.acceptKind,
      verification: verificationResult,
      comparison,
    };
  }

  runtime.emitStage(bus, runId, "verifying", "completed", [
    "verification_failed",
  ]);
  return {
    kind: "failed",
    repairable: decisionOutcome.repairable,
    rejectKind: decisionOutcome.rejectKind,
    error: decisionOutcome.error,
    verification: decisionOutcome.verification,
    comparison,
  };
}
