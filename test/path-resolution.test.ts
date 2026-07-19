import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join as pathJoin } from 'path';
import { IgnoreService } from '../src/features/ce/indexing/IgnoreService';
import { ThunderDb } from '../src/features/ce/indexing/ThunderDb';
import { MigrationRunner } from '../src/features/ce/indexing/migrations';
import { createWorkspacePathResolver } from '../src/features/ce/paths/WorkspacePathResolver';
import { ProjectRulesContextSource, ProjectRulesService } from '../src/features/ce/rules/ProjectRulesService';
import { installBundledRules } from '../src/features/ce/rules/installBundledRules';
import { BUNDLED_DEFAULT_RULES } from '../src/features/ce/rules/bundledDefaultRules';

describe('WorkspacePathResolver', () => {
  it('auto-resolves folder/file layout when a flat path is requested', () => {
    const tempDir = mkdtempSync(pathJoin(tmpdir(), 'mitii-path-resolve-'));
    try {
      const target = pathJoin(
        tempDir,
        'packages/formik-form-builder/src/fields/field-slider/field-slider.tsx'
      );
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'export const FieldSlider = () => null;\n');

      const resolver = createWorkspacePathResolver({ workspace: tempDir });
      const result = resolver.resolve(
        'packages/formik-form-builder/src/fields/field-slider.tsx'
      );

      expect(result.autoResolved).toBe(true);
      expect(result.resolvedPath).toBe(
        'packages/formik-form-builder/src/fields/field-slider/field-slider.tsx'
      );
      expect(result.confidence).toBe('high');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the SQLite files index when present', () => {
    const tempDir = mkdtempSync(pathJoin(tmpdir(), 'mitii-path-resolve-db-'));
    const dbPath = pathJoin(tempDir, '.mitii', 'mitii.sqlite');
    let db: ThunderDb | undefined;
    try {
      const target = pathJoin(tempDir, 'packages/ffb-mui/src/fields/field-slider/field-slider.tsx');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'export const FieldSlider = () => null;\n');

      mkdirSync(dirname(dbPath), { recursive: true });
      db = new ThunderDb(dbPath);
      db.open();
      new MigrationRunner(db).run();
      db.raw
        .prepare(
          `INSERT INTO files (workspace, path, rel_path, hash, size, mtime, language, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          tempDir,
          target,
          'packages/ffb-mui/src/fields/field-slider/field-slider.tsx',
          'hash',
          10,
          Date.now(),
          'typescript',
          Date.now()
        );

      const resolver = createWorkspacePathResolver({ workspace: tempDir, db });
      const result = resolver.resolve('packages/ffb-mui/src/fields/field-slider.tsx');

      expect(result.autoResolved).toBe(true);
      expect(result.resolvedPath).toBe('packages/ffb-mui/src/fields/field-slider/field-slider.tsx');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NODE_MODULE_VERSION') || message.includes('better_sqlite3')) {
        return;
      }
      throw error;
    } finally {
      db?.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('read_file path auto-resolution', () => {
  it('reads the resolved file and prefixes the output', async () => {
    const tempDir = mkdtempSync(pathJoin(tmpdir(), 'mitii-read-auto-resolve-'));
    try {
      const target = pathJoin(
        tempDir,
        'packages/formik-form-builder/src/fields/field-slider/field-slider.tsx'
      );
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'export const FieldSlider = () => null;\n');

      const { createReadFileTool } = await import('../src/features/ce/tools/builtinTools');
      const ig = new IgnoreService();
      ig.load(tempDir);

      const result = await createReadFileTool(tempDir, ig).execute({
        path: 'packages/formik-form-builder/src/fields/field-slider.tsx',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('[Path auto-resolved]');
      expect(result.output).toContain('field-slider/field-slider.tsx');
      expect(result.output).toContain('export const FieldSlider');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('bundled path-resolution rules', () => {
  it('injects default rules into ProjectRulesService.load()', () => {
    const tempDir = mkdtempSync(pathJoin(tmpdir(), 'mitii-bundled-rules-'));
    try {
      const rules = new ProjectRulesService(tempDir).load();
      expect(rules[0]?.relPath).toBe('mitii:defaults/path-resolution');
      expect(rules[0]?.content).toContain('propose_file_scope');
      expect(rules[0]?.content).toContain('resolve_path');
      expect(BUNDLED_DEFAULT_RULES).toContain('fields/field-slider/field-slider.tsx');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps bundled markdown and TypeScript fallback rules in sync', () => {
    const markdown = readFileSync(
      pathJoin(process.cwd(), 'src/features/ce/rules/bundled/path-resolution.md'),
      'utf8'
    );
    expect(BUNDLED_DEFAULT_RULES.trim()).toBe(markdown.trim());
  });

  it('installs bundled rules into .mitii/rules on scaffold', () => {
    const tempDir = mkdtempSync(pathJoin(tmpdir(), 'mitii-install-rules-'));
    const extensionRoot = pathJoin(tempDir, 'extension');
    const bundledDir = pathJoin(extensionRoot, 'src', 'core', 'rules', 'bundled');
    try {
      mkdirSync(bundledDir, { recursive: true });
      writeFileSync(pathJoin(bundledDir, 'path-resolution.md'), BUNDLED_DEFAULT_RULES);

      const workspace = pathJoin(tempDir, 'workspace');
      mkdirSync(workspace, { recursive: true });

      const result = installBundledRules(workspace, extensionRoot);
      expect(result.installed).toContain('path-resolution.md');
      expect(existsSync(pathJoin(workspace, '.mitii', 'rules', 'path-resolution.md'))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('prefers the editable on-disk path-resolution rule exactly once', () => {
    const tempDir = mkdtempSync(pathJoin(tmpdir(), 'mitii-path-rule-dedupe-'));
    try {
      const rulePath = pathJoin(tempDir, '.mitii', 'rules', 'path-resolution.md');
      mkdirSync(dirname(rulePath), { recursive: true });
      writeFileSync(rulePath, '# Custom path rule\n\nUse workspace scope.\n');

      const rules = new ProjectRulesService(tempDir).load();
      expect(rules.filter((rule) => rule.content.includes('path rule'))).toHaveLength(1);
      expect(rules.map((rule) => rule.relPath)).toEqual(['.mitii/rules/path-resolution.md']);
      expect(rules.some((rule) => rule.relPath === 'mitii:defaults/path-resolution')).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('caps project rules by per-file and total budgets', () => {
    const tempDir = mkdtempSync(pathJoin(tmpdir(), 'mitii-rule-budget-'));
    try {
      writeFileSync(pathJoin(tempDir, 'MITII.md'), `${'a'.repeat(5000)}\n`);
      writeFileSync(pathJoin(tempDir, 'AGENTS.md'), `${'b'.repeat(5000)}\n`);

      const rules = new ProjectRulesService(tempDir).load(1000, 2500);
      const totalChars = rules.reduce((sum, rule) => sum + rule.content.length, 0);
      expect(totalChars).toBeLessThanOrEqual(2500);
      expect(rules.every((rule) => rule.content.length <= 1000)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('honors tier policy budgets through ProjectRulesContextSource.retrieve()', async () => {
    const tempDir = mkdtempSync(pathJoin(tmpdir(), 'mitii-rule-source-budget-'));
    try {
      writeFileSync(pathJoin(tempDir, 'MITII.md'), `${'a'.repeat(5000)}\n`);
      writeFileSync(pathJoin(tempDir, 'AGENTS.md'), `${'b'.repeat(5000)}\n`);

      const source = new ProjectRulesContextSource(new ProjectRulesService(tempDir));
      const items = await source.retrieve({
        text: 'rules',
        tierPolicy: {
          skillInjection: 'none',
          maxSkillChars: 0,
          rulesMaxTotalChars: 1200,
          rulesMaxCharsPerFile: 600,
        },
      });
      const totalChars = items.reduce((sum, item) => sum + item.content.length, 0);
      expect(totalChars).toBeLessThanOrEqual(1200);
      expect(items.every((item) => item.content.length <= 600)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
