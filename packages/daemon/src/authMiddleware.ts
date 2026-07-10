import { timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

export interface AuthOptions {
  token?: string;
}

export function isAuthorized(req: IncomingMessage, options: AuthOptions): boolean {
  if (!options.token) return true;
  const header = req.headers.authorization ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  return safeEqual(header.slice(prefix.length), options.token);
}

export function writeUnauthorized(res: ServerResponse): void {
  writeJson(res, 401, { error: { code: 'unauthorized', message: 'Missing or invalid bearer token' } });
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}
