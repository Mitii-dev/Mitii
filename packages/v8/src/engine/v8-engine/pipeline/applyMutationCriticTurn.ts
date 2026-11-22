import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";

import type { AgentReasonCode } from "../contracts";
import { EventBus } from "../internal/EventBus";
import type { SteeringCriticMode } from "../legacy/steeringFlags";
import {
  runV8MutationCritic,
  type V8MutationCriticDecision,
} from "../modules/mutation-critic";
import type { AgentEngineRuntime } from "./runtime";

export type ApplyMutationCriticTurnResult =
  | {
      kind: "continue";
      decision: ExecutionDecision;
      critic: V8MutationCriticDecision;
    }
  | {
      kind: "proceed";
      decision: ExecutionDecision;
      critic: V8MutationCriticDecision;
    };

/**
 * Run the mutation critic against proposed tool calls. Revise/stop append
 * messages and signal `continue`; pass proceeds to settle.
 */
export function applyMutationCriticTurn(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  decision: ExecutionDecision;
  toolCalls: readonly ModelToolCall[];
  turnContent: string;
  messages: ModelMessage[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  criticMode: SteeringCriticMode;
  understanding: RequestUnderstandingResult | undefined;
}): ApplyMutationCriticTurnResult {
  const {
    runtime,
    bus,
    runId,
    toolCalls,
    turnContent,
    messages,
    reasonCodes,
    warnings,
    criticMode,
    understanding,
  } = params;
  let decision = params.decision;

  const critic = runV8MutationCritic({
    decision,
    toolCalls,
    turnContent,
    mode: criticMode,
    understanding,
  });

  if (critic.result.shadowWouldBlock) {
    reasonCodes.push("mutation_critic_shadow_block");
    warnings.push(
      `Mutation critic (shadow) would block: ${critic.result.reasons.join(" ")}`,
    );
    runtime.emit(bus, {
      type: "warning",
      runId,
      message: `Mutation critic shadow: ${critic.result.reasons[0] ?? "would block"}`,
      at: runtime.isoNow(),
    });
  }

  if (critic.kind === "revise") {
    reasonCodes.push("mutation_critic_revise");
    if (
      critic.result.narrowToPaths &&
      critic.result.narrowToPaths.length > 0 &&
      runtime.deps.decision.narrow
    ) {
      decision = runtime.deps.decision.narrow({
        previous: decision,
        discoveredPaths: critic.result.narrowToPaths,
      });
      reasonCodes.push("grant_narrowed");
    }
    warnings.push(`Mutation critic revise: ${critic.result.reasons.join(" ")}`);
    messages.push({
      role: "assistant",
      content: turnContent,
      toolCalls: [...toolCalls],
    });
    messages.push({ role: "user", content: critic.message });
    return { kind: "continue", decision, critic };
  }

  if (critic.kind === "stop") {
    reasonCodes.push("mutation_critic_stop");
    warnings.push(`Mutation critic stop: ${critic.result.reasons.join(" ")}`);
    messages.push({
      role: "assistant",
      content: turnContent,
      toolCalls: [...toolCalls],
    });
    messages.push({ role: "user", content: critic.message });
    return { kind: "continue", decision, critic };
  }

  if (
    critic.kind === "pass" &&
    !critic.result.shadowWouldBlock &&
    criticMode !== "off"
  ) {
    reasonCodes.push("mutation_critic_pass");
  }

  return { kind: "proceed", decision, critic };
}
