/** Shared route contract for the desktop engine HTTP server. */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { WorkspaceWatcher } from '../explorer/workspaceWatch.js';
import type { EngineServerOptions } from '../serverOptions.js';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  url: URL;
  token: string | undefined;
  /** Workspace root (cwd) the engine serves. */
  cwd: string;
  options: EngineServerOptions;
  workspaceWatcher: WorkspaceWatcher;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void>;

/** One HTTP route: exact `path`, or a `match` predicate for param routes. */
export interface Route {
  method: string;
  path?: string;
  match?: (path: string) => boolean;
  handle: RouteHandler;
}
