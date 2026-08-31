import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { EventIngress } from '../events/ingress.js';
import { normalizeGitHubWebhook } from '../events/github.js';
import type { AutomationEventEnvelope } from '../events/types.js';
import { verifyGitHubWebhookSignature } from '../security/githubWebhook.js';
import type { AutomationService } from '../service.js';

export interface AutomationWebhookServerOptions {
  service: AutomationService;
  host?: string;
  port: number;
  /** Shared secret for `Authorization: Bearer …` or `X-Mitii-Token`. */
  token?: string;
  /**
   * GitHub webhook secret for `X-Hub-Signature-256` on `/hooks/github`.
   * When set, unsigned or invalid signatures are rejected (401).
   */
  githubWebhookSecret?: string;
  workspaceRoot?: string;
}

export interface AutomationWebhookServer {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Minimal ingress HTTP surface for Phase 2+.
 * Kept inside @mitii/automation (no sdk) so apps/daemon and CLI can share it.
 */
export async function startAutomationWebhookServer(
  options: AutomationWebhookServerOptions,
): Promise<AutomationWebhookServer> {
  const host = options.host ?? '127.0.0.1';
  const ingress = new EventIngress({ store: options.service.store });

  const server = createServer((req, res) => {
    void handleRequest(req, res, {
      ingress,
      token: options.token,
      githubWebhookSecret: options.githubWebhookSecret,
      workspaceRoot: options.workspaceRoot,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => resolve());
  });

  const address = server.address();
  const port =
    address && typeof address === 'object' ? address.port : options.port;
  return {
    url: `http://${host}:${port}`,
    close: () => closeServer(server),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    ingress: EventIngress;
    token?: string;
    githubWebhookSecret?: string;
    workspaceRoot?: string;
  },
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/hooks/github') {
      const raw = await readRaw(req);
      if (ctx.githubWebhookSecret) {
        const sig = headerValue(req.headers, 'x-hub-signature-256');
        if (
          !verifyGitHubWebhookSignature({
            rawBody: raw,
            signatureHeader: sig,
            secret: ctx.githubWebhookSecret,
          })
        ) {
          json(res, 401, { error: 'invalid_github_signature' });
          return;
        }
      } else if (ctx.token && !authorize(req, ctx.token)) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }

      let body: unknown;
      try {
        body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
      } catch {
        json(res, 400, { error: 'invalid_json' });
        return;
      }
      const envelope = normalizeGitHubWebhook({
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
        workspaceRoot: ctx.workspaceRoot,
      });
      if (!envelope) {
        json(res, 400, { error: 'unrecognized github payload' });
        return;
      }
      const result = ctx.ingress.ingestEvent(envelope);
      json(res, 202, {
        eventId: result.event.eventId,
        eventType: result.event.eventType,
        duplicate: result.duplicate,
        status: result.event.processingStatus,
        queued: result.queuedRuns.map((r) => r.runId),
        suppressions: result.suppressions,
      });
      return;
    }

    if (ctx.token && !authorize(req, ctx.token)) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/events') {
      const body = await readJson(req);
      const result = ctx.ingress.ingestEvent(body as AutomationEventEnvelope);
      json(res, 202, {
        eventId: result.event.eventId,
        duplicate: result.duplicate,
        status: result.event.processingStatus,
        queued: result.queuedRuns.map((r) => r.runId),
        suppressions: result.suppressions,
      });
      return;
    }

    json(res, 404, { error: 'not_found' });
  } catch (error) {
    json(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function authorize(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth === `Bearer ${token}`) return true;
  const header = req.headers['x-mitii-token'];
  if (typeof header === 'string' && header === token) return true;
  return false;
}

function headerValue(
  headers: IncomingMessage['headers'],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0];
    return value;
  }
  return undefined;
}

function json(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readRaw(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString('utf8')) as unknown;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
