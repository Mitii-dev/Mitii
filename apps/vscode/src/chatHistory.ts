import { createHash } from 'node:crypto';
import type * as vscode from 'vscode';
import type { PlanArtifact } from '@mitii/sdk';

import type {
  ActivityEventPayload,
  ChatMessageView,
  ChatThreadSummary,
  RunFileChangesView,
  TokenUsageSnapshot,
} from './protocol.js';
import { parsePendingPlan } from './conversationCarry.js';

const HISTORY_KEY = 'mitii.chatHistory.v1';
const CHECKPOINT_KEY = 'mitii.checkpoints.v1';

export interface StoredThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessageView[];
  /**
   * Structured plan from the latest plan-mode turn, awaiting agent handoff.
   * Cleared after a successful agent run that consumed it, or when replaced.
   */
  pendingPlan?: PlanArtifact;
  /** Cumulative token usage for this chat thread. */
  tokenUsage?: TokenUsageSnapshot;
}

interface HistoryStore {
  threads: StoredThread[];
  activeThreadId?: string;
}

function emptyHistory(): HistoryStore {
  return { threads: [], activeThreadId: undefined };
}

function normalizeMessage(raw: ChatMessageView): ChatMessageView {
  const message: ChatMessageView = {
    id: String(raw.id ?? `m_${Date.now()}`),
    role: raw.role === 'assistant' ? 'assistant' : 'user',
    text: typeof raw.text === 'string' ? raw.text : '',
    ...(raw.mode ? { mode: raw.mode } : {}),
  };
  if (Array.isArray(raw.activity) && raw.activity.length > 0) {
    message.activity = raw.activity as ActivityEventPayload[];
  }
  if (raw.fileChanges && Array.isArray(raw.fileChanges.files)) {
    message.fileChanges = raw.fileChanges as RunFileChangesView;
  }
  if (typeof raw.status === 'string' && raw.status) {
    message.status = raw.status;
  }
  if (raw.route !== undefined) {
    message.route = raw.route;
  }
  return message;
}

function normalizeThread(raw: StoredThread): StoredThread {
  const pendingPlan = parsePendingPlan(raw.pendingPlan);
  const tokenUsage = normalizeTokenUsage(raw.tokenUsage);
  return {
    id: raw.id,
    title: raw.title,
    updatedAt: raw.updatedAt,
    messages: Array.isArray(raw.messages)
      ? raw.messages.map((message) => normalizeMessage(message))
      : [],
    ...(pendingPlan ? { pendingPlan } : {}),
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

function normalizeTokenUsage(
  raw: StoredThread['tokenUsage'],
): TokenUsageSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = Math.max(0, Number(raw.inputTokensTotal) || 0);
  const output = Math.max(0, Number(raw.outputTokensTotal) || 0);
  return {
    sessionTotal: Math.max(0, Number(raw.sessionTotal) || input + output),
    inputTokensTotal: input,
    outputTokensTotal: output,
    currentTurnTotal: Math.max(0, Number(raw.currentTurnTotal) || 0),
    currentTurnInputTokens: Math.max(
      0,
      Number(raw.currentTurnInputTokens) || 0,
    ),
    currentTurnOutputTokens: Math.max(
      0,
      Number(raw.currentTurnOutputTokens) || 0,
    ),
    aiCallCount: Math.max(0, Number(raw.aiCallCount) || 0),
    modelCalls: Math.max(0, Number(raw.modelCalls) || 0),
    toolCalls: Math.max(0, Number(raw.toolCalls) || 0),
    loopIterations: Math.max(0, Number(raw.loopIterations) || 0),
    lastPromptTokens: Math.max(0, Number(raw.lastPromptTokens) || 0),
    lastResponseTokens: Math.max(0, Number(raw.lastResponseTokens) || 0),
    turnCount: Math.max(0, Number(raw.turnCount) || 0),
    contextWindow: Math.max(0, Number(raw.contextWindow) || 0),
    estimated: Boolean(raw.estimated),
    durationMs:
      raw.durationMs === undefined
        ? undefined
        : Math.max(0, Number(raw.durationMs) || 0),
    turns: Array.isArray(raw.turns)
      ? raw.turns
          .map((turn) => ({
            turnIndex: Math.max(0, Number(turn.turnIndex) || 0),
            at: typeof turn.at === 'string' ? turn.at : new Date().toISOString(),
            inputTokens: Math.max(0, Number(turn.inputTokens) || 0),
            outputTokens: Math.max(0, Number(turn.outputTokens) || 0),
            ...(turn.finishReason ? { finishReason: String(turn.finishReason) } : {}),
            ...(turn.truncated ? { truncated: true } : {}),
            ...(turn.estimated ? { estimated: true } : {}),
          }))
          .slice(-40)
      : [],
    live: false,
    ...(raw.contextBreakdown ? { contextBreakdown: raw.contextBreakdown } : {}),
  };
}

export function loadHistory(state: vscode.Memento): HistoryStore {
  const raw = state.get<HistoryStore>(HISTORY_KEY);
  if (!raw || !Array.isArray(raw.threads)) return emptyHistory();
  return {
    threads: raw.threads.map((thread) => normalizeThread(thread)),
    activeThreadId: raw.activeThreadId,
  };
}

export async function saveHistory(
  state: vscode.Memento,
  store: HistoryStore,
): Promise<void> {
  await state.update(HISTORY_KEY, store);
}

export function toThreadSummaries(store: HistoryStore): ChatThreadSummary[] {
  return store.threads
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((t) => ({
      id: t.id,
      title: t.title,
      updatedAt: t.updatedAt,
      messageCount: t.messages.length,
    }));
}

export function newThreadId(): string {
  return `thread_${Date.now().toString(36)}_${createHash('sha1')
    .update(String(Math.random()))
    .digest('hex')
    .slice(0, 8)}`;
}

export async function appendTurn(
  state: vscode.Memento,
  options: {
    threadId?: string;
    userText: string;
    assistantText: string;
    mode?: ChatMessageView['mode'];
    activity?: ActivityEventPayload[];
    fileChanges?: RunFileChangesView;
    status?: string;
    route?: string | null;
    /** When set, replaces the thread pending plan (plan-mode completion). */
    pendingPlan?: PlanArtifact | null;
    /** Drop pending plan after a successful agent handoff. */
    clearPendingPlan?: boolean;
    tokenUsage?: TokenUsageSnapshot;
  },
): Promise<HistoryStore> {
  const store = loadHistory(state);
  let thread = options.threadId
    ? store.threads.find((t) => t.id === options.threadId)
    : store.threads.find((t) => t.id === store.activeThreadId);
  if (!thread) {
    thread = {
      id: newThreadId(),
      title: options.userText.slice(0, 48) || 'New chat',
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    store.threads.unshift(thread);
  }
  thread.messages.push({
    id: `m_${Date.now()}_u`,
    role: 'user',
    text: options.userText,
    mode: options.mode,
  });
  thread.messages.push({
    id: `m_${Date.now()}_a`,
    role: 'assistant',
    text: options.assistantText,
    mode: options.mode,
    ...(options.activity && options.activity.length > 0
      ? { activity: options.activity }
      : {}),
    ...(options.fileChanges ? { fileChanges: options.fileChanges } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.route !== undefined ? { route: options.route } : {}),
  });
  thread.updatedAt = new Date().toISOString();
  if (!thread.title || thread.title === 'New chat') {
    thread.title = options.userText.slice(0, 48) || 'New chat';
  }

  if (options.clearPendingPlan) {
    delete thread.pendingPlan;
  } else if (options.pendingPlan !== undefined) {
    if (options.pendingPlan === null) {
      delete thread.pendingPlan;
    } else {
      thread.pendingPlan = options.pendingPlan;
    }
  }

  if (options.tokenUsage) {
    thread.tokenUsage = {
      ...options.tokenUsage,
      live: false,
      turns: (options.tokenUsage.turns ?? []).slice(-40),
    };
  }

  store.activeThreadId = thread.id;
  await saveHistory(state, store);
  return store;
}

/**
 * Clear a thread's pending plan handoff state (UI dismiss / cancel).
 */
export async function clearPendingPlan(
  state: vscode.Memento,
  threadId?: string,
): Promise<HistoryStore> {
  const store = loadHistory(state);
  const thread = threadId
    ? store.threads.find((t) => t.id === threadId)
    : store.threads.find((t) => t.id === store.activeThreadId);
  if (thread?.pendingPlan) {
    delete thread.pendingPlan;
    await saveHistory(state, store);
  }
  return store;
}

export async function deleteThread(
  state: vscode.Memento,
  id: string,
): Promise<HistoryStore> {
  const store = loadHistory(state);
  store.threads = store.threads.filter((t) => t.id !== id);
  if (store.activeThreadId === id) {
    store.activeThreadId = store.threads[0]?.id;
  }
  await saveHistory(state, store);
  return store;
}

export async function clearHistory(state: vscode.Memento): Promise<HistoryStore> {
  const store = emptyHistory();
  await saveHistory(state, store);
  return store;
}

export interface CheckpointItem {
  id: string;
  label: string;
  createdAt: string;
}

export function loadCheckpoints(state: vscode.Memento): CheckpointItem[] {
  return state.get<CheckpointItem[]>(CHECKPOINT_KEY) ?? [];
}

export async function saveCheckpoints(
  state: vscode.Memento,
  items: CheckpointItem[],
): Promise<void> {
  await state.update(CHECKPOINT_KEY, items);
}
