/**
 * Run verification checks + emit comparison/evidence when the gate requires them.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import { buildVerificationGrant } from "../../../modules/decision-policy";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import { VERIFICATION_SCHEMA_VERSION } from "../../../modules/verification";
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationResult,
} from "../../../modules/verification";

import {
  resolveVerificationProjects,
  recordBuildStateDeltaEvidence,
  recordVerificationEvidence,
} from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { AgentEngineRuntime } from "./runtime";
import { emitVerificationCompleted } from "./verificationArtifacts";
import { resolveVerificationImpactWiden } from "./resolveVerificationImpactWiden";
import {
  applyRepoBuildStateComparisonReasonCodes,
  captureBuildStateFromVerificationResult,
} from "./verificationGateBuildState";

export async function runVerificationGateChecks(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  decision: ExecutionDecision;
  input: AgentEngineStartInput;
  pinnedState: RepositoryStateReference;
  changedFiles: readonly string[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  repoBuildStateBefore?: RepoBuildState;
  onRepoBuildStateAfter?: (state: RepoBuildState) => void;
  evidence?: RunEvidence;
  windowPolicy: WindowPolicy;
  signal: AbortSignal;
  askScopePaths?: readonly string[];
  impactAffectedFiles?: readonly string[];
  impactWidenVerification?: boolean;
}): Promise<{
  verificationResult: VerificationResult;
  comparison: RepoBuildStateComparison | undefined;
}> {
  const {
    runtime,
    runId,
    bus,
    decision,
    input,
    pinnedState,
    changedFiles,
    reasonCodes,
    warnings,
    repoBuildStateBefore,
    onRepoBuildStateAfter,
    evidence,
    windowPolicy,
    signal,
  } = params;

  runtime.emitStage(bus, runId, "verifying", "started");
  const verificationGrant = buildVerificationGrant(decision.toolGrant);
  const projects = resolveVerificationProjects(input);
  const impactWiden = await resolveVerificationImpactWiden({
    repoGraphs: runtime.deps.repoGraphs,
    changedFiles,
    explicitAffectedFiles: params.impactAffectedFiles,
    explicitWiden: params.impactWidenVerification,
    signal,
  });
  if (impactWiden.widenScope || impactWiden.impactAffectedFiles?.length) {
    warnings.push(
      "Verification scope widened from change-impact affected files.",
    );
  }
  const verificationResult = await runtime.deps.verification!.verify({
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    workspaceRoot: input.workspaceRoot!,
    pinnedState,
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
    ...(typeof impactWiden.widenScope === "boolean"
      ? { widenScope: impactWiden.widenScope }
      : {}),
    ...(impactWiden.impactAffectedFiles
      ? { impactAffectedFiles: impactWiden.impactAffectedFiles }
      : {}),
  });
  let comparison: RepoBuildStateComparison | undefined;
  const afterState = captureBuildStateFromVerificationResult(runtime, {
    input: {
      schemaVersion: VERIFICATION_SCHEMA_VERSION,
      workspaceRoot: input.workspaceRoot!,
      pinnedState,
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
      askScopePaths: params.askScopePaths,
      changedFiles,
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
  return { verificationResult, comparison };
}
