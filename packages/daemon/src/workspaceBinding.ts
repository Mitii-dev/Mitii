import { realpathSync } from 'fs';
import { resolve } from 'path';

export function canonicalWorkspace(path: string): string {
  return realpathSync(resolve(path));
}

export function validateWorkspace(boundCwd: string, requested?: string): { ok: true } | { ok: false; message: string } {
  if (!requested) return { ok: true };
  const actual = canonicalWorkspace(requested);
  const expected = canonicalWorkspace(boundCwd);
  if (actual === expected) return { ok: true };
  return { ok: false, message: `Daemon is bound to ${expected}; requested cwd ${actual}` };
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}
