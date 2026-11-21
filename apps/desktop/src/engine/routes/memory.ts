/** Desktop engine routes: memory. */

import {
  clearWorkspaceMemories,
  commitWorkspaceMemory,
  deleteWorkspaceMemory,
  listWorkspaceMemoriesForView,
} from '@mitii/host';
import {
  workspaceIdFromRoot,
} from '../workspace-id.js';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handleGetMemory(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const workspaceId = workspaceIdFromRoot(cwd);
  const memories = await listWorkspaceMemoriesForView(cwd, workspaceId);
  sendJson(res, 200, { memories });
}

async function handlePostMemory(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const text = typeof body.text === 'string' ? body.text : '';
  try {
    const memories = await commitWorkspaceMemory({
      workspaceRoot: cwd,
      workspaceId: workspaceIdFromRoot(cwd),
      content: text,
    });
    sendJson(res, 200, { memories });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handleDeleteMemoryById(ctx: RouteContext): Promise<void> {
  const { req, res, path, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const id = decodeURIComponent(path.slice('/v1/memory/'.length));
  if (!id || id === 'clear') {
    sendJson(res, 400, { ok: false, error: 'memory_id_required' });
    return;
  }
  const memories = await deleteWorkspaceMemory({
    workspaceRoot: cwd,
    workspaceId: workspaceIdFromRoot(cwd),
    id,
  });
  sendJson(res, 200, { memories });
}

async function handlePostMemoryClear(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  await clearWorkspaceMemories({
    workspaceRoot: cwd,
    workspaceId: workspaceIdFromRoot(cwd),
  });
  sendJson(res, 200, { memories: [] });
}

export const memoryRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/memory', handle: handleGetMemory },
  { method: 'POST', path: '/v1/memory', handle: handlePostMemory },
  { method: 'DELETE', match: (path) => path.startsWith('/v1/memory/'), handle: handleDeleteMemoryById },
  { method: 'POST', path: '/v1/memory/clear', handle: handlePostMemoryClear },
];
