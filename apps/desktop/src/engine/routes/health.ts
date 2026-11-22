/** Desktop engine routes: health. */

import {
  MITII_DESKTOP_PROTOCOL,
  MITII_DESKTOP_PROTOCOL_VERSION,
} from '../../shared/protocol.js';
import {
  sendJson,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handleGetHealth(ctx: RouteContext): Promise<void> {
  const { res, cwd, options } = ctx;
  sendJson(res, 200, {
    ok: true,
    protocol: MITII_DESKTOP_PROTOCOL,
    version: MITII_DESKTOP_PROTOCOL_VERSION,
    mode: options.mode,
    workspaceRoot: cwd,
  });
}

export const healthRoutes: readonly Route[] = [
  { method: 'GET', path: '/health', handle: handleGetHealth },
];
