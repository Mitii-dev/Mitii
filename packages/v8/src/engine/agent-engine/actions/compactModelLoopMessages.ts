import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";

const DEFAULT_RECENT_TOOL_MESSAGES_TO_KEEP_FULL = 3;
const DEFAULT_COMPACTED_TOOL_RESULT_CHARS = 400;
const DEFAULT_COMPACTED_TOOL_ARGUMENT_CHARS = 256;
const DEFAULT_MIN_MESSAGES_TO_KEEP = 6;
const TRUNCATED_FOR_LOOP_MARKER = "\n...[truncated from prior tool history]";

export interface ModelLoopCompactionResult {
  messages: ModelMessage[];
  usedTokens: number;
  omittedTokens: number;
  truncatedTokens: number;
  compacted: boolean;
}

export function compactModelLoopMessages(params: {
  messages: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  budgetTokens: number;
  recentToolMessagesToKeepFull?: number;
  compactedToolResultChars?: number;
  compactedToolArgumentChars?: number;
  minMessagesToKeep?: number;
}): ModelLoopCompactionResult {
  const recentToolMessagesToKeepFull =
    params.recentToolMessagesToKeepFull ??
    DEFAULT_RECENT_TOOL_MESSAGES_TO_KEEP_FULL;
  const compactedToolResultChars =
    params.compactedToolResultChars ?? DEFAULT_COMPACTED_TOOL_RESULT_CHARS;
  const compactedToolArgumentChars =
    params.compactedToolArgumentChars ?? DEFAULT_COMPACTED_TOOL_ARGUMENT_CHARS;
  const minMessagesToKeep =
    params.minMessagesToKeep ?? DEFAULT_MIN_MESSAGES_TO_KEEP;

  let working = params.messages.map(cloneMessage);
  let compacted = false;
  let truncatedTokens = 0;

  const estimateAll = (messages: readonly ModelMessage[]): number =>
    estimateModelMessagesTokens(messages, params.estimator);

  let usedTokens = estimateAll(working);
  if (usedTokens <= params.budgetTokens) {
    return {
      messages: working,
      usedTokens,
      omittedTokens: 0,
      truncatedTokens: 0,
      compacted: false,
    };
  }

  const toolCallMessageIndices = working
    .map((message, index) =>
      message.toolCalls && message.toolCalls.length > 0 ? index : -1,
    )
    .filter((index) => index >= 0);
  const fullToolCallIndices = new Set(
    toolCallMessageIndices.slice(-recentToolMessagesToKeepFull),
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

  const toolMessageIndices = working
    .map((message, index) => (message.role === "tool" ? index : -1))
    .filter((index) => index >= 0);
  const fullToolMessageIndices = new Set(
    toolMessageIndices.slice(-recentToolMessagesToKeepFull),
  );

  working = working.map((message, index) => {
    if (
      message.role !== "tool" ||
      fullToolMessageIndices.has(index) ||
      message.content.length <= compactedToolResultChars
    ) {
      return message;
    }

    const nextContent =
      message.content.slice(0, compactedToolResultChars) +
      TRUNCATED_FOR_LOOP_MARKER;
    truncatedTokens += Math.max(
      0,
      params.estimator.estimate(message.content) -
        params.estimator.estimate(nextContent),
    );
    compacted = true;
    return { ...message, content: nextContent };
  });

  usedTokens = estimateAll(working);
  const omittedBeforeDrop = usedTokens;
  while (
    usedTokens > params.budgetTokens &&
    countNonSystemMessages(working) > minMessagesToKeep
  ) {
    const next = dropOldestNonSystemTurn(working);
    if (next.length === working.length) {
      break;
    }
    working = next;
    compacted = true;
    usedTokens = estimateAll(working);
  }

  if (usedTokens > params.budgetTokens) {
    const fullyCompacted = compactAllToolPayloads({
      messages: working,
      estimator: params.estimator,
      compactedToolResultChars,
    });
    working = fullyCompacted.messages;
    truncatedTokens += fullyCompacted.truncatedTokens;
    compacted = compacted || fullyCompacted.compacted;
    usedTokens = estimateAll(working);
  }

  return {
    messages: working,
    usedTokens,
    omittedTokens: Math.max(0, omittedBeforeDrop - usedTokens),
    truncatedTokens,
    compacted,
  };
}

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

function cloneMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
  };
}

function buildCompactedToolArguments(toolCall: ModelToolCall): string {
  return JSON.stringify({
    compacted: true,
    reason: "previous_completed_tool_call_arguments_omitted",
    originalArgumentCharacters: toolCall.arguments.length,
  });
}

function countNonSystemMessages(messages: readonly ModelMessage[]): number {
  return messages.filter((message) => message.role !== "system").length;
}

function dropOldestNonSystemTurn(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  const index = messages.findIndex((message) => message.role !== "system");
  if (index < 0) {
    return [...messages];
  }

  const removed = messages[index]!;
  const removedToolCallIds = new Set(
    (removed.toolCalls ?? []).map((toolCall) => toolCall.id),
  );

  const next = [...messages.slice(0, index), ...messages.slice(index + 1)];
  while (
    removedToolCallIds.size > 0 &&
    next[index]?.role === "tool" &&
    next[index]?.toolCallId &&
    removedToolCallIds.has(next[index]!.toolCallId)
  ) {
    next.splice(index, 1);
  }

  while (true) {
    const firstNonSystem = next.findIndex(
      (message) => message.role !== "system",
    );
    if (firstNonSystem < 0 || next[firstNonSystem]?.role !== "tool") {
      break;
    }
    next.splice(firstNonSystem, 1);
  }

  return next;
}

function compactAllToolPayloads(params: {
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
      const content =
        next.content.slice(0, params.compactedToolResultChars) +
        TRUNCATED_FOR_LOOP_MARKER;
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
