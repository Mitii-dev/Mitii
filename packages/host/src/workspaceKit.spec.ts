import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { MemoryPipeline, MEMORY_SCHEMA_VERSION } from '@mitii/v8';

import { observeWorkspaceEvent } from './ports/memoryCapture.js';
import { evictOldestObservations } from './ports/memoryObservations.js';
import { createWorkspaceMemoryStore } from './ports/memoryStore.js';
import { shouldObserveRunEvent } from './ports/observeRunEvent.js';
import { resolveMemoryEmbeddingPort } from './ports/resolveMemoryEmbedding.js';
import { loadProjectRules } from './prompt/projectRules.js';
import {
  buildWorkspaceSnapshot,
  resolveFingerprintRootId,
} from './indexing/fingerprintSnapshot.js';

describe('host durable workspace kit', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mitii-host-kit-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses the workspace directory name as fingerprint rootId', () => {
    expect(resolveFingerprintRootId('/Users/dev/ffb')).toBe('ffb');
    expect(resolveFingerprintRootId('/Users/dev/ffb/')).toBe('ffb');
    expect(resolveFingerprintRootId('/')).toBe('workspace');
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
    expect(raw).toContain('"storageVersion": 2');
  });

  it('promotes preference-like tool observations and audits the write', async () => {
    const workspaceId = 'cli_workspace_test';
    const store = createWorkspaceMemoryStore(root, workspaceId);
    const pipeline = new MemoryPipeline({ store });

    const first = await observeWorkspaceEvent({
      workspaceRoot: root,
      workspaceId,
      pipeline,
      toolName: 'edit',
      hookType: 'post_tool',
      userPrompt: 'Always use the shared Button component.',
      toolInput: { filePath: 'src/ui/Button.tsx' },
    });
    const duplicate = await observeWorkspaceEvent({
      workspaceRoot: root,
      workspaceId,
      pipeline,
      toolName: 'edit',
      hookType: 'post_tool',
      userPrompt: 'Always use the shared Button component.',
      toolInput: { filePath: 'src/ui/Button.tsx' },
    });

    expect(first.duplicate).toBe(false);
    expect(first.promotedMemoryId).toBeDefined();
    expect(duplicate.duplicate).toBe(true);

    const retrieved = await pipeline.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query: 'button component preference',
      scope: { kind: 'workspace', workspaceId },
    });
    expect(retrieved.instructions.some((block) =>
      block.content.includes('shared Button'),
    )).toBe(true);

    const audit = await readFile(
      join(root, '.mitii', 'memory', 'audit.jsonl'),
      'utf8',
    );
    expect(audit).toContain('synthetic_promote');
  });

  it('evicts the oldest observations when over the cap', () => {
    const result = evictOldestObservations(
      [
        {
          id: 'o1',
          createdAt: '2026-01-01T00:00:00.000Z',
          content: 'old',
          files: [],
          hash: 'a',
        },
        {
          id: 'o2',
          createdAt: '2026-02-01T00:00:00.000Z',
          content: 'new',
          files: [],
          hash: 'b',
        },
      ],
      1,
    );
    expect(result.evictedIds).toEqual(['o1']);
    expect(result.kept.map((item) => item.id)).toEqual(['o2']);
  });

  it('observes mutating and failed tools only', () => {
    expect(
      shouldObserveRunEvent({
        type: 'tool_completed',
        toolName: 'apply_patch',
        status: 'succeeded',
      }),
    ).toBe(true);
    expect(
      shouldObserveRunEvent({
        type: 'tool_completed',
        toolName: 'read_file',
        status: 'failed',
      }),
    ).toBe(true);
    expect(
      shouldObserveRunEvent({
        type: 'tool_completed',
        toolName: 'read_file',
        status: 'succeeded',
      }),
    ).toBe(false);
    expect(
      shouldObserveRunEvent({
        type: 'tool_started',
        toolName: 'apply_patch',
      }),
    ).toBe(false);
  });

  it('resolves a hashed memory embedding when semantic index is off', async () => {
    const port = resolveMemoryEmbeddingPort({
      enabled: false,
      source: 'disabled',
      backend: 'disabled',
      baseUrl: 'http://localhost',
      model: '',
      dimensions: 384,
      normalized: true,
    });
    const vector = await port.embed('pnpm package scripts');
    expect(vector.length).toBeGreaterThan(0);
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
    expect(snapshot.candidate.roots[0]?.rootId).toBe(root.split(/[\\/]/).pop());
  });
});
