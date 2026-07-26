import { createHash } from 'node:crypto';
import type * as vscode from 'vscode';

import type { ChatMessageView, ChatThreadSummary } from './protocol.js';

const HISTORY_KEY = 'mitii.chatHistory.v1';
const MEMORY_KEY = 'mitii.memories.v1';
const CHECKPOINT_KEY = 'mitii.checkpoints.v1';

export interface StoredThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessageView[];
}

interface HistoryStore {
  threads: StoredThread[];
  activeThreadId?: string;
}

function emptyHistory(): HistoryStore {
  return { threads: [], activeThreadId: undefined };
}

export function loadHistory(
  state: vscode.Memento,
): HistoryStore {
  const raw = state.get<HistoryStore>(HISTORY_KEY);
  if (!raw || !Array.isArray(raw.threads)) return emptyHistory();
  return raw;
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
  });
  thread.updatedAt = new Date().toISOString();
  if (!thread.title || thread.title === 'New chat') {
    thread.title = options.userText.slice(0, 48) || 'New chat';
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

export interface MemoryItem {
  id: string;
  text: string;
  createdAt: string;
}

export function loadMemories(state: vscode.Memento): MemoryItem[] {
  return state.get<MemoryItem[]>(MEMORY_KEY) ?? [];
}

export async function saveMemories(
  state: vscode.Memento,
  items: MemoryItem[],
): Promise<void> {
  await state.update(MEMORY_KEY, items);
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
