import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type {
  RepoBuildState,
  VerificationResult,
} from "../../../modules/verification";

import {
  decideVerificationGate,
  requiresMutationForExecute,
  recordStopEvidence,
} from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import type { AgentEngineRuntime } from "./runtime";
import type { VerificationGateOutcome } from "./types";
import {
  applyVerificationAcceptSideEffects,
  commitMutations,
  tryCritiqueVerification,
} from "./verificationArtifacts";
export { isVerificationRetryAsk } from "./verificationRetryAsk";
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
export {
  applyRepoBuildStateComparisonReasonCodes,
  captureBuildStateFromVerificationResult,
} from "./verificationGateBuildState";
import { runVerificationGateChecks } from "./verificationGateRunChecks";

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
    signal?: AbortSignal;
    /** Trusted seed / ask paths for ask-scoped verification accept. */
    askScopePaths?: readonly string[];
    /** Optional prior change-impact tool output for verification widen. */
    impactAffectedFiles?: readonly string[];
    impactWidenVerification?: boolean;
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
  const signal = params.signal ?? new AbortController().signal;
  const steering = resolveSteeringFeatureFlags(input.steering);

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
  let comparison: Awaited<
    ReturnType<typeof runVerificationGateChecks>
  >["comparison"];

  const shouldRunVerificationChecks =
    changedFiles.length > 0 &&
    canVerify &&
    (decision.verification.required || Boolean(repoBuildStateBefore));

  if (shouldRunVerificationChecks) {
    const checks = await runVerificationGateChecks({
      runtime,
      runId,
      bus,
      decision,
      input,
      pinnedState: pinnedState!,
      changedFiles,
      reasonCodes,
      warnings,
      repoBuildStateBefore,
      onRepoBuildStateAfter,
      evidence,
      windowPolicy,
      signal,
      askScopePaths: params.askScopePaths,
      impactAffectedFiles: params.impactAffectedFiles,
      impactWidenVerification: params.impactWidenVerification,
    });
    verificationResult = checks.verificationResult;
    comparison = checks.comparison;
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
    askScopePaths: params.askScopePaths,
    changedFiles,
    minimumEvidence: decision.verification.minimumEvidence,
  });

  // Optional LLM critique is advisory only — never changes decisionOutcome.
  await tryCritiqueVerification(runtime, {
    enabled: steering.verificationLlmCritique,
    bus,
    runId,
    gateAction: decisionOutcome.action,
    verification: verificationResult,
    comparison,
    changedFiles,
    warnings,
    signal,
    logVerbosity: params.logVerbosity ?? input.logVerbosity,
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
