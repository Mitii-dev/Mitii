import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { RepositoryStateDescriptor, WorkspaceSnapshot } from '@mitii/v8';
import {
  WORKSPACE_WALK_SKIP_DIR_NAMES,
  shouldSkipWorkspaceWalkFile,
} from '../internal/workspaceWalk.js';
import { resolveDefaultContextRootId } from './hostContextReferences.js';
import { MAX_REPO_MAP_FILES } from './hostInjectionLimits.js';

const MAX_WORKSPACE_SNAPSHOT_FILES = 10_000;
const HEX_SNAPSHOT_ID = /^[a-f0-9]{64}$/;

export async function buildHostWorkspaceSnapshot(
  workspaceRoot: string,
  descriptor: RepositoryStateDescriptor,
): Promise<WorkspaceSnapshot> {
  const files: Array<{ relativePath: string; size: number; depth: number }> =
    [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (truncated) return;
      if (WORKSPACE_WALK_SKIP_DIR_NAMES.has(name)) continue;
      const full = join(dir, name);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!info.isFile()) continue;
      const relativePath = relative(workspaceRoot, full).replace(/\\/g, '/');
      if (!relativePath || relativePath.startsWith('..')) continue;
      if (shouldSkipWorkspaceWalkFile(relativePath, name)) continue;
      files.push({
        relativePath,
        size: info.size,
        depth: relativePath.split('/').length,
      });
      if (files.length >= MAX_WORKSPACE_SNAPSHOT_FILES) {
        truncated = true;
        return;
      }
    }
  }

  await walk(workspaceRoot);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const snapshotId = HEX_SNAPSHOT_ID.test(descriptor.snapshotId)
    ? descriptor.snapshotId
    : createFallbackSnapshotId(descriptor, files);

  // Pin to the published descriptor id when it is a schema-valid artifact id.
  // Entries must use the same rootId as indexed retrieval candidates, or
  // WorkspaceFileContextSource drops every hit as content_not_found.
  const rootId = resolveDefaultContextRootId(descriptor);
  return {
    schemaVersion: 1 as const,
    snapshotId,
    roots: [
      {
        id: rootId,
        name: rootId,
        kind: 'directory' as const,
        providerPath: workspaceRoot,
      },
    ],
    entries: files.map((f) => ({
      kind: 'file' as const,
      rootId,
      relativePath: f.relativePath,
      providerPath: join(workspaceRoot, f.relativePath),
      depth: f.depth,
      size: f.size,
    })),
    warnings: [],
    statistics: {
      files: files.length,
      directories: 0,
      symbolicLinks: 0,
      otherEntries: 0,
      ignoredEntries: 0,
      warnings: 0,
      durationMs: 0,
    },
    limits: {
      maximumDepth: 32,
      maximumFiles: MAX_REPO_MAP_FILES,
      maximumDirectories: 2_000,
      timeoutMs: 30_000,
      followSymbolicLinks: false,
    },
    status: truncated ? 'partial' : 'complete',
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  } satisfies WorkspaceSnapshot;
}

function createFallbackSnapshotId(
  descriptor: RepositoryStateDescriptor,
  files: Array<{ relativePath: string; size: number; depth: number }>,
): string {
  const payload = [
    descriptor.workspaceId,
    descriptor.snapshotId,
    ...files.map((file) => `${file.relativePath}:${file.size}:${file.depth}`),
  ].join('\n');
  return createHash('sha256').update(payload).digest('hex');
}
