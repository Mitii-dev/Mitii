import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const root = process.cwd();

describe('eval task generator', () => {
  it('generates at least 500 tasks for standard profile', () => {
    execSync('node eval/scripts/generate-tasks.mjs --profile standard --output eval/tasks/generated-test', {
      cwd: root,
      stdio: 'pipe',
    });
    const manifest = JSON.parse(
      readFileSync(join(root, 'eval/tasks/generated-test/manifest.json'), 'utf8')
    );
    expect(manifest.actualCount).toBeGreaterThanOrEqual(500);
    expect(manifest.shards.length).toBeGreaterThan(0);
  });

  it('generates up to 1000 tasks for full profile', () => {
    execSync('node eval/scripts/generate-tasks.mjs --profile full --output eval/tasks/generated-test-full', {
      cwd: root,
      stdio: 'pipe',
    });
    const manifest = JSON.parse(
      readFileSync(join(root, 'eval/tasks/generated-test-full/manifest.json'), 'utf8')
    );
    expect(manifest.actualCount).toBeGreaterThanOrEqual(1000);
  });

  it('produces unique task ids', () => {
    const index = JSON.parse(
      readFileSync(join(root, 'eval/tasks/generated-test/index.json'), 'utf8')
    );
    const ids = new Set<string>();
    for (const shard of index.includes) {
      const tasks = JSON.parse(readFileSync(join(root, 'eval/tasks/generated-test', shard), 'utf8'));
      for (const task of tasks) {
        expect(ids.has(task.id)).toBe(false);
        ids.add(task.id);
      }
    }
  });
});

describe('eval packaging', () => {
  it('excludes eval and benchmark from VSIX', () => {
    const ignore = readFileSync(join(root, '.vscodeignore'), 'utf8');
    expect(ignore).toContain('eval/**');
    expect(ignore).toContain('benchmark/**');
  });
});

describe('eval preflight', () => {
  it('loads better-sqlite3 or reports ABI guidance', async () => {
    const { checkSqliteLoad } = await import('../../eval/scripts/preflight.mjs');
    const result = checkSqliteLoad();
    if (!result.ok) {
      expect(result.message).toMatch(/NODE_MODULE_VERSION|better-sqlite3/i);
    } else {
      expect(result.ok).toBe(true);
    }
  });
});

describe('eval runner dry-run', () => {
  it('loads generated tasks', () => {
    const out = execSync(
      'node eval/scripts/run-eval.mjs --dry-run --limit 5 --tasks eval/tasks/generated-test/index.json --no-ensure-ready',
      { cwd: root, encoding: 'utf8' }
    );
    expect(out).toContain('Dry run: 5 tasks');
  });
});
