import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSession, type RunSessionOptions } from '../src/commands/session.js';
import { runSlashCommand } from '../src/commands/replSlash.js';
import type { CliRuntime } from '../src/ports.js';
import type { SessionIo } from '../src/session.js';

function fakeRuntime(): CliRuntime {
  return {
    client: {} as CliRuntime['client'],
    ports: {
      runLlm: { capabilities: { contextWindowTokens: 8_192 } },
      providerLabel: 'echo',
      workspaceId: 'cli_workspace',
      defaultMode: 'ask',
    } as unknown as CliRuntime['ports'],
  };
}

function baseIo(): { io: SessionIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      writeStdout: (c) => void stdout.push(c),
      writeStderr: (c) => void stderr.push(c),
      prompt: async () => {
        throw new Error('base prompt must not be used inside a session');
      },
    },
  };
}

describe('mitii session REPL', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'mitii-cli-repl-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function start(
    lines: string[],
    overrides: Partial<RunSessionOptions>,
  ): { done: Promise<number>; stderr: string[]; stdout: string[] } {
    const input = new PassThrough();
    const { io, stdout, stderr } = baseIo();
    const done = runSession({
      cwd,
      forceEcho: true,
      io,
      input,
      output: new PassThrough(),
      terminal: false,
      ...overrides,
    });
    input.end(lines.length ? `${lines.join('\n')}\n` : '');
    return { done, stdout, stderr };
  }

  const okTurn = (): NonNullable<RunSessionOptions['runAskTurn']> =>
    vi.fn(async () => ({ code: 0, mode: 'ask' as const }));

  it('ignores empty and whitespace-only lines instead of exiting', async () => {
    const runAskTurn = okTurn();
    const createClient = vi.fn(async () => fakeRuntime());
    const { done } = start(['', '   ', '\t', 'hello', '/exit'], {
      runAskTurn,
      createClient,
    });
    expect(await done).toBe(0);
    expect(runAskTurn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runAskTurn).mock.calls[0]![0].prompt).toBe('hello');
  });

  it('builds the client once and reuses it for every turn', async () => {
    const runtime = fakeRuntime();
    const runAskTurn = okTurn();
    const createClient = vi.fn(async () => runtime);
    const { done } = start(['one', 'two', 'three'], {
      runAskTurn,
      createClient,
    });
    expect(await done).toBe(0); // EOF ends the session
    expect(createClient).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(runAskTurn).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [args] of calls) expect(args.runtime).toBe(runtime);
    expect(new Set(calls.map(([args]) => args.sessionId)).size).toBe(1);
  });

  it('does not build a client when no prompt is sent', async () => {
    const createClient = vi.fn(async () => fakeRuntime());
    const { done } = start(['/help', '/quit'], {
      runAskTurn: okTurn(),
      createClient,
    });
    expect(await done).toBe(0);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('serves approvals from the same reader as the REPL prompt', async () => {
    const answers: string[] = [];
    const runAskTurn: NonNullable<RunSessionOptions['runAskTurn']> = vi.fn(
      async (options) => {
        if (options.prompt === 'do it') {
          answers.push(await options.io!.prompt('Approve edit? [y/N] '));
        }
        return { code: 0, mode: 'ask' as const };
      },
    );
    const { done } = start(['do it', 'y', 'next', '/exit'], {
      runAskTurn,
      createClient: async () => fakeRuntime(),
    });
    expect(await done).toBe(0);
    expect(answers).toEqual(['y']);
    const prompts = vi
      .mocked(runAskTurn)
      .mock.calls.map(([args]) => args.prompt);
    expect(prompts).toEqual(['do it', 'next']);
  });

  it('/clear starts a fresh thread without ending the session', async () => {
    const runAskTurn = okTurn();
    const { done, stderr } = start(['a', '/clear', 'b'], {
      runAskTurn,
      createClient: async () => fakeRuntime(),
    });
    expect(await done).toBe(0);
    const calls = vi.mocked(runAskTurn).mock.calls.map(([args]) => args);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.sessionId).not.toBe(calls[1]!.sessionId);
    expect(calls[1]!.conversation).toEqual([]);
    expect(stderr.join('')).toContain('conversation cleared');
  });

  it('reports unknown slash commands without calling the agent', async () => {
    const runAskTurn = okTurn();
    const { done, stderr } = start(['/nope', '/exit'], {
      runAskTurn,
      createClient: async () => fakeRuntime(),
    });
    expect(await done).toBe(0);
    expect(runAskTurn).not.toHaveBeenCalled();
    expect(stderr.join('')).toContain('unknown command /nope');
  });
});

describe('runSlashCommand', () => {
  const io = (): { io: SessionIo; out: string[] } => {
    const out: string[] = [];
    return {
      out,
      io: {
        writeStdout: (c) => void out.push(c),
        writeStderr: (c) => void out.push(c),
        prompt: async () => '',
      },
    };
  };

  it('maps exit aliases and help', () => {
    const { io: sessionIo, out } = io();
    expect(runSlashCommand('/exit', sessionIo)).toBe('exit');
    expect(runSlashCommand('/QUIT', sessionIo)).toBe('exit');
    expect(runSlashCommand('/help', sessionIo)).toBe('continue');
    expect(out.join('')).toContain('/exit, /quit');
  });

  it('leaves normal prompts and absolute paths for the agent', () => {
    const { io: sessionIo } = io();
    expect(runSlashCommand('explain this', sessionIo)).toBeUndefined();
    expect(runSlashCommand('/usr/bin/env is what?', sessionIo)).toBeUndefined();
  });
});
