/**
 * Desktop chat history — `.mitii/desktop-chat-history.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DesktopChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: string;
  status?: string;
}

export interface DesktopChatThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: DesktopChatMessage[];
}

export interface DesktopHistoryStore {
  threads: DesktopChatThread[];
  activeThreadId?: string;
}

function historyPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'desktop-chat-history.json');
}

function empty(): DesktopHistoryStore {
  return { threads: [], activeThreadId: undefined };
}

function normalizeMessage(raw: unknown): DesktopChatMessage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const role = obj.role === 'assistant' ? 'assistant' : 'user';
  const base: DesktopChatMessage = {
    id: String(obj.id ?? `m_${Date.now()}`),
    role,
    text: typeof obj.text === 'string' ? obj.text : '',
    ...(typeof obj.mode === 'string' ? { mode: obj.mode } : {}),
    ...(typeof obj.status === 'string' ? { status: obj.status } : {}),
  };
  // Preserve richer desktop fields (activity timeline, file-change cards).
  return {
    ...base,
    ...(Array.isArray(obj.activity) ? { activity: obj.activity } : {}),
    ...(obj.fileChanges && typeof obj.fileChanges === 'object'
      ? { fileChanges: obj.fileChanges }
      : {}),
  } as DesktopChatMessage;
}

function normalizeThread(raw: unknown): DesktopChatThread | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const id = String(obj.id ?? '').trim();
  if (!id) return undefined;
  return {
    id,
    title: String(obj.title ?? 'Chat').trim() || 'Chat',
    updatedAt:
      typeof obj.updatedAt === 'string'
        ? obj.updatedAt
        : new Date().toISOString(),
    messages: Array.isArray(obj.messages)
      ? obj.messages
          .map(normalizeMessage)
          .filter((m): m is DesktopChatMessage => Boolean(m))
      : [],
  };
}

export function loadHistory(workspaceRoot: string): DesktopHistoryStore {
  const path = historyPath(workspaceRoot);
  if (!existsSync(path)) return empty();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >;
    const threads = Array.isArray(raw.threads)
      ? raw.threads
          .map(normalizeThread)
          .filter((t): t is DesktopChatThread => Boolean(t))
      : [];
    const activeThreadId =
      typeof raw.activeThreadId === 'string' &&
      threads.some((t) => t.id === raw.activeThreadId)
        ? raw.activeThreadId
        : threads[0]?.id;
    return { threads, activeThreadId };
  } catch {
    return empty();
  }
}

export function saveHistory(
  workspaceRoot: string,
  store: DesktopHistoryStore,
): void {
  const dir = join(workspaceRoot, '.mitii');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    historyPath(workspaceRoot),
    `${JSON.stringify(store, null, 2)}\n`,
    'utf8',
  );
}

export function createThread(
  store: DesktopHistoryStore,
  title = 'New chat',
): DesktopHistoryStore {
  const id = `thread_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const thread: DesktopChatThread = {
    id,
    title,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  return {
    threads: [thread, ...store.threads].slice(0, 100),
    activeThreadId: id,
  };
}

export function upsertThreadMessages(
  store: DesktopHistoryStore,
  threadId: string,
  messages: DesktopChatMessage[],
  title?: string,
): DesktopHistoryStore {
  const existing = store.threads.some((thread) => thread.id === threadId);
  if (!existing) {
    const created: DesktopChatThread = {
      id: threadId,
      title:
        title?.trim() ||
        messages.find((m) => m.role === 'user')?.text.slice(0, 60) ||
        'Chat',
      updatedAt: new Date().toISOString(),
      messages,
    };
    return {
      threads: [created, ...store.threads].slice(0, 100),
      activeThreadId: threadId,
    };
  }
  const threads = store.threads.map((thread) => {
    if (thread.id !== threadId) return thread;
    const nextTitle =
      title?.trim() ||
      thread.title ||
      messages.find((m) => m.role === 'user')?.text.slice(0, 60) ||
      'Chat';
    return {
      ...thread,
      title: nextTitle,
      messages,
      updatedAt: new Date().toISOString(),
    };
  });
  return { threads, activeThreadId: threadId };
}

export function deleteThread(
  store: DesktopHistoryStore,
  threadId: string,
): DesktopHistoryStore {
  const threads = store.threads.filter((t) => t.id !== threadId);
  const activeThreadId =
    store.activeThreadId === threadId ? threads[0]?.id : store.activeThreadId;
  return { threads, activeThreadId };
}
