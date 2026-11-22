/** Desktop engine routes: mcp. */

import {
  applyDatabaseAccessToMcpSettings,
} from '@mitii/host';
import {
  listMcpServers,
  setMcpMasterEnabled,
  setMcpServerEnabled,
  addCustomMcpServer,
  deleteMcpServer,
  installBuiltinMcpServer,
} from '../extensions.js';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handleGetMcp(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  sendJson(res, 200, listMcpServers(cwd));
}

async function handlePostMcp(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const action =
      typeof body.action === 'string' ? body.action.trim() : '';

    if (action === 'install' || action === 'installBuiltin') {
      const builtinId =
        typeof body.builtinId === 'string'
          ? body.builtinId
          : typeof body.id === 'string'
            ? body.id
            : '';
      if (!builtinId) {
        sendJson(res, 400, { ok: false, error: 'builtinId_required' });
        return;
      }
      const secrets =
        body.secrets &&
        typeof body.secrets === 'object' &&
        !Array.isArray(body.secrets)
          ? Object.fromEntries(
              Object.entries(body.secrets as Record<string, unknown>)
                .filter(
                  (entry): entry is [string, string] =>
                    typeof entry[0] === 'string' &&
                    typeof entry[1] === 'string',
                )
                .map(([k, v]) => [k, v]),
            )
          : body.env &&
              typeof body.env === 'object' &&
              !Array.isArray(body.env)
            ? Object.fromEntries(
                Object.entries(body.env as Record<string, unknown>)
                  .filter(
                    (entry): entry is [string, string] =>
                      typeof entry[0] === 'string' &&
                      typeof entry[1] === 'string',
                  )
                  .map(([k, v]) => [k, v]),
              )
            : undefined;
      sendJson(res, 200, {
        ok: true,
        ...installBuiltinMcpServer(cwd, builtinId, secrets),
        restartRequired: true,
      });
      return;
    }

    if (action === 'setDatabaseAccess' || action === 'setDbAccess') {
      const raw =
        typeof body.dbAccess === 'string'
          ? body.dbAccess.trim().toLowerCase()
          : '';
      const dbAccess =
        raw === 'readwrite' || raw === 'read_write' || raw === 'rw'
          ? 'readwrite'
          : 'readonly';
      const result = applyDatabaseAccessToMcpSettings(cwd, dbAccess);
      sendJson(res, 200, {
        ok: true,
        dbAccess,
        ...result,
        ...listMcpServers(cwd),
        restartRequired: result.changed,
      });
      return;
    }

    if (action === 'add' || action === 'create') {
      const transport =
        body.transport === 'stdio' ||
        body.transport === 'sse' ||
        body.transport === 'streamable-http'
          ? body.transport
          : null;
      if (!transport) {
        sendJson(res, 400, { ok: false, error: 'transport_required' });
        return;
      }
      const args = Array.isArray(body.args)
        ? body.args
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter(Boolean)
        : typeof body.args === 'string'
          ? body.args
              .split(/\s+/)
              .map((v) => v.trim())
              .filter(Boolean)
          : undefined;
      const headers =
        body.headers &&
        typeof body.headers === 'object' &&
        !Array.isArray(body.headers)
          ? Object.fromEntries(
              Object.entries(body.headers as Record<string, unknown>)
                .filter(
                  (entry): entry is [string, string] =>
                    typeof entry[0] === 'string' &&
                    typeof entry[1] === 'string',
                )
                .map(([k, v]) => [k, v]),
            )
          : undefined;
      sendJson(res, 200, {
        ok: true,
        ...addCustomMcpServer(cwd, {
          id: typeof body.id === 'string' ? body.id : '',
          name: typeof body.name === 'string' ? body.name : '',
          transport,
          ...(typeof body.command === 'string'
            ? { command: body.command }
            : {}),
          ...(args ? { args } : {}),
          ...(typeof body.cwd === 'string' ? { cwd: body.cwd } : {}),
          ...(typeof body.url === 'string' ? { url: body.url } : {}),
          ...(headers ? { headers } : {}),
          enabled: body.enabled !== false,
        }),
        restartRequired: true,
      });
      return;
    }

    if (action === 'delete' || action === 'remove') {
      const serverId =
        typeof body.serverId === 'string'
          ? body.serverId
          : typeof body.id === 'string'
            ? body.id
            : '';
      if (!serverId) {
        sendJson(res, 400, { ok: false, error: 'serverId_required' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        ...deleteMcpServer(cwd, serverId),
        restartRequired: true,
      });
      return;
    }

    if (typeof body.enabled === 'boolean' && body.serverId == null) {
      sendJson(res, 200, {
        ok: true,
        ...setMcpMasterEnabled(cwd, body.enabled),
      });
      return;
    }
    const serverId =
      typeof body.serverId === 'string'
        ? body.serverId
        : typeof body.id === 'string'
          ? body.id
          : '';
    if (!serverId || typeof body.enabled !== 'boolean') {
      sendJson(res, 400, {
        ok: false,
        error: 'serverId_and_enabled_required',
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      ...setMcpServerEnabled(cwd, serverId, body.enabled),
      restartRequired: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

export const mcpRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/mcp', handle: handleGetMcp },
  { method: 'POST', path: '/v1/mcp', handle: handlePostMcp },
];
