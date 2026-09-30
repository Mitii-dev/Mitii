import type { ExecutionDecision } from "../../../modules/decision-policy";
import { buildVerificationGrant } from "../../../modules/decision-policy";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { RepoBuildState } from "../../../modules/verification";

import {
  buildPreflightVerificationInput,
  buildSyntheticPreflightGrant,
} from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { logVerbosityAtLeast } from "../internal/logVerbosity";
import type { AgentEngineRuntime } from "./runtime";

export async function resolveAndPinState(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  envelope: UserRequestEnvelope;
  input: AgentEngineStartInput;
  bus: EventBus;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
}): Promise<RepositoryStateReference | undefined> {
  const { runId, envelope, input, bus, reasonCodes, warnings } = params;

  let reference = input.repositoryState?.reference;

  if (!reference && runtime.deps.repositoryState && envelope.workspace) {
    const latest = await runtime.deps.repositoryState.getLatest(
      envelope.workspace.workspaceId,
    );
    if (latest) {
      reference = {
        workspaceId: latest.workspaceId,
        stateToken: latest.stateToken,
      };
    }
  }

  if (!reference) {
    return undefined;
  }

  if (runtime.deps.repositoryState) {
    const pinResult = await runtime.deps.repositoryState.pin({
      state: reference,
      runId,
    });
    if (pinResult.status === "failed") {
      warnings.push(pinResult.message);
      reasonCodes.push("state_unavailable");
      if (logVerbosityAtLeast(input.logVerbosity, "standard")) {
        runtime.emit(bus, {
          type: "warning",
          runId,
          message: pinResult.message,
          code: "state_unavailable",
          stage: "received",
          at: runtime.isoNow(),
        });
      }
      return undefined;
    }
    reasonCodes.push("state_pinned");
    runtime.emit(bus, {
      type: "state_pinned",
      runId,
      state: reference,
      at: runtime.isoNow(),
    });
  }

  return reference;
}

/**
 * Capture a before-state build snapshot.
 *
 * Two callers:
 *  - Agent execute, `unconditional: true`, called before Decision Policy
 *    has run (no `decision`/`understanding` yet) — uses a conservative
 *    synthesized read-only grant so errors can inform classification.
 *    The caller gates this on repair/mutation-shaped asks, not every
 *    Agent chat.
 *  - Plan mode (repair intent), gated on `decision.reasonCodes` as before,
 *    using the real decision-derived grant. Skipped entirely when the
 *    Agent-mode capture already ran.
 */
export async function capturePreflightBuildState(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  decision?: ExecutionDecision;
  understanding?: RequestUnderstandingResult;
  input: AgentEngineStartInput;
  pinnedState: RepositoryStateReference | undefined;
  contextPaths: readonly string[];
  bus: EventBus;
  signal: AbortSignal;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  unconditional?: boolean;
  mentionedPaths?: readonly string[];
}): Promise<RepoBuildState | undefined> {
  const {
    runId,
    decision,
    understanding,
    input,
    pinnedState,
    contextPaths,
    bus,
    signal,
    reasonCodes,
    warnings,
    unconditional = false,
    mentionedPaths = [],
  } = params;

  if (
    !unconditional &&
    !decision?.reasonCodes.includes("preflight_build_recommended")
  ) {
    return undefined;
  }
  if (
    !runtime.deps.verification?.captureBuildState ||
    !pinnedState ||
    !input.workspaceRoot
  ) {
    if (!unconditional) {
      warnings.push(
        "Preflight build snapshot was recommended but verification infrastructure is unavailable.",
      );
    }
    return undefined;
  }

  runtime.emitStage(bus, runId, "verifying", "started");
  try {
    if (signal.aborted) {
      warnings.push("Preflight build snapshot was cancelled.");
      runtime.emitStage(bus, runId, "verifying", "completed", []);
      return undefined;
    }
    const verificationGrant = decision
      ? buildVerificationGrant(decision.toolGrant)
      : buildVerificationGrant(
          buildSyntheticPreflightGrant(input.workspaceRoot),
        );
    const buildState = await runtime.deps.verification.captureBuildState(
      buildPreflightVerificationInput({
        decision,
        understanding,
        input,
        pinnedState,
        verificationGrant,
        contextPaths,
        pathScopes: decision?.toolGrant.pathScopes ?? ["."],
        mentionedPaths,
      }),
      { phase: "before", capturedAt: runtime.isoNow() },
      { signal },
    );
    if (signal.aborted) {
      warnings.push("Preflight build snapshot was cancelled.");
      runtime.emitStage(bus, runId, "verifying", "completed", []);
      return undefined;
    }
    reasonCodes.push("repo_build_state_before_captured");
    runtime.emitStage(bus, runId, "verifying", "completed", [
      "repo_build_state_before_captured",
    ]);
    return buildState;
  } catch (error) {
    warnings.push(
      `Preflight build snapshot failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    runtime.emitStage(bus, runId, "verifying", "completed", []);
    return undefined;
  }
}

