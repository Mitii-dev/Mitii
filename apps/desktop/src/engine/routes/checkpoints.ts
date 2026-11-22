/** Desktop engine routes: checkpoints. */

import {
  clearCheckpointLabels,
  deleteCheckpointLabel,
  loadCheckpointLabels,
} from '../checkpointLabels.js';
import {
  sendJson,
  requireAuth,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handleGetCheckpoints(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const checkpoints = await loadCheckpointLabels(cwd);
  sendJson(res, 200, { checkpoints });
}

async function handleDeleteCheckpointsById(ctx: RouteContext): Promise<void> {
  const { req, res, path, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const id = decodeURIComponent(path.slice('/v1/checkpoints/'.length));
  if (!id) {
    sendJson(res, 400, { ok: false, error: 'checkpoint_id_required' });
    return;
  }
  const checkpoints = await deleteCheckpointLabel({
    workspaceRoot: cwd,
    id,
  });
  sendJson(res, 200, { checkpoints });
}

async function handlePostCheckpointsClear(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  await clearCheckpointLabels(cwd);
  sendJson(res, 200, { checkpoints: [] });
}

async function handlePostCheckpointsRestore(ctx: RouteContext): Promise<void> {
  const { req, res, path, token } = ctx;
  if (!requireAuth(req, res, token)) return;
  const id = decodeURIComponent(
    path.slice('/v1/checkpoints/'.length, -'/restore'.length),
  );
  // UI labels are not engine RestorePoints yet (same stub as VS Code panel).
  sendJson(res, 200, {
    ok: true,
    message: `Checkpoint restore for ${id} is recorded. Full file restore uses engine RestorePoints when available for a run.`,
  });
}

export const checkpointsRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/checkpoints', handle: handleGetCheckpoints },
  { method: 'DELETE', match: (path) => path.startsWith('/v1/checkpoints/'), handle: handleDeleteCheckpointsById },
  { method: 'POST', path: '/v1/checkpoints/clear', handle: handlePostCheckpointsClear },
  { method: 'POST', match: (path) => path.startsWith('/v1/checkpoints/') && path.endsWith('/restore'), handle: handlePostCheckpointsRestore },
];
