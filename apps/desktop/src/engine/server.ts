/**
 * Local HTTP engine for Mitii Desktop.
 * Agent authority stays in MitiiClient (host-injected); this is transport only.
 *
 * Routes live in `./routes/` (one module per feature); this file only wires
 * the route table, auth-free dispatch, error logging and server lifecycle.
 */

import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import { generateEngineToken } from '../shared/engine-token.js';
import { appendDesktopLog, errorMessage, resolveLogsDir } from '../shared/project-logs.js';
import { isAllowedEngineBaseUrl } from '../shared/window-url-policy.js';
import { startDesktopIncrementalIndex } from './explorer/desktopIndex.js';
import { createWorkspaceWatcher } from './explorer/workspaceWatch.js';
import { sendJson } from './http/httpUtils.js';
import type { RouteContext } from './http/types.js';
import { findRoute } from './routes/index.js';
import type {
  EngineServerHandle,
  EngineServerOptions,
} from './serverOptions.js';

export { generateEngineToken };
export type { EngineServerHandle, EngineServerOptions };

export async function startEngineServer(
  options: EngineServerOptions,
): Promise<EngineServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const token = options.token;
  const cwd = options.workspaceRoot;
  const workspaceWatcher = createWorkspaceWatcher(cwd);
  const incrementalIndex = startDesktopIncrementalIndex(cwd, workspaceWatcher);

  const server: Server = createServer((req, res) => {
    void (async () => {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const path = url.pathname;
      const route = findRoute(method, path);
      if (!route) {
        sendJson(res, 404, { op: 'error', error: 'not_found' });
        return;
      }
      const ctx: RouteContext = {
        req,
        res,
        method,
        path,
        url,
        token,
        cwd,
        options,
        workspaceWatcher,
      };
      await route.handle(ctx);
    })().catch((error) => {
      const message = errorMessage(error);
      const logsDir =
        resolveLogsDir(undefined, process.env) ?? join(cwd, '.mitii', 'logs');
      const failedMethod = req.method ?? 'GET';
      let failedPath = '/';
      try {
        failedPath = new URL(req.url ?? '/', `http://${host}`).pathname;
      } catch {
        failedPath = req.url ?? '/';
      }
      appendDesktopLog(
        logsDir,
        'engine',
        `route_failed ${failedMethod} ${failedPath} ${message}`,
        {
          level: 'error',
          mirrorRuns: true,
          extra: { method: failedMethod, path: failedPath },
        },
      );
      if (!res.headersSent) {
        sendJson(res, 500, { op: 'error', error: 'internal', message });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('engine_bind_failed');
  }

  const url = `http://${host}:${address.port}`;
  if (!isAllowedEngineBaseUrl(url)) {
    server.close();
    throw new Error(`engine_url_not_allowed:${url}`);
  }

  return {
    url,
    host,
    port: address.port,
    token,
    close: () =>
      new Promise((resolve, reject) => {
        incrementalIndex.dispose();
        workspaceWatcher.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
