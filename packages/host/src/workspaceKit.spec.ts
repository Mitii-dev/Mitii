import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { createWorkspaceMemoryStore } from './ports/memoryStore.js';
import { loadProjectRules } from './prompt/projectRules.js';
import { buildWorkspaceSnapshot } from './indexing/fingerprintSnapshot.js';

describe('host durable workspace kit', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mitii-host-kit-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips memory facts across store instances', async () => {
    const workspaceId = 'cli_workspace_test';
    const store = createWorkspaceMemoryStore(root, workspaceId);
    await store.commit({
      id: 'fact_1',
      content: 'Prefer pnpm in this repo.',
      scope: { kind: 'workspace', workspaceId },
      tags: ['tooling'],
      privacy: 'shareable',
      createdAt: new Date().toISOString(),
      source: 'user',
    });

    const reloaded = createWorkspaceMemoryStore(root, workspaceId);
    const facts = await reloaded.query({
      scope: { kind: 'workspace', workspaceId },
      query: 'pnpm',
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.content).toContain('pnpm');

    const raw = await readFile(
      join(root, '.mitii', 'memory', 'facts.json'),
      'utf8',
    );
    expect(raw).toContain('Prefer pnpm');
  });

  it('loads AGENTS.md, .mitii/rules, and MITTII.local.md as project rules', async () => {
    await writeFile(join(root, 'AGENTS.md'), '# Agents\nUse small diffs.', 'utf8');
    await mkdir(join(root, '.mitii', 'rules'), { recursive: true });
    await writeFile(
      join(root, '.mitii', 'rules', 'testing.md'),
      'Always add a regression test.',
      'utf8',
    );
    await writeFile(
      join(root, 'MITTII.local.md'),
      'Personal: prefer concise answers.',
      'utf8',
    );

    const rules = await loadProjectRules({ workspaceRoot: root });
    expect(rules.map((rule) => rule.id)).toEqual([
      'agents-md',
      'mitii-rule:testing',
      'mitii-local',
    ]);
    expect(rules[0]?.content).toContain('small diffs');
    expect(rules[2]?.content).toContain('concise answers');
  });

  it('publishes fingerprint snapshot with unavailable index capabilities', async () => {
    await writeFile(join(root, 'README.md'), 'hello', 'utf8');
    const snapshot = await buildWorkspaceSnapshot({
      workspaceRoot: root,
      workspaceId: 'ws_1',
    });
    expect(snapshot.fileCount).toBeGreaterThan(0);
    const caps = snapshot.candidate.roots[0]?.capabilities ?? [];
    expect(caps.find((c) => c.capability === 'vectorIndex')?.status).toBe(
      'unavailable',
    );
    expect(snapshot.candidate.reasons?.[0]?.message).toContain(
      'Fingerprint-only',
    );
    expect(snapshot.candidate.reasons?.[0]?.message).not.toContain(
      'full vector/code index deferred',
    );
  });
});
