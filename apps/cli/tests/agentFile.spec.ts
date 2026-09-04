import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  composeAgentPrompt,
  loadAgentFile,
  loadImageAttachment,
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

  it('loads skills frontmatter as requiredSkillIds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-agent-skills-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.mitii', 'agents'), { recursive: true });
    writeFileSync(
      join(dir, '.mitii', 'agents', 'docs-agent.md'),
      `---
name: docs-agent
skills: module-doc-generator, planning-default
---

Generate docs.
`,
      'utf8',
    );

    const agent = loadAgentFile('docs-agent', dir);
    expect(agent.requiredSkillIds).toEqual([
      'module-doc-generator',
      'planning-default',
    ]);
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

  it('loads a png image as a base64 attachment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-image-'));
    dirs.push(dir);
    const imagePath = join(dir, 'shot.png');
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const attachment = loadImageAttachment(imagePath, dir);
    expect(attachment.mimeType).toBe('image/png');
    expect(attachment.name).toBe('shot.png');
    expect(Buffer.from(attachment.data, 'base64')).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('resolves a relative image path against cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-image-rel-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'shot.jpg'), Buffer.from([0xff, 0xd8]));

    const attachment = loadImageAttachment('shot.jpg', dir);
    expect(attachment.mimeType).toBe('image/jpeg');
  });

  it('rejects unsupported image extensions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-image-bad-'));
    dirs.push(dir);
    const filePath = join(dir, 'doc.pdf');
    writeFileSync(filePath, 'not an image');

    expect(() => loadImageAttachment(filePath, dir)).toThrow(
      /unsupported image type/,
    );
  });

  it('rejects a missing image file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-image-missing-'));
    dirs.push(dir);

    expect(() =>
      loadImageAttachment(join(dir, 'missing.png'), dir),
    ).toThrow(/cannot read image/);
  });
});
