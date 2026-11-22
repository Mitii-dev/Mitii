import type { ModelMessage } from "../../../modules/model-gateway";
import type { AgentReasonCode } from "../contracts";
import {
  admitContextEpoch,
  appendMidConversationSystemMessage,
  baselinePrefixMatches,
  pinBaselineSystemMessage,
  stripMidConversationSystemMessages,
  type ContextEpoch,
} from "../internal/context-epoch";

export function applyContextEpochAdmission(params: {
  runId: string;
  messages: ModelMessage[];
  previous: ContextEpoch | undefined;
  compactionApplied: boolean;
  reasonCodes: AgentReasonCode[];
  nowMs: number;
  decisionRoute?: string;
  decisionPlanningDepth?: string;
  selectedSkillIds?: readonly string[];
  projectRuleIds?: readonly string[];
  environmentIds?: readonly string[];
  instructionBodies?: import("../internal/system-context").InstructionBodiesByKind;
  memoryIds?: readonly string[];
}): ContextEpoch | undefined {
  const admitted = admitContextEpoch({
    runId: params.runId,
    messages: params.messages,
    previous: params.previous,
    compactionApplied: params.compactionApplied,
    nowMs: params.nowMs,
    observed: {
      route: params.decisionRoute ?? "",
      planningDepth: params.decisionPlanningDepth ?? "",
      skillIds: params.selectedSkillIds ?? [],
      ruleIds: params.projectRuleIds ?? [],
      environmentIds: params.environmentIds ?? [],
      memoryIds: params.memoryIds ?? [],
      ...(params.instructionBodies
        ? { bodies: params.instructionBodies }
        : {}),
    },
  });

  if (!admitted) {
    return params.previous;
  }

  if (params.compactionApplied) {
    if (!params.reasonCodes.includes("context_epoch_replace_requested")) {
      params.reasonCodes.push("context_epoch_replace_requested");
    }
  }

  const isInit = !params.previous;
  if (admitted.stripPriorMidConversation) {
    const removed = stripMidConversationSystemMessages(params.messages);
    if (removed > 0) {
      params.reasonCodes.push("context_epoch_mid_updates_stripped");
    }
    params.reasonCodes.push("context_epoch_replaced");
  } else if (isInit) {
    params.reasonCodes.push("context_epoch_initialized");
  } else if (admitted.midConversationText) {
    params.reasonCodes.push("context_epoch_updated");
    params.reasonCodes.push("context_epoch_mid_update_admitted");
  } else if (admitted.epoch.replacementRequested) {
    params.reasonCodes.push("context_epoch_replace_blocked");
  } else if (!params.reasonCodes.includes("context_epoch_unchanged")) {
    params.reasonCodes.push("context_epoch_unchanged");
  }

  if (admitted.pinBaseline) {
    const pin = pinBaselineSystemMessage(params.messages, admitted.pinBaseline);
    if (pin.rewritten) {
      params.reasonCodes.push("context_epoch_baseline_rewritten");
    } else if (isInit || admitted.stripPriorMidConversation) {
      params.reasonCodes.push("context_epoch_baseline_pinned");
    }
  }

  if (admitted.midConversationText) {
    appendMidConversationSystemMessage(
      params.messages,
      admitted.midConversationText,
    );
  }

  if (
    admitted.epoch &&
    !baselinePrefixMatches(params.messages, admitted.epoch) &&
    !params.reasonCodes.includes("context_cache_prefix_mismatch")
  ) {
    params.reasonCodes.push("context_cache_prefix_mismatch");
  }

  return admitted.epoch;
}
