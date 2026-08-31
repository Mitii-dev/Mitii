import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  composeAgentPrompt,
  loadAgentFile,
  loadPromptFile,
  resolveAgentFilePath,
} from '../src/agentFile.js';
import { parseCliArgs } from '../src/cli.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('CLI automation flags', () => {
  it('parses --origin, --autonomy, --agent, --prompt-file', () => {
    const parsed = parseCliArgs([
      'node',
      'mitii',
      'ask',
      'cover this',
      '--origin',
      'automation',
      '--autonomy',
      'apply_and_pr',
      '--agent',
      'post-commit-cover',
      '--prompt-file',
      '/tmp/prompt.md',
      '--json',
    ]);
    expect(parsed.command).toBe('ask');
    expect(parsed.prompt).toBe('cover this');
    expect(parsed.origin).toBe('automation');
    expect(parsed.autonomyPreset).toBe('apply_and_pr');
    expect(parsed.agent).toBe('post-commit-cover');
    expect(parsed.promptFile).toBe('/tmp/prompt.md');
    expect(parsed.json).toBe(true);
  });

  it('rejects invalid --origin', () => {
    const parsed = parseCliArgs([
      'node',
      'mitii',
      'ask',
      'hi',
      '--origin',
      'bot',
    ]);
    expect(parsed.command).toBe('error');
    expect(parsed.errorMessage).toMatch(/--origin must be/);
  });
});

describe('agentFile', () => {
  it('loads .mitii/agents/<id>.md with frontmatter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-agent-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.mitii', 'agents'), { recursive: true });
    writeFileSync(
      join(dir, '.mitii', 'agents', 'post-commit-cover.md'),
      `---
name: post-commit-cover
mode: agent
origin: automation
autonomyPreset: apply_and_pr
---

Write tests for the latest commit.
`,
      'utf8',
    );

    expect(resolveAgentFilePath('post-commit-cover', dir)).toBe(
      join(dir, '.mitii', 'agents', 'post-commit-cover.md'),
    );
    const agent = loadAgentFile('post-commit-cover', dir);
    expect(agent.mode).toBe('agent');
    expect(agent.origin).toBe('automation');
    expect(agent.autonomyPreset).toBe('apply_and_pr');
    expect(agent.prompt).toContain('Write tests');
  });

  it('composes agent body with CLI prompt and prompt-file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-prompt-'));
    dirs.push(dir);
    const promptPath = join(dir, 'extra.txt');
    writeFileSync(promptPath, 'from file', 'utf8');
    const combined = composeAgentPrompt({
      cliPrompt: 'from cli',
      promptFileText: loadPromptFile(promptPath),
      agent: {
        id: 'x',
        path: '/tmp/x.md',
        prompt: 'agent body',
        frontmatter: {},
      },
    });
    expect(combined).toContain('agent body');
    expect(combined).toContain('from cli');
    expect(combined).toContain('from file');
  });
});
