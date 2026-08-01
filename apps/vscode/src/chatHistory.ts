import { createHash } from 'node:crypto';
import type * as vscode from 'vscode';
import type { PlanArtifact } from '@mitii/sdk';

import type {
  ActivityEventPayload,
  ChatMessageView,
  ChatThreadSummary,
  RunFileChangesView,
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
  return {
    id: raw.id,
    title: raw.title,
    updatedAt: raw.updatedAt,
    messages: Array.isArray(raw.messages)
      ? raw.messages.map((message) => normalizeMessage(message))
      : [],
    ...(pendingPlan ? { pendingPlan } : {}),
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

  store.activeThreadId = thread.id;
  await saveHistory(state, store);
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
