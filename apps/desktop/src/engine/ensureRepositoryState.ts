/**
 * Ensure Desktop has a pin-able repository state (host snapshot fallback).
 * Mirrors CLI ensurePublishedRepositoryState without requiring a full index.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildWorkspaceSnapshot } from '@mitii/host';
import type { MitiiClient, PublishRepositoryStateInput } from '@mitii/sdk';

export async function ensureDesktopRepositoryState(options: {
  client: MitiiClient;
  workspaceRoot: string;
  workspaceId: string;
}): Promise<'existing' | 'rehydrated' | 'host_snapshot'> {
  const latest = await options.client.getLatestRepositoryState(
    options.workspaceId,
  );
  if (latest) return 'existing';

  const statePath = join(
    options.workspaceRoot,
    '.mitii',
    'last-repository-state.json',
  );
  if (existsSync(statePath)) {
    try {
      const raw = JSON.parse(readFileSync(statePath, 'utf8')) as {
        schemaVersion?: number;
        snapshotId?: string;
        roots?: PublishRepositoryStateInput['roots'];
        scanCompleteness?: PublishRepositoryStateInput['scanCompleteness'];
        reasons?: PublishRepositoryStateInput['reasons'];
      };
      if (
        raw.schemaVersion === 1 &&
        typeof raw.snapshotId === 'string' &&
        Array.isArray(raw.roots) &&
        raw.roots.length > 0
      ) {
        const published = await options.client.publishRepositoryState({
          schemaVersion: 1,
          workspaceId: options.workspaceId,
          snapshotId: raw.snapshotId,
          roots: raw.roots,
          scanCompleteness: raw.scanCompleteness ?? 'complete',
          reasons: raw.reasons ?? [],
          generatedAt: new Date().toISOString(),
        });
        if (published.status === 'published') return 'rehydrated';
      }
    } catch {
      // fall through to host snapshot
    }
  }

  const snapshot = await buildWorkspaceSnapshot({
    workspaceRoot: options.workspaceRoot,
    workspaceId: options.workspaceId,
  });
  await options.client.publishRepositoryState(snapshot.candidate);
  return 'host_snapshot';
}
