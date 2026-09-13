import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { enrichFingerprintWithPersistedVectorProfile } from '@mitii/host';
import type { MitiiClient, PublishRepositoryStateInput } from '@mitii/sdk';

import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';

const INDEX_DB_FILE = 'repository-index.sqlite';
const LAST_STATE_FILE = 'last-repository-state.json';

export type RehydrateRepositoryStateResult =
  | {
      ok: true;
      source: 'last-repository-state' | 'fingerprint-pin';
      fileCount: number;
      indexMode?: 'full' | 'host_snapshot';
    }
  | { ok: false };

/**
 * Re-publish on-disk index metadata into a fresh InMemoryRepositoryStateStore
 * after client invalidate / Extension Host restart — without scanning or locking.
 */
export async function rehydrateRepositoryStateFromDisk(options: {
  client: MitiiClient;
  mitiiDir: string;
  workspaceRoot: string;
  workspaceId: string;
  channel?: { appendLine(line: string): void };
}): Promise<RehydrateRepositoryStateResult> {
  const sqlitePath = join(options.mitiiDir, INDEX_DB_FILE);
  if (!existsSync(sqlitePath)) {
    return { ok: false };
  }

  const statePath = join(options.mitiiDir, LAST_STATE_FILE);
  if (existsSync(statePath)) {
    try {
      const raw = JSON.parse(readFileSync(statePath, 'utf8')) as {
        schemaVersion?: number;
        snapshotId?: string;
        roots?: Array<{ vectorProfile?: string }>;
        scanCompleteness?: 'complete' | 'truncated' | 'unknown';
        reasons?: Array<{
          code: string;
          message: string;
          rootId?: string;
        }>;
        fileCount?: number;
        indexMode?: 'full' | 'host_snapshot';
      };
      const hasVectorProfile = raw.roots?.some(
        (root) =>
          typeof root.vectorProfile === 'string' && root.vectorProfile.trim(),
      );
      if (
        raw.schemaVersion === 1 &&
        typeof raw.snapshotId === 'string' &&
        Array.isArray(raw.roots) &&
        raw.roots.length > 0 &&
        hasVectorProfile
      ) {
        await options.client.publishRepositoryState({
          schemaVersion: 1,
          workspaceId: options.workspaceId,
          snapshotId: raw.snapshotId,
          roots: raw.roots as PublishRepositoryStateInput['roots'],
          scanCompleteness: raw.scanCompleteness ?? 'complete',
          reasons: (raw.reasons ?? []) as PublishRepositoryStateInput['reasons'],
          generatedAt: new Date().toISOString(),
        });
        const fileCount =
          typeof raw.fileCount === 'number' && Number.isFinite(raw.fileCount)
            ? raw.fileCount
            : raw.roots.length;
        options.channel?.appendLine(
          `[index] reused on-disk index via last-repository-state.json (${raw.roots.length} root(s); vector profile preserved)`,
        );
        return {
          ok: true,
          source: 'last-repository-state',
          fileCount,
          ...(raw.indexMode === 'full' || raw.indexMode === 'host_snapshot'
            ? { indexMode: raw.indexMode }
            : {}),
        };
      }
    } catch (error) {
      options.channel?.appendLine(
        `[index] last-repository-state.json unusable; falling back to fingerprint pin: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const snap = await buildWorkspaceSnapshot({
    workspaceRoot: options.workspaceRoot,
    workspaceId: options.workspaceId,
  });
  const candidate = enrichFingerprintWithPersistedVectorProfile(
    snap.candidate,
    options.mitiiDir,
  );
  await options.client.publishRepositoryState(candidate);
  options.channel?.appendLine(
    `[index] reused on-disk index at ${sqlitePath}; published fingerprint pin (${snap.fileCount} files)${
      candidate.roots.some(
        (root: { vectorProfile?: string }) => root.vectorProfile,
      )
        ? ' with persisted vector profile'
        : ''
    }`,
  );
  return {
    ok: true,
    source: 'fingerprint-pin',
    fileCount: snap.fileCount,
  };
}
