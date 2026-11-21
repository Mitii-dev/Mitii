/** Desktop engine routes: workspace. */

import {
  type WorkspaceChangeEvent,
} from '../explorer/workspaceWatch.js';
import {
  copyWorkspaceEntries,
  createWorkspaceFile,
  createWorkspaceFolder,
  listWorkspaceDir,
  moveWorkspaceEntries,
  readWorkspaceFile,
  renameWorkspaceEntry,
  deleteWorkspaceEntries,
  searchWorkspacePaths,
  toAbsoluteWorkspacePath,
  writeWorkspaceFile,
} from '../explorer/workspaceFs.js';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handleGetWorkspaceTree(ctx: RouteContext): Promise<void> {
  const { req, res, url, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const rel = url.searchParams.get('path') ?? '';
    const entries = await listWorkspaceDir(cwd, rel);
    sendJson(res, 200, { path: rel, entries });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handleGetWorkspaceEvents(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd, workspaceWatcher } = ctx;
  if (!requireAuth(req, res, token)) return;
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(
    `${JSON.stringify({
      type: 'ready',
      at: Date.now(),
      workspaceRoot: cwd,
    })}\n`,
  );
  const onChange = (event: WorkspaceChangeEvent) => {
    if (res.writableEnded) return;
    try {
      res.write(
        `${JSON.stringify({
          type: 'change',
          at: event.at,
          paths: event.paths,
          kind: event.kind,
        })}\n`,
      );
    } catch {
      /* client gone */
    }
  };
  const unsubscribe = workspaceWatcher.subscribe(onChange);
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    try {
      res.write(`${JSON.stringify({ type: 'ping', at: Date.now() })}\n`);
    } catch {
      /* ignore */
    }
  }, 25_000);
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

async function handleGetWorkspaceSearch(ctx: RouteContext): Promise<void> {
  const { req, res, url, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const q = url.searchParams.get('q') ?? '';
    const paths = await searchWorkspacePaths(cwd, q, 40);
    sendJson(res, 200, { query: q, paths });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handleGetWorkspaceFile(ctx: RouteContext): Promise<void> {
  const { req, res, url, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const rel = url.searchParams.get('path') ?? '';
    const file = await readWorkspaceFile(cwd, rel);
    sendJson(res, 200, file);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostWorkspaceFile(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const rel = typeof body.path === 'string' ? body.path : '';
    const content = typeof body.content === 'string' ? body.content : '';
    const saved = await writeWorkspaceFile(cwd, rel, content);
    sendJson(res, 200, { ok: true, ...saved });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostWorkspaceCreateFile(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const parent =
      typeof body.parent === 'string'
        ? body.parent
        : typeof body.path === 'string'
          ? body.path
          : '';
    const name = typeof body.name === 'string' ? body.name : '';
    const content =
      typeof body.content === 'string' ? body.content : '';
    const created = await createWorkspaceFile(cwd, parent, name, content);
    sendJson(res, 200, { ok: true, ...created });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostWorkspaceCreateFolder(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const parent =
      typeof body.parent === 'string'
        ? body.parent
        : typeof body.path === 'string'
          ? body.path
          : '';
    const name = typeof body.name === 'string' ? body.name : '';
    const created = await createWorkspaceFolder(cwd, parent, name);
    sendJson(res, 200, { ok: true, ...created });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostWorkspaceCopy(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((p): p is string => typeof p === 'string')
      : typeof body.path === 'string'
        ? [body.path]
        : [];
    const destDir =
      typeof body.destDir === 'string' ? body.destDir : '';
    const result = await copyWorkspaceEntries(cwd, paths, destDir);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostWorkspaceMove(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((p): p is string => typeof p === 'string')
      : typeof body.path === 'string'
        ? [body.path]
        : [];
    const destDir =
      typeof body.destDir === 'string' ? body.destDir : '';
    const result = await moveWorkspaceEntries(cwd, paths, destDir);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostWorkspaceRename(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const rel = typeof body.path === 'string' ? body.path : '';
    const newName = typeof body.newName === 'string' ? body.newName : '';
    const renamed = await renameWorkspaceEntry(cwd, rel, newName);
    sendJson(res, 200, { ok: true, ...renamed });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostWorkspaceDelete(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((p): p is string => typeof p === 'string')
      : typeof body.path === 'string'
        ? [body.path]
        : [];
    const result = await deleteWorkspaceEntries(cwd, paths);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handleGetWorkspaceAbsolute(ctx: RouteContext): Promise<void> {
  const { req, res, url, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const rel = url.searchParams.get('path') ?? '';
    sendJson(res, 200, {
      path: rel,
      absolute: toAbsoluteWorkspacePath(cwd, rel),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

export const workspaceRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/workspace/tree', handle: handleGetWorkspaceTree },
  { method: 'GET', path: '/v1/workspace/events', handle: handleGetWorkspaceEvents },
  { method: 'GET', path: '/v1/workspace/search', handle: handleGetWorkspaceSearch },
  { method: 'GET', path: '/v1/workspace/file', handle: handleGetWorkspaceFile },
  { method: 'POST', path: '/v1/workspace/file', handle: handlePostWorkspaceFile },
  { method: 'POST', path: '/v1/workspace/create-file', handle: handlePostWorkspaceCreateFile },
  { method: 'POST', path: '/v1/workspace/create-folder', handle: handlePostWorkspaceCreateFolder },
  { method: 'POST', path: '/v1/workspace/copy', handle: handlePostWorkspaceCopy },
  { method: 'POST', path: '/v1/workspace/move', handle: handlePostWorkspaceMove },
  { method: 'POST', path: '/v1/workspace/rename', handle: handlePostWorkspaceRename },
  { method: 'POST', path: '/v1/workspace/delete', handle: handlePostWorkspaceDelete },
  { method: 'GET', path: '/v1/workspace/absolute', handle: handleGetWorkspaceAbsolute },
];
