import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  REPOSITORY_STATE_SCHEMA_VERSION,
  type PublishRepositoryStateInput,
} from '@mitii/v8';

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.mitii',
  '.cursor',
]);

export interface WorkspaceSnapshotOptions {
  workspaceRoot: string;
  workspaceId: string;
  maxFiles?: number;
}

export interface WorkspaceSnapshot {
  candidate: PublishRepositoryStateInput;
  fileCount: number;
  truncated: boolean;
}

/**
 * Host-side lightweight snapshot for Phase 15 index/status.
 * Full vector/code indexing remains behind Repository State adapters;
 * this publishes an authoritative pin-able state with honest capability status.
 */
export async function buildWorkspaceSnapshot(
  options: WorkspaceSnapshotOptions,
): Promise<WorkspaceSnapshot> {
  const maxFiles = options.maxFiles ?? 2_000;
  const entries: string[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (truncated) return;
      if (SKIP_DIR_NAMES.has(name)) continue;
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
      entries.push(
        `${relative(options.workspaceRoot, full)}:${info.size}:${Math.trunc(info.mtimeMs)}`,
      );
      if (entries.length >= maxFiles) {
        truncated = true;
        return;
      }
    }
  }

  await walk(options.workspaceRoot);
  entries.sort();
  const digest = createHash('sha256')
    .update(entries.join('\n'))
    .digest('hex');
  const rev = digest.slice(0, 16);
  const generatedAt = new Date().toISOString();

  const candidate: PublishRepositoryStateInput = {
    schemaVersion: REPOSITORY_STATE_SCHEMA_VERSION,
    workspaceId: options.workspaceId,
    snapshotId: `host_snap_${rev}`,
    scanCompleteness: truncated ? 'truncated' : 'complete',
    roots: [
      {
        rootId: 'workspace',
        projectCatalogRevision: `catalog_${rev}`,
        codeIndexRevision: `code_${rev}`,
        textIndexRevision: `text_${rev}`,
        capabilities: [
          {
            capability: 'catalog',
            status: 'degraded',
            reasonCode: 'capability_degraded',
          },
          {
            capability: 'codeIndex',
            status: 'unavailable',
            reasonCode: 'capability_unavailable',
          },
          {
            capability: 'textIndex',
            status: 'unavailable',
            reasonCode: 'capability_unavailable',
          },
        ],
      },
    ],
    reasons: [
      {
        code: truncated ? 'scan_truncated' : 'capability_degraded',
        message: truncated
          ? `Host snapshot truncated after ${maxFiles} files.`
          : `Host snapshot of ${entries.length} files (full vector/code index deferred).`,
        rootId: 'workspace',
      },
    ],
    generatedAt,
  };

  return {
    candidate,
    fileCount: entries.length,
    truncated,
  };
}
