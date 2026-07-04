import { createServer, type Server } from 'http';
import { resolve } from 'path';
import { TaskBoardService, ParallelAgentRunner, type ParallelAgentRunnerOptions } from '../../../src/core/task';
import type { HeadlessRuntime } from '../../../src/core/headless/HeadlessConfig';
import { writeJson } from '../../daemon/src/authMiddleware';

export interface BoardServerOptions {
  cwd: string;
  hostname?: string;
  port?: number;
  token?: string;
}

export async function startMitiiBoard(options: BoardServerOptions): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const cwd = resolve(options.cwd);
  const board = new TaskBoardService(cwd);
  const hostname = options.hostname ?? '127.0.0.1';
  const port = options.port ?? 4311;
  const token = options.token ?? process.env.MITII_BOARD_TOKEN;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      writeJson(res, 401, { error: { code: 'unauthorized', message: 'Bearer token required' } });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderBoard(board.list()));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/tasks') {
      writeJson(res, 200, { tasks: board.list() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/tasks') {
      const body = await readJson(req);
      const task = board.add({ title: String(body.title ?? 'Untitled task'), prompt: String(body.prompt ?? body.title ?? '') });
      writeJson(res, 201, { task });
      return;
    }
    const match = url.pathname.match(/^\/tasks\/([^/]+)\/start$/);
    if (req.method === 'POST' && match) {
      const task = board.transition(match[1], 'running');
      writeJson(res, 200, { task });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/tasks/run') {
      const runtime = (url.searchParams.get('runtime') as HeadlessRuntime | null) ?? 'real';
      const providerType = url.searchParams.get('provider') ?? undefined;
      const runner = new ParallelAgentRunner({
        workspace: cwd,
        parallel: Number(url.searchParams.get('parallel') ?? 2),
        runtime,
        providerType: providerType as ParallelAgentRunnerOptions['providerType'],
      });
      writeJson(res, 202, await runner.runRunnable());
      return;
    }
    writeJson(res, 404, { error: { code: 'not_found', message: 'Route not found' } });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => resolveListen());
  });
  return {
    server,
    url: `http://${hostname}:${port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

async function readJson(req: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function renderBoard(tasks: Array<{ id: string; title: string; status: string; prompt: string }>): string {
  const columns = ['backlog', 'running', 'review', 'done', 'failed', 'cancelled'];
  const body = columns.map((column) => {
    const cards = tasks.filter((task) => task.status === column).map((task) =>
      `<article><strong>${escapeHtml(task.title)}</strong><small>${task.id}</small><p>${escapeHtml(task.prompt)}</p></article>`
    ).join('');
    return `<section><h2>${column}</h2>${cards || '<p class="empty">No tasks</p>'}</section>`;
  }).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Mitii Board</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f7f7f5;color:#191919}
header{padding:20px 24px;border-bottom:1px solid #ddd;background:white}
main{display:grid;grid-template-columns:repeat(6,minmax(180px,1fr));gap:12px;padding:16px;overflow:auto}
section{background:#fff;border:1px solid #ddd;border-radius:8px;min-height:70vh;padding:12px}
h1{font-size:20px;margin:0}h2{font-size:13px;text-transform:uppercase;color:#555}
article{border:1px solid #d2d2d2;border-radius:6px;padding:10px;margin:10px 0;background:#fbfbfb}
small{display:block;color:#666;margin-top:4px}.empty{color:#777}
</style></head><body><header><h1>Mitii Task Board</h1></header><main>${body}</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}
