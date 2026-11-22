import { describe, expect, it } from 'vitest';

import type { GitPort } from '@mitii/v8';

import { loadHistoricalCouplingFromGit } from './loadHistoricalCoupling.js';

describe('loadHistoricalCouplingFromGit', () => {
  it('aggregates co-changed paths from name-only log entries', async () => {
    const git: GitPort = {
      status: async () => ({ staged: [], unstaged: [], untracked: [], raw: '' }),
      diff: async () => ({ diff: '', truncated: false }),
      log: async () => ({
        entries: [
          {
            hash: 'a',
            subject: 'one',
            files: ['src/core.ts', 'src/client.ts', 'src/other.ts'],
          },
          {
            hash: 'b',
            subject: 'two',
            files: ['src/core.ts', 'src/client.ts'],
          },
          {
            hash: 'c',
            subject: 'three',
            files: ['src/core.ts', 'README.md'],
          },
        ],
        truncated: false,
      }),
    };

    const coupling = await loadHistoricalCouplingFromGit({
      workspaceRoot: '/tmp/ws',
      relativePath: 'src/core.ts',
      git,
    });

    expect(coupling[0]).toMatchObject({
      relativePath: 'src/client.ts',
      coChangeCount: 2,
    });
    expect(coupling.some((entry) => entry.relativePath === 'src/core.ts')).toBe(
      false,
    );
  });

  it('returns empty when git.log is missing', async () => {
    const git: GitPort = {
      status: async () => ({ staged: [], unstaged: [], untracked: [], raw: '' }),
      diff: async () => ({ diff: '', truncated: false }),
    };
    const coupling = await loadHistoricalCouplingFromGit({
      workspaceRoot: '/tmp/ws',
      relativePath: 'src/core.ts',
      git,
    });
    expect(coupling).toEqual([]);
  });
});
