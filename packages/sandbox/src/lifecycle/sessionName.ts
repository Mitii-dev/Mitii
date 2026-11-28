import { createHash } from 'node:crypto';
import path from 'node:path';

/** Stable, docker-safe container name for a workspace + session key. */
export function buildSessionContainerName(params: {
  workspaceRoot: string;
  sessionKey?: string;
}): string {
  const root = path.resolve(params.workspaceRoot);
  const key = params.sessionKey?.trim() || 'default';
  const digest = createHash('sha256')
    .update(`${root}\0${key}`)
    .digest('hex')
    .slice(0, 12);
  return `mitii-sandbox-${digest}`;
}
