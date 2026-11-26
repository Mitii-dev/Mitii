import type { ModelMessage } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";

import {
  buildCompactedToolArguments,
  buildDroppedTurnsSummary,
  collectToolCallsById,
  compactToolMessageContent,
  countNonSystemMessages,
  dropOldestNonSystemTurnWithRemoved,
  takeLastIndices,
} from "./CompactToolHistory";
import {
  ESTABLISHED_FACTS_MARKER,
  MEMORY_REINJECT_MARKER,
  insertAfterSystemMessages,
  reinjectPinnedFacts,
} from "./CompactPinnedFacts";
import { estimateModelMessagesTokens } from "./CompactionTokenEstimate";
import {
  DEFAULT_AUTO_RATIO,
  DEFAULT_HARD_RATIO,
  DEFAULT_WARN_RATIO,
  resolveCompactionPressure,
  resolveCompactionThresholds,
} from "./CompactionThresholds";
import type { CompactionLadderStage, ModelLoopCompactionResult } from "./CompactionResult";
import * as Defaults from "./CompactionDefaults";
import { compactAllToolPayloads, cloneMessage, scaledChars } from "./CompactAllToolPayloads";

export function compactModelLoopMessages(params: {
  messages: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  budgetTokens: number;
  recentToolMessagesToKeepFull?: number;
  compactedToolResultChars?: number;
  compactedToolArgumentChars?: number;
  droppedTurnSummaryChars?: number;
  minMessagesToKeep?: number;
  warnRatio?: number;
  autoRatio?: number;
  hardRatio?: number;
  autoMaxTokens?: number;
  hardMaxTokens?: number;
  preservePrefix?: boolean;
  memoryFacts?: readonly { id: string; content: string }[];
  maxMemoryReinjectChars?: number;
  establishedFacts?: readonly { id: string; content: string }[];
  maxEstablishedFactReinjectChars?: number;
  /** When true, established facts are pinned only in the trailing working set. */
  skipEstablishedFactsReinject?: boolean;
}): ModelLoopCompactionResult {
  const recentToolMessagesToKeepFull =
    params.recentToolMessagesToKeepFull ?? Defaults.DEFAULT_RECENT_TOOL_MESSAGES_TO_KEEP_FULL;
  const compactedToolResultChars = params.compactedToolResultChars ?? scaledChars(params.budgetTokens, Defaults.DEFAULT_COMPACTED_TOOL_RESULT_CHARS_RATIO);
  const compactedToolArgumentChars = params.compactedToolArgumentChars ?? scaledChars(params.budgetTokens, Defaults.DEFAULT_COMPACTED_TOOL_ARGUMENT_CHARS_RATIO);
  const droppedTurnSummaryChars = params.droppedTurnSummaryChars ?? scaledChars(params.budgetTokens, Defaults.DEFAULT_DROPPED_TURN_SUMMARY_CHARS_RATIO);
  const maxEstablishedFactReinjectChars = params.maxEstablishedFactReinjectChars ?? scaledChars(params.budgetTokens, Defaults.DEFAULT_ESTABLISHED_FACT_REINJECT_CHARS_RATIO);
  const maxMemoryReinjectChars = params.maxMemoryReinjectChars ?? scaledChars(params.budgetTokens, Defaults.DEFAULT_MEMORY_REINJECT_CHARS_RATIO);
  const minMessagesToKeep = params.minMessagesToKeep ?? Defaults.DEFAULT_MIN_MESSAGES_TO_KEEP;
  const thresholds = resolveCompactionThresholds({
    budgetTokens: params.budgetTokens,
    warnRatio: params.warnRatio ?? DEFAULT_WARN_RATIO,
    autoRatio: params.autoRatio ?? DEFAULT_AUTO_RATIO,
    hardRatio: params.hardRatio ?? DEFAULT_HARD_RATIO,
    autoMaxTokens: params.autoMaxTokens,
    hardMaxTokens: params.hardMaxTokens,
    preservePrefix: params.preservePrefix,
  });

  let working = params.messages.map(cloneMessage);
  let compacted = false;
  let truncatedTokens = 0;
  let summarizedDroppedTurns = false;
  let reinjectedMemory = false;
  let reinjectedEstablishedFacts = false;
  const stagesApplied: CompactionLadderStage[] = [];
  const droppedForSummary: ModelMessage[] = [];

  const estimateAll = (messages: readonly ModelMessage[]): number =>
    estimateModelMessagesTokens(messages, params.estimator);

  let usedTokens = estimateAll(working);
  const initialPressure = resolveCompactionPressure({
    usedTokens,
    thresholds,
  });
  if (usedTokens < thresholds.autoTokens) {
    return {
      messages: working,
      usedTokens,
      omittedTokens: 0,
      truncatedTokens: 0,
      compacted: false,
      pressure: initialPressure,
      thresholds,
      summarizedDroppedTurns: false,
      reinjectedMemory: false,
      reinjectedEstablishedFacts: false,
      stagesApplied,
      droppedMessages: [],
    };
  }

  const toolCallMessageIndices = working
    .map((message, index) =>
      message.toolCalls && message.toolCalls.length > 0 ? index : -1,
    )
    .filter((index) => index >= 0);
  const fullToolCallIndices = new Set(
    takeLastIndices(toolCallMessageIndices, recentToolMessagesToKeepFull),
  );

  working = working.map((message, index) => {
    if (!message.toolCalls || fullToolCallIndices.has(index)) {
      return message;
    }

    let messageChanged = false;
    const toolCalls = message.toolCalls.map((toolCall) => {
      if (toolCall.arguments.length <= compactedToolArgumentChars) {
        return toolCall;
      }
      messageChanged = true;
      const compactedArguments = buildCompactedToolArguments(toolCall);
      truncatedTokens += Math.max(
        0,
        params.estimator.estimate(toolCall.arguments) -
          params.estimator.estimate(compactedArguments),
      );
      return {
        ...toolCall,
        arguments: compactedArguments,
      };
    });

    if (!messageChanged) {
      return message;
    }
    compacted = true;
    return { ...message, toolCalls };
  });

  if (compacted) {
    stagesApplied.push("soft_tool_stubs");
  }

  const toolMessageIndices = working
    .map((message, index) => (message.role === "tool" ? index : -1))
    .filter((index) => index >= 0);
  const fullToolMessageIndices = new Set(
    takeLastIndices(toolMessageIndices, recentToolMessagesToKeepFull),
  );
  const toolCallsById = collectToolCallsById(working);

  let softResultCompacted = false;
  working = working.map((message, index) => {
    if (
      message.role !== "tool" ||
      fullToolMessageIndices.has(index) ||
      message.content.length <= compactedToolResultChars
    ) {
      return message;
    }

    const nextContent = compactToolMessageContent({
      message,
      toolCall: message.toolCallId
        ? toolCallsById.get(message.toolCallId)
        : undefined,
      maxChars: compactedToolResultChars,
    });
    truncatedTokens += Math.max(
      0,
      params.estimator.estimate(message.content) -
        params.estimator.estimate(nextContent),
    );
    compacted = true;
    softResultCompacted = true;
    return { ...message, content: nextContent };
  });
  if (softResultCompacted && !stagesApplied.includes("soft_tool_stubs")) {
    stagesApplied.push("soft_tool_stubs");
  }

  usedTokens = estimateAll(working);
  const omittedBeforeDrop = usedTokens;
  while (
    usedTokens > thresholds.autoTokens &&
    countNonSystemMessages(working) > minMessagesToKeep
  ) {
    const dropResult = dropOldestNonSystemTurnWithRemoved(working);
    if (dropResult.messages.length === working.length) {
      break;
    }
    droppedForSummary.push(...dropResult.removed);
    working = dropResult.messages;
    compacted = true;
    usedTokens = estimateAll(working);
  }
  if (droppedForSummary.length > 0) {
    stagesApplied.push("drop_oldest_turns");
  }

  if (droppedForSummary.length > 0) {
    const summary = buildDroppedTurnsSummary(
      droppedForSummary,
      droppedTurnSummaryChars,
    );
    if (summary) {
      working = insertAfterSystemMessages(working, {
        role: "user",
        content: summary,
      });
      summarizedDroppedTurns = true;
      stagesApplied.push("dropped_turn_summary");
      usedTokens = estimateAll(working);
    }
  }

  if (usedTokens > thresholds.hardTokens) {
    const fullyCompacted = compactAllToolPayloads({
      messages: working,
      estimator: params.estimator,
      compactedToolResultChars,
    });
    working = fullyCompacted.messages;
    truncatedTokens += fullyCompacted.truncatedTokens;
    compacted = compacted || fullyCompacted.compacted;
    if (fullyCompacted.compacted) {
      stagesApplied.push("hard_tool_compact");
    }
    usedTokens = estimateAll(working);
  }

  if (initialPressure === "auto" || initialPressure === "hard") {
    if (
      !params.skipEstablishedFactsReinject &&
      params.establishedFacts &&
      params.establishedFacts.length > 0
    ) {
      const reinjected = reinjectPinnedFacts({
        messages: working,
        facts: params.establishedFacts,
        marker: ESTABLISHED_FACTS_MARKER,
        maxChars: maxEstablishedFactReinjectChars,
        estimator: params.estimator,
        budgetTokens: params.budgetTokens,
      });
      working = reinjected.messages;
      reinjectedEstablishedFacts = reinjected.reinjected;
      if (reinjected.reinjected) {
        stagesApplied.push("reinject_established_facts");
      }
      usedTokens = estimateAll(working);
    }
    if (params.memoryFacts && params.memoryFacts.length > 0) {
      const reinjected = reinjectPinnedFacts({
        messages: working,
        facts: params.memoryFacts,
        marker: MEMORY_REINJECT_MARKER,
        maxChars: maxMemoryReinjectChars,
        estimator: params.estimator,
        budgetTokens: params.budgetTokens,
      });
      working = reinjected.messages;
      reinjectedMemory = reinjected.reinjected;
      if (reinjected.reinjected) {
        stagesApplied.push("reinject_memory");
      }
      usedTokens = estimateAll(working);
    }
  }

  return {
    messages: working,
    usedTokens,
    omittedTokens: Math.max(0, omittedBeforeDrop - usedTokens),
    truncatedTokens,
    compacted,
    pressure: initialPressure,
    thresholds,
    summarizedDroppedTurns,
    reinjectedMemory,
    reinjectedEstablishedFacts,
    stagesApplied,
    droppedMessages: droppedForSummary.map(cloneMessage),
  };
}

