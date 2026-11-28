import type { ModelMessage } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";

import {
  buildCompactedToolArguments,
  collectToolCallsById,
  compactToolMessageContent,
} from "./CompactToolHistory";

export function cloneMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
  };
}
export function scaledChars(budgetTokens: number, ratio: number): number {
  return Math.max(1, Math.floor(Math.max(1, budgetTokens) * ratio));
}

export function compactAllToolPayloads(params: {
  messages: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  compactedToolResultChars: number;
}): {
  messages: ModelMessage[];
  truncatedTokens: number;
  compacted: boolean;
} {
  let compacted = false;
  let truncatedTokens = 0;
  const toolCallsById = collectToolCallsById(params.messages);
  const messages = params.messages.map((message) => {
    let next = message;

    if (message.toolCalls && message.toolCalls.length > 0) {
      const toolCalls = message.toolCalls.map((toolCall) => {
        const compactedArguments = buildCompactedToolArguments(toolCall);
        if (toolCall.arguments === compactedArguments) {
          return toolCall;
        }
        compacted = true;
        truncatedTokens += Math.max(
          0,
          params.estimator.estimate(toolCall.arguments) -
            params.estimator.estimate(compactedArguments),
        );
        return { ...toolCall, arguments: compactedArguments };
      });
      next = { ...next, toolCalls };
    }

    if (
      next.role === "tool" &&
      next.content.length > params.compactedToolResultChars
    ) {
      const content = compactToolMessageContent({
        message: next,
        toolCall: next.toolCallId
          ? toolCallsById.get(next.toolCallId)
          : undefined,
        maxChars: params.compactedToolResultChars,
      });
      compacted = true;
      truncatedTokens += Math.max(
        0,
        params.estimator.estimate(next.content) -
          params.estimator.estimate(content),
      );
      next = { ...next, content };
    }

    return next;
  });

  return { messages, truncatedTokens, compacted };
}

/**
 * Production entry: thresholds come only from WindowPolicy.compaction
 * (no parallel default-ratio path).
 */
