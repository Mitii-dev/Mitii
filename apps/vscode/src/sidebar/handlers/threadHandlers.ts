import {
  clearHistory,
  clearPendingPlan,
  deleteThread,
  loadHistory,
  newThreadId,
  saveHistory,
  toThreadSummaries,
} from '../../chatHistory.js';
import type { StoredThread } from '../../chatHistory.js';
import { planViewFromArtifact } from '../../planView.js';
import type { SidebarContext } from '../context.js';

export async function handleClearPendingPlan(
  ctx: SidebarContext,
): Promise<void> {
  await clearPendingPlan(ctx.host.workspaceState, ctx.session.activeThreadId);
  ctx.post({ type: 'setPlan', plan: null });
}

export async function handleNewChat(ctx: SidebarContext): Promise<void> {
  ctx.session.runCancel?.cancel();
  const threadId = newThreadId();
  ctx.session.activeThreadId = threadId;
  const store = loadHistory(ctx.host.workspaceState);
  store.activeThreadId = threadId;
  store.threads.unshift({
    id: threadId,
    title: 'New chat',
    updatedAt: new Date().toISOString(),
    messages: [],
  });
  await saveHistory(ctx.host.workspaceState, store);
  ctx.tokens.resetToEmpty();
  ctx.post({
    type: 'history',
    threads: toThreadSummaries(store),
    activeThreadId: threadId,
  });
  ctx.post({
    type: 'thread.loaded',
    threadId,
    messages: [],
    pendingPlan: null,
  });
  ctx.post({ type: 'setPlan', plan: null });
  ctx.post({ type: 'tokenUsage', usage: ctx.tokens.usage });
}

export async function handleOpenChatThread(
  ctx: SidebarContext,
  id: string,
): Promise<void> {
  const store = loadHistory(ctx.host.workspaceState);
  const thread = store.threads.find((t) => t.id === id);
  if (!thread) return;
  ctx.session.runCancel?.cancel();
  ctx.session.activeThreadId = thread.id;
  store.activeThreadId = thread.id;
  await saveHistory(ctx.host.workspaceState, store);
  ctx.tokens.activateThread(thread.id, thread.tokenUsage);
  const pendingPlan = planViewFromArtifact(thread.pendingPlan);
  ctx.post({
    type: 'thread.loaded',
    threadId: thread.id,
    messages: thread.messages,
    pendingPlan,
  });
  ctx.post({ type: 'setPlan', plan: pendingPlan });
  ctx.post({
    type: 'history',
    threads: toThreadSummaries(store),
    activeThreadId: thread.id,
  });
  ctx.post({ type: 'tokenUsage', usage: ctx.tokens.usage });
}

export async function handleDeleteChatThread(
  ctx: SidebarContext,
  id: string,
): Promise<void> {
  const store = await deleteThread(ctx.host.workspaceState, id);
  ctx.tokens.forgetThread(id);
  ctx.session.activeThreadId = store.activeThreadId;
  const activeId = ctx.session.activeThreadId;
  if (activeId) {
    ctx.tokens.activateThread(
      activeId,
      store.threads.find((t) => t.id === activeId)?.tokenUsage,
    );
  } else {
    ctx.tokens.resetToEmpty();
  }
  ctx.post({
    type: 'history',
    threads: toThreadSummaries(store),
    activeThreadId: store.activeThreadId,
  });
  ctx.post({ type: 'tokenUsage', usage: ctx.tokens.usage });
}

export async function handleClearChatHistory(
  ctx: SidebarContext,
): Promise<void> {
  await clearHistory(ctx.host.workspaceState);
  ctx.session.activeThreadId = undefined;
  ctx.tokens.clearThreads();
  ctx.tokens.resetToEmpty();
  ctx.post({
    type: 'history',
    threads: [],
    activeThreadId: undefined,
  });
  ctx.post({ type: 'tokenUsage', usage: ctx.tokens.usage });
}

/** Resolve (or create) the thread a new prompt belongs to and persist it. */
export async function ensureActiveThread(
  ctx: SidebarContext,
  prompt: string,
): Promise<StoredThread> {
  const store = loadHistory(ctx.host.workspaceState);
  let thread = ctx.session.activeThreadId
    ? store.threads.find((t) => t.id === ctx.session.activeThreadId)
    : undefined;
  thread ??= store.activeThreadId
    ? store.threads.find((t) => t.id === store.activeThreadId)
    : undefined;
  if (!thread) {
    thread = {
      id: newThreadId(),
      title: prompt.slice(0, 48) || 'New chat',
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    store.threads.unshift(thread);
  }
  ctx.session.activeThreadId = thread.id;
  store.activeThreadId = thread.id;
  await saveHistory(ctx.host.workspaceState, store);
  ctx.post({
    type: 'history',
    threads: toThreadSummaries(store),
    activeThreadId: thread.id,
  });
  return thread;
}
