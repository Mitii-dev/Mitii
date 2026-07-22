import { isAbsolute, relative, resolve } from 'path';

/** Safe session / task identifiers for filesystem paths (no separators or traversal). */
export const SAFE_IDENTIFIER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** Diagnostics record filenames under a session directory. */
export const DIAGNOSTICS_RECORD_FILE_RE = /^\d{13}-[a-z0-9]{6}\.json$/;

export function assertSafeIdentifier(value: string, label = 'identifier'): string {
  const trimmed = value.trim();
  if (!SAFE_IDENTIFIER_RE.test(trimmed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return trimmed;
}

export function sanitizeIdentifier(value: string, fallback = 'task'): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || fallback;
}

/** Resolve a relative path under workspaceRoot and reject escapes. */
export function safeWorkspaceChild(workspaceRoot: string, relativePath: string): string {
  const root = resolve(workspaceRoot);
  const candidate = resolve(root, relativePath);
  const rel = relative(root, candidate).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return candidate;
}
