import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";

const DEFAULT_RECENT_TOOL_MESSAGES_TO_KEEP_FULL = 3;
const DEFAULT_COMPACTED_TOOL_RESULT_CHARS = 400;
const DEFAULT_COMPACTED_TOOL_ARGUMENT_CHARS = 256;
const DEFAULT_MIN_MESSAGES_TO_KEEP = 6;
const DEFAULT_WARN_RATIO = 0.7;
const DEFAULT_AUTO_RATIO = 0.8;
const DEFAULT_HARD_RATIO = 0.92;
const TRUNCATED_FOR_LOOP_MARKER = "\n...[truncated from prior tool history]";

export type ModelLoopCompactionPressure = "within" | "warn" | "auto" | "hard";

export interface ModelLoopCompactionThresholds {
  warnTokens: number;
  autoTokens: number;
  hardTokens: number;
}

export interface ModelLoopCompactionResult {
  messages: ModelMessage[];
  usedTokens: number;
  omittedTokens: number;
  truncatedTokens: number;
  compacted: boolean;
  pressure: ModelLoopCompactionPressure;
  thresholds: ModelLoopCompactionThresholds;
  summarizedDroppedTurns: boolean;
  reinjectedMemory: boolean;
}

export function compactModelLoopMessages(params: {
  messages: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  budgetTokens: number;
  recentToolMessagesToKeepFull?: number;
  compactedToolResultChars?: number;
  compactedToolArgumentChars?: number;
  minMessagesToKeep?: number;
  warnRatio?: number;
  autoRatio?: number;
  hardRatio?: number;
  /** Budgeted memory facts to reinject after hard compaction. */
  memoryFacts?: readonly { id: string; content: string }[];
  maxMemoryReinjectChars?: number;
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
  const thresholds = resolveCompactionThresholds({
    budgetTokens: params.budgetTokens,
    warnRatio: params.warnRatio ?? DEFAULT_WARN_RATIO,
    autoRatio: params.autoRatio ?? DEFAULT_AUTO_RATIO,
    hardRatio: params.hardRatio ?? DEFAULT_HARD_RATIO,
  });

  let working = params.messages.map(cloneMessage);
  let compacted = false;
  let truncatedTokens = 0;
  let summarizedDroppedTurns = false;
  let reinjectedMemory = false;
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

  const toolMessageIndices = working
    .map((message, index) => (message.role === "tool" ? index : -1))
    .filter((index) => index >= 0);
  const fullToolMessageIndices = new Set(
    takeLastIndices(toolMessageIndices, recentToolMessagesToKeepFull),
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
    const summary = buildDroppedTurnsSummary(droppedForSummary);
    if (summary) {
      working = insertAfterSystemMessages(working, {
        role: "user",
        content: summary,
      });
      summarizedDroppedTurns = true;
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
    usedTokens = estimateAll(working);
  }

  if (
    initialPressure === "hard" &&
    params.memoryFacts &&
    params.memoryFacts.length > 0
  ) {
    const reinjected = reinjectMemoryFacts({
      messages: working,
      memoryFacts: params.memoryFacts,
      maxChars: params.maxMemoryReinjectChars ?? 800,
      estimator: params.estimator,
      budgetTokens: params.budgetTokens,
    });
    working = reinjected.messages;
    reinjectedMemory = reinjected.reinjected;
    usedTokens = estimateAll(working);
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
  };
}

export function resolveCompactionThresholds(params: {
  budgetTokens: number;
  warnRatio?: number;
  autoRatio?: number;
  hardRatio?: number;
}): ModelLoopCompactionThresholds {
  const budgetTokens = Math.max(1, Math.floor(params.budgetTokens));
  const warnRatio = clampRatio(params.warnRatio ?? DEFAULT_WARN_RATIO);
  const autoRatio = clampRatio(params.autoRatio ?? DEFAULT_AUTO_RATIO);
  const hardRatio = clampRatio(params.hardRatio ?? DEFAULT_HARD_RATIO);
  const sorted = [warnRatio, autoRatio, hardRatio].sort((a, b) => a - b);

  return {
    warnTokens: Math.max(1, Math.floor(budgetTokens * sorted[0]!)),
    autoTokens: Math.max(1, Math.floor(budgetTokens * sorted[1]!)),
    hardTokens: Math.max(1, Math.floor(budgetTokens * sorted[2]!)),
  };
}

export function resolveCompactionPressure(params: {
  usedTokens: number;
  thresholds: ModelLoopCompactionThresholds;
}): ModelLoopCompactionPressure {
  if (params.usedTokens >= params.thresholds.hardTokens) {
    return "hard";
  }
  if (params.usedTokens >= params.thresholds.autoTokens) {
    return "auto";
  }
  if (params.usedTokens >= params.thresholds.warnTokens) {
    return "warn";
  }
  return "within";
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

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AUTO_RATIO;
  }
  return Math.min(1, Math.max(0.01, value));
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

function takeLastIndices(indices: readonly number[], count: number): number[] {
  if (count <= 0) {
    return [];
  }
  return indices.slice(-count);
}

function dropOldestNonSystemTurnWithRemoved(
  messages: readonly ModelMessage[],
): { messages: ModelMessage[]; removed: ModelMessage[] } {
  const index = messages.findIndex((message) => message.role !== "system");
  if (index < 0) {
    return { messages: [...messages], removed: [] };
  }

  const removed: ModelMessage[] = [];
  const head = messages[index]!;
  removed.push(head);
  const removedToolCallIds = new Set(
    (head.toolCalls ?? []).map((toolCall) => toolCall.id),
  );

  const next = [...messages.slice(0, index), ...messages.slice(index + 1)];
  while (
    removedToolCallIds.size > 0 &&
    next[index]?.role === "tool" &&
    next[index]?.toolCallId &&
    removedToolCallIds.has(next[index]!.toolCallId)
  ) {
    removed.push(next[index]!);
    next.splice(index, 1);
  }

  while (true) {
    const firstNonSystem = next.findIndex(
      (message) => message.role !== "system",
    );
    if (firstNonSystem < 0 || next[firstNonSystem]?.role !== "tool") {
      break;
    }
    removed.push(next[firstNonSystem]!);
    next.splice(firstNonSystem, 1);
  }

  return { messages: next, removed };
}

function buildDroppedTurnsSummary(
  dropped: readonly ModelMessage[],
): string | undefined {
  if (dropped.length === 0) {
    return undefined;
  }
  const lines: string[] = [
    "[compacted prior context — older turns summarized locally]",
  ];
  let chars = lines[0]!.length;
  const maxChars = 1_200;
  for (const message of dropped) {
    if (message.role === "tool") {
      continue;
    }
    const preview = message.content.replace(/\s+/g, " ").trim().slice(0, 220);
    if (!preview) {
      continue;
    }
    const line = `- ${message.role}: ${preview}`;
    if (chars + line.length + 1 > maxChars) {
      lines.push("- …");
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }
  return lines.length > 1 ? lines.join("\n") : undefined;
}

function insertAfterSystemMessages(
  messages: readonly ModelMessage[],
  insert: ModelMessage,
): ModelMessage[] {
  let insertAt = 0;
  while (insertAt < messages.length && messages[insertAt]?.role === "system") {
    insertAt += 1;
  }
  return [
    ...messages.slice(0, insertAt),
    insert,
    ...messages.slice(insertAt),
  ];
}

function reinjectMemoryFacts(params: {
  messages: ModelMessage[];
  memoryFacts: readonly { id: string; content: string }[];
  maxChars: number;
  estimator: TokenEstimatorPort;
  budgetTokens: number;
}): { messages: ModelMessage[]; reinjected: boolean } {
  const marker = "[memory reinjected after hard compaction]";
  if (params.messages.some((message) => message.content.includes(marker))) {
    return { messages: params.messages, reinjected: false };
  }

  const lines: string[] = [marker];
  let chars = marker.length;
  for (const fact of params.memoryFacts) {
    const line = `- (${fact.id}) ${fact.content.replace(/\s+/g, " ").trim()}`;
    if (chars + line.length + 1 > params.maxChars) {
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }
  if (lines.length <= 1) {
    return { messages: params.messages, reinjected: false };
  }

  const next = insertAfterSystemMessages(params.messages, {
    role: "user",
    content: lines.join("\n"),
  });
  const used = estimateModelMessagesTokens(next, params.estimator);
  if (used > params.budgetTokens) {
    return { messages: params.messages, reinjected: false };
  }
  return { messages: next, reinjected: true };
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
