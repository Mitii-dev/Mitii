import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { version as nodeVersion } from 'process';
import { isAuthorized, writeJson, writeUnauthorized } from './authMiddleware';
import { SessionConflictError, SessionLimitError, SessionManager, SessionNotFoundError } from './sessionManager';
import { SseHub } from './sseHub';
import { isLoopbackHost, validateWorkspace } from './workspaceBinding';
import type { MitiiApprovalDecision, MitiiMode } from '../../../src/core/headless/events';

export interface MitiiDaemonServerOptions {
  cwd: string;
  hostname?: string;
  port?: number;
  token?: string;
  maxSessions?: number;
  allowOrigin?: string;
  insecureBind?: boolean;
  packageRoot?: string;
}

export interface MitiiDaemonServerHandle {
  server: Server;
  url: string;
  close(): Promise<void>;
}

export async function startMitiiDaemon(options: MitiiDaemonServerOptions): Promise<MitiiDaemonServerHandle> {
  const hostname = options.hostname ?? '127.0.0.1';
  const port = options.port ?? 4310;
  const token = options.token ?? process.env.MITII_SERVER_TOKEN;
  if (!isLoopbackHost(hostname) && !options.insecureBind) {
    throw new Error('Refusing non-loopback bind without --insecure-bind');
  }
  if (!isLoopbackHost(hostname) && !token) {
    throw new Error('MITII_SERVER_TOKEN or --token is required for non-loopback daemon binds');
  }

  const sseHub = new SseHub();
  const sessions = new SessionManager({
    cwd: resolve(options.cwd),
    maxSessions: options.maxSessions ?? 5,
    packageRoot: options.packageRoot,
    sseHub,
  });

  const server = createServer(async (req, res) => {
    try {
      applyCors(req, res, options.allowOrigin);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (!isAuthorized(req, { token })) {
        writeUnauthorized(res);
        return;
      }
      await route(req, res, sessions, sseHub, options);
    } catch (error) {
      const status = statusForError(error);
      writeJson(res, status, { error: { code: codeForStatus(status), message: error instanceof Error ? error.message : String(error) } });
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => resolveListen());
  });

  const close = async () => {
    await sessions.dispose();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  };

  return { server, url: `http://${hostname}:${port}`, close };
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionManager,
  sseHub: SseHub,
  options: MitiiDaemonServerOptions
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/health') {
    writeJson(res, 200, {
      ok: true,
      version: readPackageVersion(),
      node: nodeVersion,
      cwd: resolve(options.cwd),
      sessions: sessions.list().length,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/capabilities') {
    writeJson(res, 200, {
      features: ['sessions', 'sse', 'permissions', 'cancel', 'subagents', 'worktrees'],
      maxSessions: options.maxSessions ?? 5,
      supportedModes: ['ask', 'plan', 'agent', 'review'],
      eventReplay: true,
      auth: Boolean(options.token ?? process.env.MITII_SERVER_TOKEN),
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/sessions') {
    writeJson(res, 200, { sessions: sessions.list() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/session') {
    const body = await readJson(req);
    const validation = validateWorkspace(options.cwd, stringValue(body.cwd));
    if (!validation.ok) {
      writeJson(res, 400, { error: { code: 'workspace_mismatch', message: validation.message } });
      return;
    }
    const session = await sessions.create(body);
    writeJson(res, 201, { session });
    return;
  }

  if (parts[0] === 'session' && parts[1]) {
    const id = parts[1];
    if (req.method === 'GET' && parts.length === 2) {
      const session = sessions.get(id);
      if (!session) throw new SessionNotFoundError(id);
      writeJson(res, 200, { session });
      return;
    }
    if (req.method === 'DELETE' && parts.length === 2) {
      writeJson(res, sessions.close(id) ? 200 : 404, { closed: true });
      return;
    }
    if (req.method === 'POST' && parts[2] === 'prompt') {
      const body = await readJson(req);
      const validation = validateWorkspace(options.cwd, stringValue(body.cwd));
      if (!validation.ok) {
        writeJson(res, 400, { error: { code: 'workspace_mismatch', message: validation.message } });
        return;
      }
      const result = await sessions.prompt(id, {
        mode: isMitiiMode(body.mode) ? body.mode : undefined,
        message: String(body.message ?? ''),
        attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
      });
      writeJson(res, 202, result);
      return;
    }
    if (req.method === 'POST' && parts[2] === 'cancel') {
      writeJson(res, sessions.cancel(id) ? 200 : 404, { cancelled: true });
      return;
    }
    if (req.method === 'GET' && parts[2] === 'events') {
      const last = Number(req.headers['last-event-id'] ?? url.searchParams.get('lastEventId') ?? 0);
      const unsubscribe = sseHub.subscribe(id, res, last);
      req.on('close', unsubscribe);
      return;
    }
    if (req.method === 'POST' && parts[2] === 'permissions' && parts[3] && parts[4] === 'respond') {
      const body = await readJson(req);
      const ok = sessions.respondToPermission(id, parts[3], body.decision as MitiiApprovalDecision);
      writeJson(res, ok ? 200 : 404, { ok });
      return;
    }
  }

  writeJson(res, 404, { error: { code: 'not_found', message: 'Route not found' } });
}

function applyCors(req: IncomingMessage, res: ServerResponse, allowOrigin?: string): void {
  const origin = req.headers.origin;
  if (!allowOrigin || !origin) return;
  if (allowOrigin === '*' || allowOrigin === origin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'authorization, content-type, last-event-id');
    res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function statusForError(error: unknown): number {
  if (error instanceof SessionNotFoundError) return 404;
  if (error instanceof SessionLimitError) return 503;
  if (error instanceof SessionConflictError) return 409;
  return 500;
}

function codeForStatus(status: number): string {
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 503) return 'unavailable';
  return 'internal_error';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isMitiiMode(value: unknown): value is MitiiMode {
  return value === 'ask' || value === 'plan' || value === 'agent' || value === 'review';
}
