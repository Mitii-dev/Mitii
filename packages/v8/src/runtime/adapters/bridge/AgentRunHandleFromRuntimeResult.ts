import { AGENT_ENGINE_SCHEMA_VERSION } from "../../../engine/v8-engine/legacy/constants";
import type {
  AgentRunHandle,
  AgentRunResult,
} from "../../../engine/v8-engine/contracts";
import type { RuntimeRunResult } from "../../contracts/output/RuntimeRunResult";
import {
  buildRuntimeBridgeEvents,
  type RuntimeBridgeSkipPhase,
} from "./BuildRuntimeBridgeEvents";

/**
 * Map RuntimeRunResult → AgentRunHandle (P8 dual-run / MitiiRun bridge).
 * Emits stage / decision / tool / model / suspended / terminal events.
 */
export function createAgentRunHandleFromRuntimeResult(
  runtime: RuntimeRunResult,
  options?: { skipPhases?: RuntimeBridgeSkipPhase[] },
): AgentRunHandle {
  const at = new Date().toISOString();
  const status = mapStatus(runtime.status);
  const route = mapRoute(runtime.route) ?? "direct_answer";
  const suspensionKind =
    status === "suspended" ? mapSuspensionKind(runtime.gateKind) : undefined;

  const result: AgentRunResult = {
    schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
    runId: runtime.runId,
    requestId: runtime.runId,
    status,
    route,
    planningDepth: mapPlanningDepth(runtime.planningDepth),
    answer:
      status === "completed"
        ? runtime.answer?.trim() ||
          (runtime.reasonCodes.includes("runtime_model_empty_answer")
            ? "Model returned an empty answer."
            : undefined)
        : undefined,
    suspension:
      status === "suspended" && suspensionKind
        ? {
            kind: suspensionKind,
            rationale: suspensionRationaleFor(suspensionKind, runtime),
            clarificationPrompt:
              suspensionKind === "clarification_required"
                ? "Please clarify how to proceed."
                : undefined,
            ...(runtime.pendingApproval &&
            (suspensionKind === "approval_required" ||
              runtime.gateKind === "mutation_approval_required")
              ? {
                  approval: {
                    approvalId: runtime.pendingApproval.approvalId,
                    fingerprint: runtime.pendingApproval.fingerprint,
                    toolName: runtime.pendingApproval.toolName,
                    callId: runtime.pendingApproval.callId,
                    ...(runtime.pendingApproval.paths?.length
                      ? { paths: runtime.pendingApproval.paths }
                      : {}),
                    ...(runtime.pendingApproval.arguments !== undefined
                      ? { arguments: runtime.pendingApproval.arguments }
                      : {}),
                  },
                }
              : {}),
          }
        : undefined,
    reasonCodes: [reasonCodeFor(status, suspensionKind)],
    warnings: [...runtime.reasonCodes],
    usage: {
      modelCalls: runtime.usage?.modelCalls ?? 0,
      toolCalls: runtime.usage?.toolCalls ?? 0,
      loopIterations: runtime.usage?.loopIterations ?? 1,
      ...(typeof runtime.usage?.inputTokens === "number"
        ? { inputTokens: runtime.usage.inputTokens }
        : {}),
      ...(typeof runtime.usage?.outputTokens === "number"
        ? { outputTokens: runtime.usage.outputTokens }
        : {}),
      ...(typeof runtime.usage?.cacheHitTokens === "number"
        ? { cacheHitTokens: runtime.usage.cacheHitTokens }
        : {}),
      ...(typeof runtime.usage?.cacheMissTokens === "number"
        ? { cacheMissTokens: runtime.usage.cacheMissTokens }
        : {}),
    },
    durationMs: 0,
  };

  const events = buildRuntimeBridgeEvents({
    runtime,
    result,
    at,
    skipPhases: options?.skipPhases,
  });

  return {
    runId: runtime.runId,
    events: (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
    result: Promise.resolve(result),
    cancel() {
      /* shell already finished */
    },
  };
}

function mapStatus(
  status: RuntimeRunResult["status"],
): AgentRunResult["status"] {
  switch (status) {
    case "suspended":
      return "suspended";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "completed";
  }
}

function mapRoute(route: string | undefined): AgentRunResult["route"] {
  if (
    route === "clarify" ||
    route === "diagnose" ||
    route === "plan" ||
    route === "execute" ||
    route === "direct_answer" ||
    route === "repository_answer"
  ) {
    return route;
  }
  if (route === "answer") return "repository_answer";
  return undefined;
}

function mapPlanningDepth(
  depth: string | undefined,
): AgentRunResult["planningDepth"] {
  if (depth === "none" || depth === "internal" || depth === "visible") {
    return depth;
  }
  return undefined;
}

/** Runtime gate kinds → AgentRunResult suspension kinds. */
export function mapRuntimeGateToSuspensionKind(
  gateKind: string | undefined,
): NonNullable<AgentRunResult["suspension"]>["kind"] {
  return mapSuspensionKind(gateKind);
}

function mapSuspensionKind(
  gateKind: string | undefined,
): NonNullable<AgentRunResult["suspension"]>["kind"] {
  if (gateKind === "mutation_approval_required") {
    return "approval_required";
  }
  if (
    gateKind === "plan_approval_required" ||
    gateKind === "approval_required" ||
    gateKind === "grant_expansion_required" ||
    gateKind === "continue_required" ||
    gateKind === "clarification_required"
  ) {
    return gateKind;
  }
  return "clarification_required";
}

function suspensionRationaleFor(
  kind: NonNullable<AgentRunResult["suspension"]>["kind"],
  runtime: RuntimeRunResult,
): string {
  if (kind === "approval_required" && runtime.pendingApproval) {
    const pending = runtime.pendingApproval;
    const detail =
      pending.summary ??
      (pending.paths?.length ? pending.paths.join(", ") : undefined) ??
      pending.toolName;
    return `Approval required to run ${pending.toolName}${detail && detail !== pending.toolName ? ` (${detail})` : ""}.`;
  }
  switch (kind) {
    case "approval_required":
      return "Runtime shell suspended for mutation approval.";
    case "plan_approval_required":
      return "Runtime shell suspended for plan approval.";
    case "grant_expansion_required":
      return "Runtime shell suspended for grant expansion.";
    case "continue_required":
      return "Runtime shell suspended for continue decision.";
    default:
      return "Runtime shell suspended for host decision.";
  }
}

function reasonCodeFor(
  status: AgentRunResult["status"],
  kind: NonNullable<AgentRunResult["suspension"]>["kind"] | undefined,
): AgentRunResult["reasonCodes"][number] {
  if (status === "cancelled") return "cancelled";
  if (status !== "suspended") return "answer_produced";
  switch (kind) {
    case "approval_required":
      return "approval_suspended";
    case "plan_approval_required":
      return "plan_approval_suspended";
    case "clarification_required":
      return "clarification_suspended";
    case "grant_expansion_required":
      return "grant_expansion_suspended";
    default:
      return "run_started";
  }
}
