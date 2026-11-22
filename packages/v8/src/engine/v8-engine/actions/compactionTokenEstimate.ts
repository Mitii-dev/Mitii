import type { ModelMessage } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";

export function estimateModelMessagesTokens(
  messages: readonly ModelMessage[],
  estimator: TokenEstimatorPort,
): number {
  return messages.reduce(
    (sum, message) => sum + estimateModelMessageTokens(message, estimator),
    0,
  );
}

export function estimateModelMessageTokens(
  message: ModelMessage,
  estimator: TokenEstimatorPort,
): number {
  let tokens = estimator.estimate(message.content);
  if (message.name) {
    tokens += estimator.estimate(message.name);
  }
  if (message.toolCallId) {
    tokens += estimator.estimate(message.toolCallId);
  }
  for (const toolCall of message.toolCalls ?? []) {
    tokens += estimator.estimate(toolCall.id);
    tokens += estimator.estimate(toolCall.name);
    tokens += estimator.estimate(toolCall.arguments);
    tokens += 8;
  }
  for (const attachment of message.attachments ?? []) {
    tokens += estimator.estimate(attachment.mimeType);
    tokens += estimator.estimate(attachment.name ?? "");
    tokens += estimator.estimate(attachment.data);
  }
  return tokens + 4;
}
