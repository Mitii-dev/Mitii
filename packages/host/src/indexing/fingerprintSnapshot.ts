import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  REPOSITORY_STATE_SCHEMA_VERSION,
  type PublishRepositoryStateInput,
  type WorkspaceSnapshot as V8WorkspaceSnapshot,
} from '@mitii/v8';

import { WORKSPACE_WALK_SKIP_DIR_NAMES } from '../internal/workspaceWalk.js';

export interface WorkspaceSnapshotOptions {
  workspaceRoot: string;
  workspaceId: string;
  maxFiles?: number;
}

export interface WorkspaceSnapshot {
  candidate: PublishRepositoryStateInput;
  fileCount: number;
  truncated: boolean;
  /** Sorted relative paths included in the fingerprint (for lightweight repo maps). */
  relativePaths: string[];
}

export function fingerprintWorkspaceIndexSnapshot(
  snapshot: V8WorkspaceSnapshot,
): string {
  // Snapshot IDs already hash root identity plus per-file size, mtime, and
  // contentHash when the scanner recorded one. That is enough to invalidate
  // incremental republish when files change without hashing every file twice.
  return snapshot.snapshotId;
}

/**
 * Fingerprint-only repository publish candidate for hosts.
 *
 * Honest about capability status: catalog degraded; code/text/vector indexes
 * unavailable until `runFullWorkspaceIndex` succeeds.
 *
 * Do not confuse this host result type (`WorkspaceSnapshot`) with V8's
 * indexing `WorkspaceSnapshot` artifact.
 */
export async function buildWorkspaceSnapshot(
  options: WorkspaceSnapshotOptions,
): Promise<WorkspaceSnapshot> {
  const maxFiles = options.maxFiles ?? 2_000;
  const entries: string[] = [];
  const relativePaths: string[] = [];
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
      const rel = relative(options.workspaceRoot, full).replace(/\\/g, '/');
      relativePaths.push(rel);
      entries.push(`${rel}:${info.size}:${Math.trunc(info.mtimeMs)}`);
      if (entries.length >= maxFiles) {
        truncated = true;
        return;
      }
    }
  }

  await walk(options.workspaceRoot);
  entries.sort();
  relativePaths.sort();
  const digest = createHash('sha256')
    .update(entries.join('\n'))
    .digest('hex');
  const rev = digest.slice(0, 16);
  const generatedAt = new Date().toISOString();

  const candidate: PublishRepositoryStateInput = {
    schemaVersion: REPOSITORY_STATE_SCHEMA_VERSION,
    workspaceId: options.workspaceId,
    snapshotId: digest,
    scanCompleteness: truncated ? 'truncated' : 'complete',
    roots: [
      {
        rootId: 'workspace',
        projectCatalogRevision: `catalog_${rev}`,
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
          {
            capability: 'vectorIndex',
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
          ? `Fingerprint snapshot truncated after ${maxFiles} files. codeIndex/textIndex/vectorIndex unavailable until full index runs.`
          : `Fingerprint-only snapshot of ${entries.length} files. catalog degraded; codeIndex/textIndex/vectorIndex unavailable (run full workspace index for FTS/symbols/vectors).`,
        rootId: 'workspace',
      },
    ],
    generatedAt,
  };

  return {
    candidate,
    fileCount: entries.length,
    truncated,
    relativePaths,
  };
}
