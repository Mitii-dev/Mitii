/**
 * Build-state capture + comparison reason codes for verification gate.
 */
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationInput,
  VerificationResult,
} from "../../../modules/verification";

import type { AgentReasonCode } from "../contracts";
import type { AgentEngineRuntime } from "./runtime";

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
    askScopePaths?: readonly string[];
    changedFiles?: readonly string[];
  },
): RepoBuildStateComparison | undefined {
  const comparison = runtime.deps.verification?.compareBuildStates?.({
    before: params.before,
    after: params.after,
    askScopePaths: params.askScopePaths,
    changedFiles: params.changedFiles,
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
