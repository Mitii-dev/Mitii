import type { ModelMessage } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";
import type { WindowPolicyCompaction } from "../../../modules/window-budget";

import { compactModelLoopMessages } from "./CompactModelLoopMessages";
import type { ModelLoopCompactionResult } from "./CompactionResult";

export function compactModelLoopMessagesFromWindowPolicy(params: {
  messages: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  budgetTokens: number;
  compaction: WindowPolicyCompaction;
  preservePrefix?: boolean;
  memoryFacts?: readonly { id: string; content: string }[];
  establishedFacts?: readonly { id: string; content: string }[];
  skipEstablishedFactsReinject?: boolean;
}): ModelLoopCompactionResult {
  const { compaction } = params;
  return compactModelLoopMessages({
    messages: params.messages,
    estimator: params.estimator,
    budgetTokens: params.budgetTokens,
    memoryFacts: params.memoryFacts,
    establishedFacts: params.establishedFacts,
    maxEstablishedFactReinjectChars: compaction.establishedFactReinjectChars,
    maxMemoryReinjectChars: compaction.memoryReinjectChars,
    recentToolMessagesToKeepFull: compaction.keepRecentToolResults,
    compactedToolResultChars: compaction.compactedToolResultChars,
    compactedToolArgumentChars: compaction.compactedToolArgumentChars,
    droppedTurnSummaryChars: compaction.droppedTurnSummaryChars,
    warnRatio: compaction.warnRatio,
    autoRatio: compaction.autoRatio,
    hardRatio: compaction.hardRatio,
    autoMaxTokens: compaction.autoMaxTokens,
    hardMaxTokens: compaction.hardMaxTokens,
    preservePrefix: params.preservePrefix,
    skipEstablishedFactsReinject: params.skipEstablishedFactsReinject,
  });
}
