import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorkspaceMemoryStore } from '@mitii/host';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_CLI_WORKSPACE_ID,
  resolveCliWorkspaceId,
} from '../src/config.js';
import {
  resolveMemoryWorkspaceId,
  runMemoryCommand,
} from '../src/commands/memory.js';
import { resolveCliPorts } from '../src/ports.js';
import type { SessionIo } from '../src/session.js';

function io(): { io: SessionIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      writeStdout: (c) => void out.push(c),
      writeStderr: (c) => void err.push(c),
      prompt: async () => '',
    },
  };
}

function writeConfig(cwd: string, config: Record<string, unknown>): void {
  mkdirSync(join(cwd, '.mitii'), { recursive: true });
  writeFileSync(join(cwd, '.mitii', 'config.json'), JSON.stringify(config));
}

describe('CLI memory workspace id', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'mitii-cli-memory-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('defaults to the same id agent runs use', () => {
    expect(resolveCliWorkspaceId({})).toBe(DEFAULT_CLI_WORKSPACE_ID);
    expect(DEFAULT_CLI_WORKSPACE_ID).toBe('cli_workspace');
    const runId = resolveCliPorts({ cwd, forceEcho: true }).workspaceId;
    expect(resolveMemoryWorkspaceId(cwd)).toBe(runId);
  });

  it('follows config.workspaceId for both run ports and memory command', () => {
    writeConfig(cwd, { workspaceId: 'team_ws' });
    const runId = resolveCliPorts({ cwd, forceEcho: true }).workspaceId;
    expect(runId).toBe('team_ws');
    expect(resolveMemoryWorkspaceId(cwd)).toBe('team_ws');
  });

  it('approve commits into the run workspace scope, not a hardcoded "cli"', async () => {
    const runWorkspaceId = resolveCliPorts({ cwd, forceEcho: true }).workspaceId;
    mkdirSync(join(cwd, '.mitii', 'memory'), { recursive: true });
    writeFileSync(
      join(cwd, '.mitii', 'memory', 'pending.json'),
      JSON.stringify({
        storageVersion: 1,
        pending: [
          {
            id: 'pend_1',
            createdAt: new Date().toISOString(),
            content: 'The CLI uses vitest for unit tests.',
            type: 'fact',
            title: 'CLI test runner',
            files: [],
            concepts: [],
            importance: 5,
          },
        ],
      }),
    );

    const { io: sessionIo, err } = io();
    const code = await runMemoryCommand({
      args: ['approve', 'pend_1'],
      cwd,
      io: sessionIo,
    });
    expect(err.join('')).toBe('');
    expect(code).toBe(0);

    const facts = await createWorkspaceMemoryStore(cwd, runWorkspaceId).list();
    expect(facts).toHaveLength(1);
    expect(facts[0]!.scope).toMatchObject({
      kind: 'workspace',
      workspaceId: runWorkspaceId,
    });
  });
});
