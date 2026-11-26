/**
 * Pre-settle ToolLoopGuard observe on tool batches (reject / force_final / soft).
 */
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import { EventBus } from "../internal/EventBus";
import {
  forceFinalToolLoopMessage,
  type ToolLoopGuard,
} from "../modules/tool-loop-guard";
import type { OfferContinueFn } from "./createOfferContinue";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";
import type {
  PreSettleRailsResult,
  PreSettleRailsState,
} from "./handlePreSettleTurnRailsTypes";

export function applyPreSettleToolLoopGuard(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  turnContent: string;
  toolCalls: readonly ModelToolCall[];
  messages: ModelMessage[];
  toolLoopGuard: ToolLoopGuard;
  answer: string;
  warnings: string[];
  offerContinue: OfferContinueFn;
  state: PreSettleRailsState;
  cont: () => PreSettleRailsResult;
  done: (outcome: ToolLoopOutcome) => PreSettleRailsResult;
}): PreSettleRailsResult | undefined {
  const {
    runtime,
    bus,
    runId,
    turnContent,
    toolCalls,
    messages,
    toolLoopGuard,
    answer,
    warnings,
    offerContinue,
    state,
    cont,
    done,
  } = params;

  if (toolCalls.length === 0) {
    return undefined;
  }

  const callDecision = toolLoopGuard.observeCalls(
    toolCalls.map((call) => ({
      name: call.name,
      arguments: call.arguments,
    })),
  );

  if (callDecision.type === "reject") {
    warnings.push(
      `Identical tool batch rejected (${callDecision.violationCount} after force-final).`,
    );
    messages.push({
      role: "assistant",
      content: turnContent,
      toolCalls: [...toolCalls],
    });
    messages.push({
      role: "user",
      content: forceFinalToolLoopMessage(callDecision.violationCount),
    });
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
    ]);
    if (callDecision.exhausted) {
      return done(offerContinue("exploration_stall", turnContent || answer));
    }
    state.forceFinalOnly = true;
    return cont();
  }

  if (callDecision.type === "force_final") {
    warnings.push(
      `Tool loop force-final after ${callDecision.repeatCount} identical batches.`,
    );
    state.forceFinalOnly = true;
    messages.push({
      role: "assistant",
      content: turnContent,
      toolCalls: [...toolCalls],
    });
    messages.push({
      role: "user",
      content: forceFinalToolLoopMessage(callDecision.repeatCount),
    });
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
    ]);
    return cont();
  }

  if (callDecision.type === "soft") {
    state.softNudgeAfterSettle = true;
    warnings.push(
      `Soft tool-loop nudge after ${callDecision.repeatCount} identical batches.`,
    );
  }
  return undefined;
}
