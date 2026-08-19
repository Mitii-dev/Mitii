import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  INDEX_LOCK_STALE_MS,
  IndexLockedError,
  acquireIndexLock,
} from './indexLock.js';

describe('index lock', () => {
  it('rejects a second live lock and steals a stale one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mitii-index-lock-'));
    await mkdir(dir, { recursive: true });

    try {
      const first = acquireIndexLock(dir, { now: 1_000 });
      expect(() => acquireIndexLock(dir, { now: 2_000 })).toThrow(IndexLockedError);
      first.release();

      const fresh = acquireIndexLock(dir, { now: 3_000 });
      fresh.release();

      await writeFile(
        join(dir, 'index.lock'),
        `${JSON.stringify({ pid: 1, startedAt: 1 })}\n`,
        'utf8',
      );
      const stolen = acquireIndexLock(dir, {
        now: 1 + INDEX_LOCK_STALE_MS + 1,
      });
      stolen.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
