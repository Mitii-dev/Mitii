/** Minimal HTTP helpers for the desktop engine (JSON body, auth, NDJSON). */

import {
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  type DesktopPromptStreamLine,
} from '../../shared/protocol.js';

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const max = 2 * 1024 * 1024;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function writeNdjson(res: ServerResponse, line: DesktopPromptStreamLine): void {
  res.write(`${JSON.stringify(line)}\n`);
}

export function authorize(
  req: IncomingMessage,
  token: string | undefined,
): boolean {
  if (!token) return true;
  const header = req.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return Boolean(match && match[1] === token);
}

export function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
  token: string | undefined,
): boolean {
  if (authorize(req, token)) return true;
  sendJson(res, 401, { op: 'error', error: 'unauthorized' });
  return false;
}
