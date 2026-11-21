import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { repoRoot, toRepoPath, v8PackageRoot } from './support/v8Sources';

const ARCHITECTURE_DIR = join(v8PackageRoot, 'tests/architecture');
/** New architecture test files must stay well under the 600-line rule. */
const MAX_ARCHITECTURE_FILE_LINES = 600;

function readRootScripts(): Record<string, string> {
  return (
    JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    }
  ).scripts ?? {};
}

describe('v8 structure enforcement wiring', () => {
  it('delegates the 600-line rule to scripts/check-file-size.mjs', () => {
    expect(existsSync(join(repoRoot, 'scripts/check-file-size.mjs'))).toBe(true);
    const allowlist = JSON.parse(
      readFileSync(join(repoRoot, 'scripts/file-size-allowlist.json'), 'utf8'),
    ) as { limit: number; files: string[] };
    expect(allowlist.limit).toBe(600);
    expect(Array.isArray(allowlist.files)).toBe(true);
    expect(readRootScripts()['check:file-size']).toContain(
      'scripts/check-file-size.mjs',
    );
  });

  it('keeps architecture test files under the 600-line limit', () => {
    const offenders = readdirSync(ARCHITECTURE_DIR, { recursive: true })
      .map(String)
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => join(ARCHITECTURE_DIR, entry))
      .filter(
        (file) =>
          readFileSync(file, 'utf8').split(/\r?\n/).length >
          MAX_ARCHITECTURE_FILE_LINES,
      )
      .map(toRepoPath);
    expect(offenders).toEqual([]);
  });

  it('runs every architecture test through `pnpm run check:architecture`', () => {
    const script = readRootScripts()['check:architecture'] ?? '';
    expect(script).toContain('vitest run');
    expect(script).toContain('packages/v8/tests/architecture');
    expect(script).not.toContain('v8-module-boundaries.test.ts');
    expect(
      existsSync(join(ARCHITECTURE_DIR, 'v8-module-boundaries.test.ts')),
    ).toBe(false);
  });

  it('wires circular dependency detection into scripts and CI', () => {
    expect(readRootScripts()['check:circular-deps']).toContain(
      'check-circular-deps.mjs',
    );
    expect(existsSync(join(repoRoot, 'scripts/check-circular-deps.mjs'))).toBe(
      true,
    );
    const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('pnpm run check:circular-deps');
    expect(ci).toContain('pnpm run check:architecture');
    expect(ci).toContain('pnpm run check:file-size');
  });

  it('keeps shrinking baselines present and well-formed', () => {
    const baselines = join(ARCHITECTURE_DIR, 'baselines');
    for (const name of [
      'deep-import-baseline.json',
      'export-star-baseline.json',
      'module-cycle-baseline.json',
    ]) {
      expect(existsSync(join(baselines, name)), name).toBe(true);
      expect(() =>
        JSON.parse(readFileSync(join(baselines, name), 'utf8')),
      ).not.toThrow();
    }
  });
});
