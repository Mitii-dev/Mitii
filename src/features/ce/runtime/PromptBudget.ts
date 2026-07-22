import type { ChatMessage, ChatRequest } from '../../../kernel/llm/types';
import { estimateChatRequestTokens } from './UsageTrackingProvider';
import { compactMessages } from './ContextCompaction';
import { estimateTokens } from '../../../kernel/llm/tokenEstimate';

/** Reserve headroom so the model can still produce a reply. */
export const OUTPUT_RESERVE_RATIO = 0.15;

export class PromptBudgetExceededError extends Error {
  constructor(
    readonly report: {
      maxInputTokens: number;
      beforeTokens: number;
      afterTokens: number;
    }
  ) {
    super(
      `Prompt exceeds input budget after compaction (${report.afterTokens}/${report.maxInputTokens} tokens)`
    );
    this.name = 'PromptBudgetExceededError';
  }
}

export function getMaxInputTokens(contextWindow: number): number {
  return Math.floor(contextWindow * (1 - OUTPUT_RESERVE_RATIO));
}

export interface FitChatRequestResult {
  request: ChatRequest;
  trimmed: boolean;
  beforeTokens: number;
  afterTokens: number;
}

/**
 * Hard-cap a chat request to the configured context window by progressively
 * trimming older tool output, compacting transcript, then shrinking codebase context.
 */
export function fitChatRequestToBudget(
  request: ChatRequest,
  maxInputTokens: number
): FitChatRequestResult {
  const beforeTokens = estimateChatRequestTokens(request);
  if (beforeTokens <= maxInputTokens) {
    return { request, trimmed: false, beforeTokens, afterTokens: beforeTokens };
  }

  let messages = [...request.messages];
  let trimmed = false;

  messages = truncateOlderToolOutputs(messages);
  trimmed = true;
  let afterTokens = estimateChatRequestTokens({ ...request, messages });
  if (afterTokens <= maxInputTokens) {
    return finalizeFit(request, messages, trimmed, beforeTokens, maxInputTokens);
  }

  messages = compactTranscriptAroundUser(messages, request.tools, maxInputTokens);
  afterTokens = estimateChatRequestTokens({ ...request, messages });
  if (afterTokens <= maxInputTokens) {
    return finalizeFit(request, messages, trimmed, beforeTokens, maxInputTokens);
  }

  messages = shrinkCodebaseContext(messages, request.tools, maxInputTokens);
  afterTokens = estimateChatRequestTokens({ ...request, messages });
  if (afterTokens <= maxInputTokens) {
    return finalizeFit(request, messages, trimmed, beforeTokens, maxInputTokens);
  }

  messages = hardTruncateTail(messages, request.tools, maxInputTokens);
  return finalizeFit(request, messages, true, beforeTokens, maxInputTokens);
}

function finalizeFit(
  request: ChatRequest,
  messages: ChatMessage[],
  trimmed: boolean,
  beforeTokens: number,
  maxInputTokens: number
): FitChatRequestResult {
  let fittedMessages = [...messages];
  let afterTokens = estimateChatRequestTokens({ ...request, messages: fittedMessages });

  while (afterTokens > maxInputTokens && fittedMessages.length > 1) {
    const emergencyIndex = fittedMessages.findIndex(
      (message, index) => message.role !== 'system' && index < fittedMessages.length - 1
    );
    if (emergencyIndex < 0) break;
    fittedMessages.splice(emergencyIndex, 1);
    afterTokens = estimateChatRequestTokens({ ...request, messages: fittedMessages });
    trimmed = true;
  }

  const lastUserIndex = findLastIndex(fittedMessages, (message) => message.role === 'user');
  if (lastUserIndex >= 0 && afterTokens > maxInputTokens) {
    const overhead = estimateChatRequestTokens({
      messages: fittedMessages.filter((_, index) => index !== lastUserIndex),
      tools: request.tools,
    });
    const userBudget = Math.max(64, maxInputTokens - overhead);
    fittedMessages[lastUserIndex] = {
      ...fittedMessages[lastUserIndex],
      content: truncateToTokenBudget(fittedMessages[lastUserIndex].content, userBudget),
    };
    afterTokens = estimateChatRequestTokens({ ...request, messages: fittedMessages });
    trimmed = true;
  }

  if (afterTokens > maxInputTokens) {
    throw new PromptBudgetExceededError({ maxInputTokens, beforeTokens, afterTokens });
  }
  return { request: { ...request, messages: fittedMessages }, trimmed, beforeTokens, afterTokens };
}

function truncateOlderToolOutputs(messages: ChatMessage[]): ChatMessage[] {
  const toolIndices = messages
    .map((message, index) => (message.role === 'tool' ? index : -1))
    .filter((index) => index >= 0);
  if (toolIndices.length <= 4) return messages;

  const keepFull = new Set(toolIndices.slice(-4));
  return messages.map((message, index) => {
    if (message.role !== 'tool' || keepFull.has(index)) return message;
    const content = message.content ?? '';
    if (content.length <= 600) return message;
    return {
      ...message,
      content: `${content.slice(0, 600)}\n…[truncated for context budget]`,
    };
  });
}

function compactTranscriptAroundUser(
  messages: ChatMessage[],
  tools: ChatRequest['tools'],
  maxInputTokens: number
): ChatMessage[] {
  const systemMessages = messages.filter((message) => message.role === 'system');
  const lastUserIndex = findLastIndex(messages, (message) => message.role === 'user');
  if (lastUserIndex < 0) return messages;

  const lastUser = messages[lastUserIndex];
  const middle = messages.filter((_, index) => index !== lastUserIndex && messages[index].role !== 'system');
  const anchorTokens = estimateChatRequestTokens({
    messages: [...systemMessages, lastUser],
    tools,
  });
  const middleBudget = maxInputTokens - anchorTokens;
  if (middleBudget < 120 || middle.length === 0) return messages;

  const compacted = compactMessages(middle, middleBudget);
  return [...systemMessages, ...compacted, lastUser];
}

function shrinkCodebaseContext(
  messages: ChatMessage[],
  tools: ChatRequest['tools'],
  maxInputTokens: number
): ChatMessage[] {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === 'user');
  if (lastUserIndex < 0) return messages;

  const lastUser = messages[lastUserIndex];
  const marker = '## Codebase Context';
  const markerIndex = lastUser.content.indexOf(marker);
  if (markerIndex < 0) return messages;

  const prefix = lastUser.content.slice(0, markerIndex + marker.length);
  const suffixStart = lastUser.content.indexOf('\n---\n\n## User request');
  const suffix = suffixStart >= 0 ? lastUser.content.slice(suffixStart) : '';
  const otherMessages = messages.filter((_, index) => index !== lastUserIndex);
  const overhead = estimateChatRequestTokens({ messages: otherMessages, tools });
  const contextBudget = Math.max(200, maxInputTokens - overhead - estimateTokensForText(suffix) - 32);
  const contextBody = lastUser.content.slice(markerIndex + marker.length, suffixStart >= 0 ? suffixStart : undefined);
  const shrunkBody = truncateToTokenBudget(contextBody, contextBudget);
  const nextUser = {
    ...lastUser,
    content: `${prefix}\n\n${shrunkBody}${suffix}`,
  };
  return messages.map((message, index) => (index === lastUserIndex ? nextUser : message));
}

interface RemovableUnit {
  indices: number[];
}

/** Assistant tool-call messages and their tool results must stay together. */
function buildRemovableUnits(messages: ChatMessage[]): RemovableUnit[] {
  const units: RemovableUnit[] = [];
  const linkedToolIndices = new Set<number>();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;

    const toolCallIds = new Set(message.tool_calls.map((call) => call.id));
    const indices = [index];
    for (let toolIndex = index + 1; toolIndex < messages.length; toolIndex += 1) {
      const toolMessage = messages[toolIndex];
      if (toolMessage.role !== 'tool') break;
      if (toolMessage.tool_call_id && toolCallIds.has(toolMessage.tool_call_id)) {
        indices.push(toolIndex);
        linkedToolIndices.add(toolIndex);
      }
    }
    units.push({ indices });
  }

  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index].role === 'system') continue;
    if (linkedToolIndices.has(index)) continue;
    if (units.some((unit) => unit.indices.includes(index))) continue;
    units.push({ indices: [index] });
  }

  return units;
}

function hardTruncateTail(
  messages: ChatMessage[],
  tools: ChatRequest['tools'],
  maxInputTokens: number
): ChatMessage[] {
  const fitted = [...messages];
  const units = buildRemovableUnits(fitted);

  while (fitted.length > 2 && estimateChatRequestTokens({ messages: fitted, tools }) > maxInputTokens) {
    const removableUnit = units.find(
      (unit) =>
        unit.indices.length > 0 &&
        unit.indices.every((index) => index < fitted.length - 1 && fitted[index]?.role !== 'system')
    );
    if (!removableUnit) break;

    for (const index of [...removableUnit.indices].sort((a, b) => b - a)) {
      fitted.splice(index, 1);
    }
    for (const unit of units) {
      unit.indices = unit.indices
        .filter((index) => !removableUnit.indices.includes(index))
        .map((index) => index - removableUnit.indices.filter((removed) => removed < index).length);
    }
  }

  const lastUserIndex = findLastIndex(fitted, (message) => message.role === 'user');
  if (lastUserIndex < 0) return fitted;

  const overhead = estimateChatRequestTokens({
    messages: fitted.filter((_, index) => index !== lastUserIndex),
    tools,
  });
  const userBudget = Math.max(120, maxInputTokens - overhead);
  const user = fitted[lastUserIndex];
  fitted[lastUserIndex] = {
    ...user,
    content: truncateToTokenBudget(user.content, userBudget),
  };
  return fitted;
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const maxChars = Math.max(1, tokenBudget * 4);
  if (estimateTokens(text) <= tokenBudget) return text;
  return `${text.slice(0, maxChars)}\n…[truncated for context budget]`;
}

function estimateTokensForText(text: string): number {
  return estimateTokens(text);
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}
