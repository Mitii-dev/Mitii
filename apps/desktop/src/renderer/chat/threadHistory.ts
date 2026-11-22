/** Compact chat threads for persistence and restore token usage. */

import {
  compactFileChangesForHistory,
  enrichAssistantCarryText,
  compactActivityForHistory,
} from '../../shared/conversationCarry.js';
import { type DesktopActivityItem } from '../../shared/activity.js';
import { type TokenUsageState, emptyTokenUsage } from '@mitii/ui-react';
import { type ChatMessage, type HistoryThread } from './chatTypes.js';

export function compactMessagesForHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(({ streaming: _s, ...rest }) => {
    if (rest.role !== 'assistant') return rest;
    const changedPaths = rest.fileChanges?.files.map((f) => f.path) ?? [];
    const compactedChanges = rest.fileChanges
      ? compactFileChangesForHistory({
          runId: rest.fileChanges.runId ?? rest.id,
          files: rest.fileChanges.files,
          totalAdditions: rest.fileChanges.totalAdditions,
          totalDeletions: rest.fileChanges.totalDeletions,
        })
      : undefined;
    const next: ChatMessage = {
      ...rest,
      text: enrichAssistantCarryText({
        answer: rest.text,
        changedPaths,
      }),
    };
    if (rest.activity) {
      next.activity = compactActivityForHistory(
        rest.activity,
      ) as DesktopActivityItem[];
    }
    if (compactedChanges) {
      next.fileChanges = {
        ...compactedChanges,
        ...(rest.fileChanges?.runId
          ? { runId: rest.fileChanges.runId }
          : {}),
      };
    }
    return next;
  });
}

export function serializeTokenUsage(usage: TokenUsageState): TokenUsageState {
  const {
    live: _live,
    inputTokensTotal,
    outputTokensTotal,
    sessionTotal,
    modelCalls,
    toolCalls,
    turnCount,
    lastPromptTokens,
    lastResponseTokens,
    currentTurnTotal,
    contextWindow,
    cacheHitTokens,
    cacheMissTokens,
    durationMs,
    contextBreakdown,
  } = usage;
  return {
    inputTokensTotal,
    outputTokensTotal,
    sessionTotal:
      sessionTotal || inputTokensTotal + outputTokensTotal,
    modelCalls,
    toolCalls,
    turnCount,
    lastPromptTokens,
    lastResponseTokens,
    currentTurnTotal,
    contextWindow,
    cacheHitTokens: cacheHitTokens ?? 0,
    cacheMissTokens: cacheMissTokens ?? 0,
    ...(typeof durationMs === 'number' && durationMs > 0
      ? { durationMs }
      : {}),
    ...(contextBreakdown ? { contextBreakdown } : {}),
  };
}

export function tokenUsageFromThread(
  thread: HistoryThread | undefined,
  contextWindow = 0,
): TokenUsageState {
  if (!thread?.tokenUsage) {
    return emptyTokenUsage(contextWindow);
  }
  const usage = serializeTokenUsage(thread.tokenUsage);
  return {
    ...usage,
    contextWindow: usage.contextWindow || contextWindow,
    cacheHitTokens: usage.cacheHitTokens ?? 0,
    cacheMissTokens: usage.cacheMissTokens ?? 0,
    live: false,
  };
}
