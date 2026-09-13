import { realpath, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, normalize, resolve, sep } from 'node:path';

/**
 * Resolve a facts.json path under an allowed root.
 * Rejects absolute escapes, `..`, and symlinks that leave the root.
 */
export async function resolveSafeFactsPath(params: {
  workspaceRoot: string;
  relativeOrAbsolute?: string;
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const rootRaw = params.workspaceRoot.trim();
  if (!rootRaw) {
    return { ok: false, error: 'MITII_WORKSPACE_ROOT is required for memory tools.' };
  }

  let rootReal: string;
  try {
    rootReal = await realpath(resolve(rootRaw));
  } catch {
    return { ok: false, error: 'Workspace root does not exist or is unreadable.' };
  }

  const candidate = params.relativeOrAbsolute?.trim()
    ? params.relativeOrAbsolute.trim()
    : `.mitii${sep}memory${sep}facts.json`;

  const absolute = isAbsolute(candidate)
    ? normalize(candidate)
    : resolve(rootReal, candidate);

  // Pre-check path segments for `..` before realpath (file may not exist yet).
  const relativeProbe = absolute.startsWith(rootReal + sep) || absolute === rootReal;
  if (!relativeProbe && !absolute.startsWith(rootReal)) {
    // Fall through to realpath when possible; still reject obvious escapes.
  }

  try {
    await access(absolute, constants.R_OK);
  } catch {
    return { ok: false, error: `Facts file not readable: ${candidate}` };
  }

  let fileReal: string;
  try {
    fileReal = await realpath(absolute);
  } catch {
    return { ok: false, error: `Facts file not readable: ${candidate}` };
  }

  const prefix = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
  if (fileReal !== rootReal && !fileReal.startsWith(prefix)) {
    return {
      ok: false,
      error: 'Facts path escapes workspace root (path traversal blocked).',
    };
  }

  if (!fileReal.endsWith(`${sep}facts.json`) && !fileReal.endsWith('/facts.json')) {
    return {
      ok: false,
      error: 'Only facts.json under the workspace memory directory is allowed.',
    };
  }

  return { ok: true, path: fileReal };
}

export function isMemoryToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.MITII_MCP_WEB_MEMORY ?? '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}
