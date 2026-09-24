/**
 * Local git post-commit hook installer tests.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  drainPendingGitHookEvents,
  getGitCommitHookStatus,
  installGitCommitHook,
  uninstallGitCommitHook,
} from '../src/engine/automations/gitCommitHook.js';

const dirs: string[] = [];
const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '.tmp-hooks',
);

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('gitCommitHook', () => {
  it('installs, reports status, and uninstalls with backup restore', () => {
    mkdirSync(fixtureRoot, { recursive: true });
    const root = mkdtempSync(join(fixtureRoot, 'repo-'));
    dirs.push(root);
    mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
    writeFileSync(
      join(root, '.git', 'hooks', 'post-commit'),
      '#!/bin/sh\necho old\n',
    );

    const installed = installGitCommitHook({
      workspaceRoot: root,
      eventsUrl: 'http://127.0.0.1:8787/events',
      webhookToken: 'tok',
    });
    expect(installed.installed).toBe(true);
    expect(installed.managedByMitii).toBe(true);
    expect(installed.eventsUrl).toBe('http://127.0.0.1:8787/events');

    const status = getGitCommitHookStatus(root);
    expect(status.managedByMitii).toBe(true);

    const removed = uninstallGitCommitHook(root);
    expect(removed.managedByMitii).toBe(false);
    expect(removed.installed).toBe(true); // backup restored
  });

  it('drains pending event files', () => {
    mkdirSync(fixtureRoot, { recursive: true });
    const root = mkdtempSync(join(fixtureRoot, 'repo-'));
    dirs.push(root);
    const pending = join(root, '.mitii', 'hooks', 'pending');
    mkdirSync(pending, { recursive: true });
    writeFileSync(
      join(pending, 'evt.json'),
      JSON.stringify({
        eventId: 'e1',
        eventType: 'git.commit.local',
        source: 'git-hook',
        payload: { sha: 'abc' },
      }),
    );
    const ingested: unknown[] = [];
    const result = drainPendingGitHookEvents({
      workspaceRoot: root,
      ingest: (event) => {
        ingested.push(event);
      },
    });
    expect(result.drained).toBe(1);
    expect(ingested).toHaveLength(1);
  });
});
