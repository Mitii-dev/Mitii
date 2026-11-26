import type { ModelMessage } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";
import type { WindowPolicy } from "../../../modules/window-budget";

import { SESSION_CONTROL_MIN_MESSAGES_TO_KEEP } from "./Constants";
import type { SessionControlCompactStats } from "./Types";

/** Minimal compact ladder surface — engine injects `compactModelLoopMessages`. */
export type CompactModelLoopMessagesPort = (params: {
  messages: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  budgetTokens: number;
  warnRatio?: number;
  autoRatio?: number;
  hardRatio?: number;
  hardMaxTokens?: number;
  minMessagesToKeep?: number;
  recentToolMessagesToKeepFull?: number;
  compactedToolResultChars?: number;
  compactedToolArgumentChars?: number;
  droppedTurnSummaryChars?: number;
  preservePrefix?: boolean;
}) => {
  messages: ModelMessage[];
  compacted: boolean;
  omittedTokens: number;
  pressure: string;
  stagesApplied: readonly string[];
};

export interface ForceCompactConversationResult {
  messages: ModelMessage[];
  compacted: boolean;
  stats: SessionControlCompactStats;
}

/**
 * Explicit `/compact`: force the compaction ladder even when under auto pressure.
 * Uses window-policy char budgets when available; otherwise scaled defaults.
 */
export function forceCompactConversation(params: {
  messages: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  windowPolicy?: WindowPolicy;
  minMessagesToKeep?: number;
  compactMessages: CompactModelLoopMessagesPort;
}): ForceCompactConversationResult {
  const beforeMessages = params.messages.length;
  if (beforeMessages === 0) {
    return {
      messages: [],
      compacted: false,
      stats: {
        beforeMessages: 0,
        afterMessages: 0,
        omittedTokens: 0,
        pressure: "within",
        stagesApplied: [],
      },
    };
  }

  const compaction = params.windowPolicy?.compaction;
  const budgetTokens = params.windowPolicy?.contextWindowTokens ?? 32_000;
  const minMessagesToKeep =
    params.minMessagesToKeep ??
    compaction?.keepRecentToolResults ??
    SESSION_CONTROL_MIN_MESSAGES_TO_KEEP;

  // Force ladder entry: autoTokens ≈ 0 so any non-empty history is compacted.
  const result = params.compactMessages({
    messages: params.messages,
    estimator: params.estimator,
    budgetTokens,
    warnRatio: 0,
    autoRatio: 0,
    hardRatio: compaction?.hardRatio ?? 0.5,
    hardMaxTokens: compaction?.hardMaxTokens,
    minMessagesToKeep,
    recentToolMessagesToKeepFull: compaction?.keepRecentToolResults ?? 3,
    compactedToolResultChars: compaction?.compactedToolResultChars,
    compactedToolArgumentChars: compaction?.compactedToolArgumentChars,
    droppedTurnSummaryChars: compaction?.droppedTurnSummaryChars,
    preservePrefix: false,
  });

  return {
    messages: result.messages,
    compacted: result.compacted || result.messages.length < beforeMessages,
    stats: {
      beforeMessages,
      afterMessages: result.messages.length,
      omittedTokens: result.omittedTokens,
      pressure: result.pressure,
      stagesApplied: result.stagesApplied,
    },
  };
}
