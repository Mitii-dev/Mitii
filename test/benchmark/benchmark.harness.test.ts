import { describe, expect, it } from 'vitest';
// @ts-expect-error benchmark verifier ships as plain ESM
import { verifyTask } from '../../benchmark/verify.mjs';
import { resolveBundledSkillsRoot } from '../../src/core/skills/resolveBundledSkillsRoot';
import { listBundledSkillNames } from '../../src/core/skills/installBundledSkills';
import { buildHeadlessConfig } from '../../src/core/headless/HeadlessConfig';
import { headlessDiscoverFiles } from '../../src/core/headless/headlessDiscoverFiles';
import { IgnoreService } from '../../src/core/indexing/IgnoreService';
import { join } from 'path';

describe('benchmark verify rules', () => {
  it('checks stdout_contains and file_exists', () => {
    const fixture = join(process.cwd(), 'benchmark/fixtures/node-express');
    expect(verifyTask('stdout_contains:Echo:', {
      stdout: 'Echo: hello',
      stderr: '',
      exitCode: 0,
      cwd: fixture,
      packageRoot: process.cwd(),
      mode: 'ask',
    }).passed).toBe(true);

    expect(verifyTask('file_exists:src/index.js', {
      stdout: '',
      stderr: '',
      exitCode: 0,
      cwd: fixture,
      packageRoot: process.cwd(),
      mode: 'ask',
    }).passed).toBe(true);
  });

  it('validates json_path and jsonl_event', () => {
    expect(verifyTask('json_path:steps', {
      stdout: JSON.stringify({ steps: [{ id: 'a' }] }),
      stderr: '',
      exitCode: 0,
      cwd: process.cwd(),
      packageRoot: process.cwd(),
      mode: 'plan',
    }).passed).toBe(true);

    expect(verifyTask('jsonl_event:end', {
      stdout: ['{"type":"start"}', '{"type":"end"}'].join('\n'),
      stderr: '',
      exitCode: 0,
      cwd: process.cwd(),
      packageRoot: process.cwd(),
      mode: 'agent',
    }).passed).toBe(true);
  });
});

describe('core bundled skills', () => {
  it('resolves skills from src/core/skills/bundled', () => {
    const root = resolveBundledSkillsRoot(process.cwd());
    expect(root).toContain('src/core/skills/bundled');
    const names = listBundledSkillNames(process.cwd());
    expect(names).toContain('test-driven-development');
    expect(names).toContain('browser-testing-with-devtools');
  });
});

describe('headless config', () => {
  it('enables tools for real runtime and puppeteer toggle', () => {
    const config = buildHeadlessConfig({
      cwd: process.cwd(),
      runtime: 'real',
      enablePuppeteer: true,
    });
    expect(config.provider.supportsTools).toBe(true);
    expect(config.mcp.builtinServers.puppeteer).toBe(true);
  });
});

describe('fixture discovery', () => {
  it('discovers JS files in node-express fixture', () => {
    const fixture = join(process.cwd(), 'benchmark/fixtures/node-express');
    const ignore = new IgnoreService();
    ignore.load(fixture, { respectGitignore: true, respectThunderignore: true });
    const files = headlessDiscoverFiles(fixture, ignore, { hardSkipSizeBytes: 2_000_000 });
    const relPaths = files.map((f: { relPath: string }) => f.relPath);
    expect(relPaths).toContain('src/index.js');
    expect(relPaths).toContain('src/routes/users.js');
  });
});
