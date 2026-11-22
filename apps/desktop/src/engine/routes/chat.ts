/** Desktop engine routes: chat. */

import {
  sendJson,
  requireAuth,
  readJsonBody,
  writeNdjson,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';
import {
  handlePrompt,
  handleResume,
} from '../chat/handlers.js';

async function handlePostPrompt(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd, options } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = await readJsonBody(req);
    await handlePrompt(options.client, cwd, body, res, req);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    if (!res.headersSent) {
      sendJson(res, 400, {
        op: 'error',
        error: message === 'invalid_json' ? 'invalid_json' : 'bad_request',
        message,
      });
    } else {
      writeNdjson(res, {
        op: 'error',
        error: 'bad_request',
        message,
      });
      res.end();
    }
  }
}

async function handlePostResume(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd, options } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = await readJsonBody(req);
    await handleResume(options.client, cwd, body, res, req);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    if (!res.headersSent) {
      sendJson(res, 400, {
        op: 'error',
        error: message === 'invalid_json' ? 'invalid_json' : 'bad_request',
        message,
      });
    } else {
      writeNdjson(res, {
        op: 'error',
        error: 'bad_request',
        message,
      });
      res.end();
    }
  }
}

export const chatRoutes: readonly Route[] = [
  { method: 'POST', path: '/v1/prompt', handle: handlePostPrompt },
  { method: 'POST', path: '/v1/resume', handle: handlePostResume },
];
