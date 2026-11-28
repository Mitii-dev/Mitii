/** Desktop engine routes: git. */

import {
  getGitFileChangesSummary,
  getGitFileDiff,
  getGitWorkingTreeCoalesced,
  gitCheckout,
  gitCommit,
  gitDiscard,
  gitStage,
  gitStash,
  gitUnstage,
  listGitBranches,
} from '../git/workingTree.js';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  asOptionalStringPaths,
} from '../http/bodyParsers.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handleGetGitStatus(ctx: RouteContext): Promise<void> {
  const { req, res, url, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const wantStat = url.searchParams.get('stat') === '1';
    sendJson(
      res,
      200,
      await getGitWorkingTreeCoalesced(cwd, {
        includeStatPreview: wantStat,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 500, {
      ok: false,
      summary: message,
      staged: [],
      changes: [],
      untracked: [],
      files: [],
      error: message,
    });
  }
}

async function handleGetGitDiff(ctx: RouteContext): Promise<void> {
  const { req, res, url, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const rel = url.searchParams.get('path') ?? '';
  sendJson(res, 200, await getGitFileDiff(cwd, rel));
}

async function handlePostGitFileChanges(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as {
      paths?: unknown;
      beforePaths?: unknown;
      sinceMs?: unknown;
    };
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((p): p is string => typeof p === 'string')
      : [];
    const beforePaths = Array.isArray(body.beforePaths)
      ? body.beforePaths.filter((p): p is string => typeof p === 'string')
      : undefined;
    const sinceMs =
      typeof body.sinceMs === 'number' && Number.isFinite(body.sinceMs)
        ? body.sinceMs
        : undefined;
    sendJson(
      res,
      200,
      await getGitFileChangesSummary(cwd, paths, {
        ...(beforePaths ? { beforePaths } : {}),
        ...(typeof sinceMs === 'number' ? { sinceMs } : {}),
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handleGetGitBranches(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  sendJson(res, 200, await listGitBranches(cwd));
}

async function handlePostGitStage(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as { paths?: unknown };
    const paths = asOptionalStringPaths(body.paths);
    sendJson(res, 200, await gitStage(cwd, paths));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostGitUnstage(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as { paths?: unknown };
    const paths = asOptionalStringPaths(body.paths);
    sendJson(res, 200, await gitUnstage(cwd, paths));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostGitDiscard(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as {
      paths?: unknown;
      includeUntracked?: unknown;
    };
    const paths = asOptionalStringPaths(body.paths) ?? [];
    const includeUntracked = body.includeUntracked === true;
    sendJson(
      res,
      200,
      await gitDiscard(cwd, paths, { includeUntracked }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostGitCommit(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as {
      message?: unknown;
      all?: unknown;
    };
    const message =
      typeof body.message === 'string' ? body.message : '';
    sendJson(
      res,
      200,
      await gitCommit(cwd, message, { all: body.all === true }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostGitStash(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as {
      paths?: unknown;
      includeUntracked?: unknown;
      message?: unknown;
    };
    const paths = asOptionalStringPaths(body.paths) ?? [];
    const stashMessage =
      typeof body.message === 'string' ? body.message : undefined;
    sendJson(
      res,
      200,
      await gitStash(cwd, paths, {
        includeUntracked: body.includeUntracked === true,
        ...(stashMessage ? { message: stashMessage } : {}),
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostGitCheckout(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as {
      branch?: unknown;
      create?: unknown;
    };
    const branch =
      typeof body.branch === 'string' ? body.branch.trim() : '';
    if (!branch) {
      sendJson(res, 400, { ok: false, error: 'branch_required' });
      return;
    }
    sendJson(
      res,
      200,
      await gitCheckout(cwd, branch, {
        create: body.create === true,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

export const gitRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/git/status', handle: handleGetGitStatus },
  { method: 'GET', path: '/v1/git/diff', handle: handleGetGitDiff },
  { method: 'POST', path: '/v1/git/file-changes', handle: handlePostGitFileChanges },
  { method: 'GET', path: '/v1/git/branches', handle: handleGetGitBranches },
  { method: 'POST', path: '/v1/git/stage', handle: handlePostGitStage },
  { method: 'POST', path: '/v1/git/unstage', handle: handlePostGitUnstage },
  { method: 'POST', path: '/v1/git/discard', handle: handlePostGitDiscard },
  { method: 'POST', path: '/v1/git/commit', handle: handlePostGitCommit },
  { method: 'POST', path: '/v1/git/stash', handle: handlePostGitStash },
  { method: 'POST', path: '/v1/git/checkout', handle: handlePostGitCheckout },
];
