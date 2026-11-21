/** Desktop engine routes: history. */

import {
  createThread,
  deleteThread,
  loadHistory,
  saveHistory,
  upsertThreadMessages,
  upsertThreadTokenUsage,
  type DesktopChatMessage,
  type DesktopThreadTokenUsage,
} from '../history.js';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handleGetHistory(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  sendJson(res, 200, loadHistory(cwd));
}

async function handlePostHistory(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const action = String(body.action ?? 'save');
  let store = loadHistory(cwd);

  if (action === 'new') {
    store = createThread(
      store,
      typeof body.title === 'string' ? body.title : 'New chat',
    );
    saveHistory(cwd, store);
    sendJson(res, 200, store);
    return;
  }

  if (action === 'delete') {
    store = deleteThread(store, String(body.threadId ?? ''));
    saveHistory(cwd, store);
    sendJson(res, 200, store);
    return;
  }

  if (action === 'activate') {
    const threadId = String(body.threadId ?? '');
    if (!store.threads.some((t) => t.id === threadId)) {
      sendJson(res, 404, { error: 'thread_not_found' });
      return;
    }
    store = { ...store, activeThreadId: threadId };
    saveHistory(cwd, store);
    sendJson(res, 200, store);
    return;
  }

  // save messages (+ optional tokenUsage)
  const threadId = String(body.threadId ?? store.activeThreadId ?? '');
  if (!threadId) {
    store = createThread(store);
  }
  const id = threadId || store.activeThreadId!;
  const messages = Array.isArray(body.messages)
    ? (body.messages as DesktopChatMessage[])
    : undefined;
  const tokenUsage =
    body.tokenUsage && typeof body.tokenUsage === 'object'
      ? (body.tokenUsage as DesktopThreadTokenUsage)
      : undefined;

  if (messages) {
    store = upsertThreadMessages(store, id, messages, {
      title:
        typeof body.title === 'string' ? body.title : undefined,
      tokenUsage,
      ...(body.clearPendingPlan === true
        ? { clearPendingPlan: true }
        : {
            ...(Object.prototype.hasOwnProperty.call(body, 'pendingPlan')
              ? { pendingPlan: body.pendingPlan }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(
              body,
              'pendingPlanStrategy',
            )
              ? { pendingPlanStrategy: body.pendingPlanStrategy }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(
              body,
              'pendingTaskList',
            )
              ? { pendingTaskList: body.pendingTaskList }
              : {}),
          }),
    });
  } else if (tokenUsage) {
    store = upsertThreadTokenUsage(store, id, tokenUsage);
  } else if (
    body.clearPendingPlan === true ||
    Object.prototype.hasOwnProperty.call(body, 'pendingPlan')
  ) {
    const thread = store.threads.find((t) => t.id === id);
    if (!thread) {
      sendJson(res, 404, { error: 'thread_not_found' });
      return;
    }
    store = upsertThreadMessages(store, id, thread.messages, {
      clearPendingPlan: body.clearPendingPlan === true,
      ...(Object.prototype.hasOwnProperty.call(body, 'pendingPlan')
        ? { pendingPlan: body.pendingPlan }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(
        body,
        'pendingPlanStrategy',
      )
        ? { pendingPlanStrategy: body.pendingPlanStrategy }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'pendingTaskList')
        ? { pendingTaskList: body.pendingTaskList }
        : {}),
    });
  } else {
    sendJson(res, 400, { error: 'messages_or_tokenUsage_required' });
    return;
  }
  saveHistory(cwd, store);
  sendJson(res, 200, store);
}

export const historyRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/history', handle: handleGetHistory },
  { method: 'POST', path: '/v1/history', handle: handlePostHistory },
];
