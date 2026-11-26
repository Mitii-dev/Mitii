/**
 * Shim — injects compactModelLoopMessages into runtime force-compact.
 */
import type { ModelMessage } from "../../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../../modules/prompt-construction";
import type { WindowPolicy } from "../../../../modules/window-budget";

import { compactModelLoopMessages } from "../../actions/compactModelLoopMessages";
import {
  forceCompactConversation as forceCompactConversationRuntime,
  type ForceCompactConversationResult,
} from "../../../../runtime/helpers/session-control";

export type { ForceCompactConversationResult };

export function forceCompactConversation(params: {
  messages: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  windowPolicy?: WindowPolicy;
  minMessagesToKeep?: number;
}): ForceCompactConversationResult {
  return forceCompactConversationRuntime({
    ...params,
    compactMessages: compactModelLoopMessages,
  });
}
