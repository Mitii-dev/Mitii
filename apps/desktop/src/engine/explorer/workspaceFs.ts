/**
 * Safe workspace file tree + read/write for Desktop explorer.
 */

import {
  access,
  cp,
  mkdir,
  rename,
  rm,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

const SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
]);

export interface WorkspaceTreeEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
}

function assertInsideWorkspace(workspaceRoot: string, abs: string): string {
  const root = resolve(workspaceRoot);
  const target = resolve(abs);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(prefix)) {
    throw new Error('path_outside_workspace');
  }
  return target;
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

function toRel(workspaceRoot: string, abs: string): string {
  return relative(workspaceRoot, abs).split(sep).join('/') || basename(abs);
}

/** VS Code–style incremental naming: `a.ts` → `a copy.ts` → `a copy 2.ts`. */
async function uniqueChildPath(dirAbs: string, baseName: string): Promise<string> {
  const first = join(dirAbs, baseName);
  if (!(await pathExists(first))) return first;
  const ext = extname(baseName);
  const stem = basename(baseName, ext);
  for (let i = 0; i < 500; i += 1) {
    const name = i === 0 ? `${stem} copy${ext}` : `${stem} copy ${i + 1}${ext}`;
    const candidate = join(dirAbs, name);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error('name_collision');
}

function assertValidSegment(name: string): string {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed === '.' ||
    trimmed === '..'
  ) {
    throw new Error('invalid_name');
  }
  return trimmed;
}

export function toAbsoluteWorkspacePath(
  workspaceRoot: string,
  relPath: string,
): string {
  if (!relPath.trim()) return resolve(workspaceRoot);
  return assertInsideWorkspace(workspaceRoot, join(workspaceRoot, relPath));
}

export async function listWorkspaceDir(
  workspaceRoot: string,
  relPath = '',
): Promise<WorkspaceTreeEntry[]> {
  const abs = assertInsideWorkspace(
    workspaceRoot,
    relPath ? join(workspaceRoot, relPath) : workspaceRoot,
  );
  const entries = await readdir(abs, { withFileTypes: true });
  const out: WorkspaceTreeEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.mitii') {
      if (SKIP.has(entry.name)) continue;
      if (entry.name === '.env' || entry.name.startsWith('.env.')) continue;
    }
    if (SKIP.has(entry.name)) continue;
    const childAbs = join(abs, entry.name);
    const rel = relative(workspaceRoot, childAbs).split(sep).join('/');
    out.push({
      name: entry.name,
      path: rel || entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file',
    });
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out.slice(0, 400);
}

export async function readWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
  maxBytes = 512_000,
): Promise<{ path: string; content: string; truncated: boolean; size: number }> {
  if (!relPath.trim()) throw new Error('path_required');
  const abs = assertInsideWorkspace(workspaceRoot, join(workspaceRoot, relPath));
  const info = await stat(abs);
  if (!info.isFile()) throw new Error('not_a_file');
  const buf = await readFile(abs);
  const truncated = buf.byteLength > maxBytes;
  const slice = truncated ? buf.subarray(0, maxBytes) : buf;
  return {
    path: relative(workspaceRoot, abs).split(sep).join('/') || basename(abs),
    content: slice.toString('utf8'),
    truncated,
    size: info.size,
  };
}

export async function writeWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
  content: string,
): Promise<{ path: string; size: number }> {
  if (!relPath.trim()) throw new Error('path_required');
  if (typeof content !== 'string') throw new Error('content_required');
  if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('content_too_large');
  }
  const abs = assertInsideWorkspace(workspaceRoot, join(workspaceRoot, relPath));
  const info = await stat(abs);
  if (!info.isFile()) throw new Error('not_a_file');
  await writeFile(abs, content, 'utf8');
  const next = await stat(abs);
  return {
    path: relative(workspaceRoot, abs).split(sep).join('/') || basename(abs),
    size: next.size,
  };
}

export async function createWorkspaceFile(
  workspaceRoot: string,
  parentRel: string,
  name: string,
  content = '',
): Promise<{ path: string }> {
  const baseName = assertValidSegment(name);
  if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('content_too_large');
  }
  const parentAbs = assertInsideWorkspace(
    workspaceRoot,
    parentRel.trim() ? join(workspaceRoot, parentRel) : workspaceRoot,
  );
  const parentInfo = await stat(parentAbs);
  if (!parentInfo.isDirectory()) throw new Error('not_a_directory');
  const destAbs = assertInsideWorkspace(
    workspaceRoot,
    join(parentAbs, baseName),
  );
  if (await pathExists(destAbs)) throw new Error('already_exists');
  await mkdir(dirname(destAbs), { recursive: true });
  await writeFile(destAbs, content, { flag: 'wx' });
  return { path: toRel(workspaceRoot, destAbs) };
}

export async function createWorkspaceFolder(
  workspaceRoot: string,
  parentRel: string,
  name: string,
): Promise<{ path: string }> {
  const baseName = assertValidSegment(name);
  const parentAbs = assertInsideWorkspace(
    workspaceRoot,
    parentRel.trim() ? join(workspaceRoot, parentRel) : workspaceRoot,
  );
  const parentInfo = await stat(parentAbs);
  if (!parentInfo.isDirectory()) throw new Error('not_a_directory');
  const destAbs = assertInsideWorkspace(
    workspaceRoot,
    join(parentAbs, baseName),
  );
  if (await pathExists(destAbs)) throw new Error('already_exists');
  await mkdir(destAbs, { recursive: false });
  return { path: toRel(workspaceRoot, destAbs) };
}

export async function renameWorkspaceEntry(
  workspaceRoot: string,
  relPath: string,
  newName: string,
): Promise<{ path: string; previousPath: string }> {
  if (!relPath.trim()) throw new Error('path_required');
  const trimmed = assertValidSegment(newName);
  const abs = assertInsideWorkspace(workspaceRoot, join(workspaceRoot, relPath));
  if (resolve(abs) === resolve(workspaceRoot)) {
    throw new Error('cannot_rename_workspace_root');
  }
  const destAbs = assertInsideWorkspace(
    workspaceRoot,
    join(dirname(abs), trimmed),
  );
  if (await pathExists(destAbs)) throw new Error('already_exists');
  await rename(abs, destAbs);
  return {
    previousPath: toRel(workspaceRoot, abs),
    path: toRel(workspaceRoot, destAbs),
  };
}

export async function deleteWorkspaceEntries(
  workspaceRoot: string,
  relPaths: string[],
): Promise<{ deleted: string[] }> {
  const unique = [...new Set(relPaths.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) throw new Error('path_required');
  const deleted: string[] = [];
  for (const relPath of unique) {
    const abs = assertInsideWorkspace(
      workspaceRoot,
      join(workspaceRoot, relPath),
    );
    if (resolve(abs) === resolve(workspaceRoot)) {
      throw new Error('cannot_delete_workspace_root');
    }
    await rm(abs, { recursive: true, force: false });
    deleted.push(toRel(workspaceRoot, abs));
  }
  return { deleted };
}

function assertNotIntoSelf(srcAbs: string, destDirAbs: string): void {
  const src = resolve(srcAbs);
  const dest = resolve(destDirAbs);
  const prefix = src.endsWith(sep) ? src : src + sep;
  if (dest === src || dest.startsWith(prefix)) {
    throw new Error('invalid_destination');
  }
}

export async function copyWorkspaceEntries(
  workspaceRoot: string,
  sources: string[],
  destDirRel: string,
): Promise<{ results: Array<{ from: string; to: string }> }> {
  const unique = [...new Set(sources.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) throw new Error('path_required');
  const destDirAbs = assertInsideWorkspace(
    workspaceRoot,
    destDirRel.trim() ? join(workspaceRoot, destDirRel) : workspaceRoot,
  );
  const destInfo = await stat(destDirAbs);
  if (!destInfo.isDirectory()) throw new Error('not_a_directory');

  const results: Array<{ from: string; to: string }> = [];
  for (const relPath of unique) {
    const srcAbs = assertInsideWorkspace(
      workspaceRoot,
      join(workspaceRoot, relPath),
    );
    if (resolve(srcAbs) === resolve(workspaceRoot)) {
      throw new Error('cannot_copy_workspace_root');
    }
    assertNotIntoSelf(srcAbs, destDirAbs);
    const destAbs = await uniqueChildPath(destDirAbs, basename(srcAbs));
    assertInsideWorkspace(workspaceRoot, destAbs);
    await cp(srcAbs, destAbs, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    results.push({
      from: toRel(workspaceRoot, srcAbs),
      to: toRel(workspaceRoot, destAbs),
    });
  }
  return { results };
}

export async function moveWorkspaceEntries(
  workspaceRoot: string,
  sources: string[],
  destDirRel: string,
): Promise<{ results: Array<{ from: string; to: string }> }> {
  const unique = [...new Set(sources.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) throw new Error('path_required');
  const destDirAbs = assertInsideWorkspace(
    workspaceRoot,
    destDirRel.trim() ? join(workspaceRoot, destDirRel) : workspaceRoot,
  );
  const destInfo = await stat(destDirAbs);
  if (!destInfo.isDirectory()) throw new Error('not_a_directory');

  const results: Array<{ from: string; to: string }> = [];
  for (const relPath of unique) {
    const srcAbs = assertInsideWorkspace(
      workspaceRoot,
      join(workspaceRoot, relPath),
    );
    if (resolve(srcAbs) === resolve(workspaceRoot)) {
      throw new Error('cannot_move_workspace_root');
    }
    assertNotIntoSelf(srcAbs, destDirAbs);
    // Same-folder move with identical name is a no-op.
    if (resolve(dirname(srcAbs)) === resolve(destDirAbs)) {
      results.push({
        from: toRel(workspaceRoot, srcAbs),
        to: toRel(workspaceRoot, srcAbs),
      });
      continue;
    }
    const destAbs = await uniqueChildPath(destDirAbs, basename(srcAbs));
    assertInsideWorkspace(workspaceRoot, destAbs);
    await rename(srcAbs, destAbs);
    results.push({
      from: toRel(workspaceRoot, srcAbs),
      to: toRel(workspaceRoot, destAbs),
    });
  }
  return { results };
}

/** Lightweight path search for `@` composer mentions (VS Code–style). */
export type WorkspacePathSuggestion = {
  path: string;
  kind: 'file' | 'folder';
};

export async function searchWorkspacePaths(
  workspaceRoot: string,
  query: string,
  limit = 40,
): Promise<WorkspacePathSuggestion[]> {
  const needle = query.trim().toLowerCase();
  const matches: WorkspacePathSuggestion[] = [];
  const queue: string[] = [''];
  let visited = 0;
  const maxVisit = 4_000;

  while (queue.length > 0 && matches.length < limit && visited < maxVisit) {
    const dir = queue.shift()!;
    let entries: WorkspaceTreeEntry[];
    try {
      entries = await listWorkspaceDir(workspaceRoot, dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (entry.kind === 'dir') {
        queue.push(entry.path);
      }
      const hay = entry.path.toLowerCase();
      const name = entry.name.toLowerCase();
      if (
        !needle ||
        name.includes(needle) ||
        hay.includes(needle) ||
        hay.split('/').some((part) => part.startsWith(needle))
      ) {
        matches.push({
          path: entry.path,
          kind: entry.kind === 'dir' ? 'folder' : 'file',
        });
        if (matches.length >= limit) break;
      }
    }
  }

  matches.sort((a, b) => {
    const aName = a.path.split('/').pop() ?? a.path;
    const bName = b.path.split('/').pop() ?? b.path;
    const aStarts = needle && aName.toLowerCase().startsWith(needle) ? 0 : 1;
    const bStarts = needle && bName.toLowerCase().startsWith(needle) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.path.length - b.path.length || a.path.localeCompare(b.path);
  });
  return matches;
}
