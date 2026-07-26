import { describe, it, expect, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { IgnoreService } from '../src/features/ce/indexing/IgnoreService';
import { ChunkingService } from '../src/features/ce/indexing/ChunkingService';
import { sanitizeFtsQuery } from '../src/features/ce/indexing/FtsIndex';
import { tsExtractor, pythonExtractor, extractSymbols } from '../src/features/ce/indexing/SymbolExtractor';
import {
  detectLanguageFromPath,
  getSupportedExtensionCount,
  getWasmLanguageIds,
  hasWasmGrammar,
} from '../src/features/ce/indexing/languageRegistry';
import { detectLanguage } from '../src/features/ce/indexing/fileUtils';
import { isDangerousCommand, isDeleteLikeCommand } from '../src/features/ce/safety/ToolPolicyEngine';
import { ToolPolicyEngine } from '../src/features/ce/safety/ToolPolicyEngine';
import { ContextBudgeter } from '../src/features/ce/context/ContextBudgeter';
import type { ContextItem } from '../src/features/ce/context/types';
import { defaultThunderConfig } from '../src/kernel/config/defaults';
import { estimateTokens } from '../src/kernel/llm/tokenEstimate';
import { UsageTrackingProvider } from '../src/features/ce/runtime/UsageTrackingProvider';
import { ProjectRulesService } from '../src/features/ce/rules/ProjectRulesService';
import type { ThunderPlan } from '../src/features/ce/plans/PlanActEngine';

describe('IgnoreService', () => {
  it('ignores node_modules by default', () => {
    const ig = new IgnoreService();
    ig.load('/tmp');
    expect(ig.isIgnored('node_modules/foo/bar.js')).toBe(true);
    expect(ig.isIgnored('src/index.ts')).toBe(false);
  });

  it('accepts root and dot-prefixed relative paths', () => {
    const ig = new IgnoreService();
    ig.load('/tmp');
    expect(ig.isIgnored('.')).toBe(false);
    expect(ig.isIgnored('./src/index.ts')).toBe(false);
    expect(ig.isIgnored('./node_modules/pkg/index.js')).toBe(true);
  });

  it('allows reading .mitii/logs/*.jsonl for debugging but keeps them out of the index', () => {
    const ig = new IgnoreService();
    ig.load('/tmp');
    expect(ig.isIgnored('.mitii/logs/2026-07-08_23-10-52-abc.jsonl', { forRead: true })).toBe(false);
    expect(ig.isIgnored('.mitii/logs', { forRead: true })).toBe(false);
    expect(ig.isIgnored('.mitii/logs/', { forRead: true })).toBe(false);
    expect(ig.isIgnored('.miti/logs/2026-07-08_23-10-52-abc.jsonl', { forRead: true })).toBe(false);
    expect(ig.isIgnored('.mitii/logs/2026-07-08_23-10-52-abc.jsonl')).toBe(true);
    expect(ig.isIgnored('.mitii/config.json', { forRead: true })).toBe(true);
    expect(ig.isIgnored('.mitii/logs/nested/other.jsonl', { forRead: true })).toBe(true);
  });

  it('list_files can recursively list .mitii/logs despite default .mitii ignore', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mitii-list-logs-'));
    try {
      const logsDir = join(tempDir, '.mitii', 'logs');
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(join(logsDir, 'session-a.jsonl'), '{"type":"session_start"}\n');
      writeFileSync(join(tempDir, '.mitii', 'config.json'), '{}');
      const ig = new IgnoreService();
      ig.load(tempDir);
      const { createListFilesTool } = await import('../src/features/ce/tools/builtinTools');
      const tool = createListFilesTool(tempDir, ig);
      const recursive = await tool.execute({ path: '.mitii', recursive: true });
      expect(recursive.success).toBe(true);
      expect(recursive.output).toContain('.mitii/logs/session-a.jsonl');
      expect(recursive.output).not.toContain('.mitii/config.json');
      const logsOnly = await tool.execute({ path: '.mitii/logs', recursive: true });
      expect(logsOnly.success).toBe(true);
      expect(logsOnly.output).toContain('.mitii/logs/session-a.jsonl');
      const nonRecursive = await tool.execute({ path: '.mitii', recursive: false });
      expect(nonRecursive.success).toBe(true);
      expect(nonRecursive.output.split('\n')).toContain('logs');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('execute_workspace_script reports unavailable read-only helpers as failures', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mitii-script-failure-'));
    try {
      const scriptsDir = join(tempDir, 'scripts');
      mkdirSync(scriptsDir, { recursive: true });
      writeFileSync(
        join(scriptsDir, 'script-catalog.json'),
        JSON.stringify([
          {
            id: 1,
            name: 'safe-lint-target.sh',
            category: 'validation',
            command: 'bash scripts/safe-lint-target.sh <target>',
            description: 'lint',
            readOnly: true,
          },
        ])
      );
      const scriptPath = join(scriptsDir, 'safe-lint-target.sh');
      writeFileSync(
        scriptPath,
        [
          '#!/usr/bin/env bash',
          'echo \'ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "eslint" not found\'',
          'exit 1',
        ].join('\n')
      );
      chmodSync(scriptPath, 0o755);
      mkdirSync(join(tempDir, 'src'));

      const ig = new IgnoreService();
      ig.load(tempDir);
      const { createExecuteWorkspaceScriptTool } = await import('../src/features/ce/tools/builtinTools');
      const tool = createExecuteWorkspaceScriptTool(tempDir, tempDir, ig);
      const result = await tool.execute({ script: 'safe-lint-target.sh', target: 'src' });

      expect(result.success).toBe(false);
      expect(result.output).toContain('Command "eslint" not found');
      expect(result.error).toContain('ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('policy allows list_files/read on session logs when forRead is wired', () => {
    const ig = new IgnoreService();
    ig.load('/tmp');
    const engine = new ToolPolicyEngine(
      defaultThunderConfig().safety,
      (path, options) => ig.isIgnored(path, options)
    );
    expect(engine.evaluate('list_files', { path: '.mitii/logs' }).decision).toBe('allow');
    expect(engine.evaluate('read_file', { path: '.mitii/logs/session.jsonl' }).decision).toBe('allow');
    expect(engine.evaluate('list_files', { path: '.miti/logs' }).decision).toBe('allow');
    expect(engine.evaluate('analyze_jsonl', { path: '.mitii/logs/session.jsonl' }).decision).toBe('allow');
    expect(engine.evaluate('analyze_jsonl', { path: '.miti/logs/session.jsonl' }).decision).toBe('allow');
    expect(engine.evaluate('analyze_jsonl', { path: 'logs/session.jsonl' }).decision).toBe('allow');
    expect(engine.evaluate('query_log_events', { path: '.mitii/logs/session.jsonl' }).decision).toBe('allow');
    expect(engine.evaluate('read_file', { path: '.mitii/config.json' }).decision).toBe('block');
    expect(engine.evaluate('mcp__filesystem__read_text_file', { path: '.mitii/logs/session.jsonl' }).decision).toBe('allow');
  });

  it('normalizes absolute workspace paths before ignore checks', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-ignore-absolute-test-'));
    try {
      const ig = new IgnoreService();
      ig.load(tempDir);
      expect(ig.isIgnored(join(tempDir, 'package.json'))).toBe(false);
      expect(ig.isIgnored(join(tempDir, 'node_modules/pkg/index.js'))).toBe(true);
      expect(ig.isIgnored(join(tmpdir(), 'outside.ts'))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('lists workspace root when path is "."', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-list-root-test-'));
    try {
      writeFileSync(join(tempDir, 'package.json'), '{}');
      mkdirSync(join(tempDir, 'node_modules'));
      const ig = new IgnoreService();
      ig.load(tempDir);
      const { createListFilesTool } = await import('../src/features/ce/tools/builtinTools');
      const result = await createListFilesTool(tempDir, ig).execute({ path: '.', recursive: false });
      expect(result.success).toBe(true);
      expect(result.output).toContain('package.json');
      expect(result.output).not.toContain('node_modules');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('write_file creates parent directories for new nested files', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-write-nested-test-'));
    try {
      const { createWriteFileTool } = await import('../src/features/ce/tools/builtinTools');
      const ig = new IgnoreService();
      ig.load(tempDir);
      const tool = createWriteFileTool(tempDir, ig);

      const result = await tool.execute({
        path: 'apps/docs/docs/ffb-mui/_category_.json',
        content: '{"label":"ffb-mui"}',
      });

      expect(result.success).toBe(true);
      expect(existsSync(join(tempDir, 'apps/docs/docs/ffb-mui/_category_.json'))).toBe(true);
      expect(readFileSync(join(tempDir, 'apps/docs/docs/ffb-mui/_category_.json'), 'utf8')).toContain('ffb-mui');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('read_file accepts absolute paths inside the workspace', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-read-absolute-test-'));
    try {
      const { createReadFileTool } = await import('../src/features/ce/tools/builtinTools');
      const ig = new IgnoreService();
      ig.load(tempDir);
      const absPath = join(tempDir, 'apps/docs/docs/ffb-mui/api/formik-renderer.md');
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, '# FormikRenderer\n');

      const result = await createReadFileTool(tempDir, ig).execute({ path: absPath });

      expect(result.success).toBe(true);
      expect(result.output).toContain('FormikRenderer');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('read_file returns a requested line slice with file line metadata', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-read-slice-test-'));
    try {
      const { createReadFileTool } = await import('../src/features/ce/tools/builtinTools');
      const ig = new IgnoreService();
      ig.load(tempDir);
      const relPath = 'src/sliced.ts';
      mkdirSync(dirname(join(tempDir, relPath)), { recursive: true });
      writeFileSync(join(tempDir, relPath), ['line 1', 'line 2', 'line 3', 'line 4'].join('\n'));

      const result = await createReadFileTool(tempDir, ig).execute({
        path: relPath,
        startLine: 2,
        endLine: 3,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('// lines 2-3 of 4');
      expect(result.output).toContain('line 2\nline 3');
      expect(result.output).not.toContain('line 1');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('propose_file_scope validates candidates and stores accepted scope', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-file-scope-test-'));
    try {
      const { createProposeFileScopeTool } = await import('../src/features/ce/tools/builtinTools');
      const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
      const ig = new IgnoreService();
      ig.load(tempDir);
      mkdirSync(join(tempDir, 'src'), { recursive: true });
      writeFileSync(join(tempDir, 'src/foo.ts'), 'export const foo = 1;\n');
      const state = new AgentTaskState();
      const tool = createProposeFileScopeTool(tempDir, ig, undefined, () => state);

      const result = await tool.execute({
        objective: 'inspect foo',
        candidates: [
          { path: 'src/foo.ts', reason: 'target file', intent: 'read' },
          { path: '../outside.ts', reason: 'invalid path', intent: 'read' },
        ],
        maxFilesRead: 2,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('src/foo.ts');
      expect(result.output).toContain('outside.ts');
      expect(state.isPathInScope('src/foo.ts')).toBe(true);
      expect(state.checkFileScopeBlocked('read_file', { path: 'src/foo.ts' })).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('propose_file_scope accepts access aliases and rejects missing read targets', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-file-scope-access-test-'));
    try {
      const { createProposeFileScopeTool } = await import('../src/features/ce/tools/builtinTools');
      const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
      const ig = new IgnoreService();
      ig.load(tempDir);
      mkdirSync(join(tempDir, 'src'), { recursive: true });
      writeFileSync(join(tempDir, 'src/foo.ts'), 'export const foo = 1;\n');
      const state = new AgentTaskState();
      const tool = createProposeFileScopeTool(tempDir, ig, undefined, () => state);

      const result = await tool.execute({
        objective: 'inspect and add files',
        candidates: [
          { path: 'src/foo.ts', access: 'read' },
          { path: 'src/missing.ts', access: 'read' },
          { path: 'src/new.ts', access: 'write' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('src/foo.ts');
      expect(result.output).toContain('src/new.ts');
      expect(result.output).toContain('src/missing.ts');
      expect(state.isPathInScope('src/foo.ts')).toBe(true);
      expect(state.isPathInScope('src/new.ts')).toBe(true);
      expect(state.isPathInScope('src/missing.ts')).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('propose_file_scope repairs common model argument variants', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-file-scope-coerce-test-'));
    try {
      const { createProposeFileScopeTool } = await import('../src/features/ce/tools/builtinTools');
      const ig = new IgnoreService();
      ig.load(tempDir);
      mkdirSync(join(tempDir, 'src'), { recursive: true });
      writeFileSync(join(tempDir, 'src/foo.ts'), 'export const foo = 1;\n');
      const tool = createProposeFileScopeTool(tempDir, ig);
      const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
      const runtime = new ToolRuntime();
      runtime.register(tool);

      const result = await runtime.execute('propose_file_scope', {
        objective: 'inspect routing and create a page',
        candidates: JSON.stringify([
          { path: 'src/foo.ts', intent: 'routing' },
          { path: 'src/new.ts', access: 'create' },
        ]),
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('"intent": "read"');
      expect(result.output).toContain('"intent": "write"');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('serves repeat file reads from cache across read_file and read_files', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-read-cache-test-'));
    const targetRelPath = 'src/cache-target.ts';
    const targetPath = join(tempDir, targetRelPath);
    try {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, 'export const cached = true;\n');

      vi.resetModules();
      const actualFsPromises = await vi.importActual<typeof import('fs/promises')>('fs/promises');
      const readFileSpy = vi.fn((...args: unknown[]) =>
        (actualFsPromises.readFile as (...innerArgs: unknown[]) => Promise<unknown>)(...args)
      );
      vi.doMock('fs/promises', async () => ({
        ...(await vi.importActual<typeof import('fs/promises')>('fs/promises')),
        readFile: readFileSpy,
      }));

      const { clearReadFileCache, createReadFileTool, createReadFilesTool } = await import('../src/features/ce/tools/builtinTools');
      clearReadFileCache(tempDir);
      const ig = new IgnoreService();
      ig.load(tempDir);

      const first = await createReadFileTool(tempDir, ig).execute({ path: targetRelPath });
      const second = await createReadFilesTool(tempDir, ig).execute({ paths: [targetRelPath] });

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(second.output).toContain('export const cached = true;');
      expect(readFileSpy.mock.calls.filter(([path]) => String(path) === targetPath)).toHaveLength(1);
    } finally {
      vi.doUnmock('fs/promises');
      vi.resetModules();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('list_files accepts absolute directories inside the workspace', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-list-absolute-test-'));
    try {
      const { createListFilesTool } = await import('../src/features/ce/tools/builtinTools');
      const ig = new IgnoreService();
      ig.load(tempDir);
      const absDir = join(tempDir, 'apps/docs/docs/ffb-mui/api');
      mkdirSync(absDir, { recursive: true });
      writeFileSync(join(absDir, 'formik-renderer.md'), '# FormikRenderer\n');

      const result = await createListFilesTool(tempDir, ig).execute({ path: absDir, recursive: false });

      expect(result.success).toBe(true);
      expect(result.output).toContain('formik-renderer.md');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects absolute paths outside the workspace', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-outside-workspace-test-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'thunder-outside-file-test-'));
    try {
      const { createReadFileTool } = await import('../src/features/ce/tools/builtinTools');
      const ig = new IgnoreService();
      ig.load(tempDir);
      const outsideFile = join(outsideDir, 'secret.ts');
      writeFileSync(outsideFile, 'export const secret = true;');

      const result = await createReadFileTool(tempDir, ig).execute({ path: outsideFile });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid (or ignored )?path/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('read_files recovers gracefully from batches over 12 paths', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-read-files-limit-test-'));
    try {
      const { createReadFilesTool } = await import('../src/features/ce/tools/builtinTools');
      const ig = new IgnoreService();
      ig.load(tempDir);
      for (let i = 1; i <= 13; i++) {
        writeFileSync(join(tempDir, `file-${i}.ts`), `export const n = ${i};`);
      }
      const tool = createReadFilesTool(tempDir, ig);

      const result = await tool.execute({
        paths: Array.from({ length: 13 }, (_, i) => `file-${i + 1}.ts`),
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('at most 12 paths');
      expect(result.output).toContain('file-13.ts');
      expect(result.output).toContain('### file-12.ts');
      expect(result.output).not.toContain('### file-13.ts');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('refuses to write shell commands into source files', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-write-guard-test-'));
    try {
      const ig = new IgnoreService();
      ig.load(tempDir);
      const { createWriteFileTool } = await import('../src/features/ce/tools/builtinTools');
      const result = await createWriteFileTool(tempDir, ig).execute({
        path: 'src/screens/kitchen-screen/components/DineInKanban.tsx',
        content: 'git checkout HEAD -- src/screens/kitchen-screen/components/DineInKanban.tsx',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('content starts with a shell command');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('refuses raw TypeScript generics in MDX table cells', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-mdx-generic-guard-test-'));
    try {
      const ig = new IgnoreService();
      ig.load(tempDir);
      const { createWriteFileTool } = await import('../src/features/ce/tools/builtinTools');
      const result = await createWriteFileTool(tempDir, ig).execute({
        path: 'docs/ffb-mui/api/formik-renderer.md',
        content: [
          '### Props',
          '',
          '| Name | Type | Required | Description |',
          '|------|------|----------|-------------|',
          '| initialValues | Record<string, any> | Yes | Initial form values |',
          '| onSubmit | (values: Record<string, any>) => void | Yes | Form submission handler |',
        ].join('\n'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('raw TypeScript generic');
      expect(result.error).toContain('Unexpected character');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows code-spanned TypeScript generics in MDX table cells', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-mdx-generic-ok-test-'));
    try {
      const ig = new IgnoreService();
      ig.load(tempDir);
      const { createWriteFileTool } = await import('../src/features/ce/tools/builtinTools');
      const result = await createWriteFileTool(tempDir, ig).execute({
        path: 'docs/ffb-mui/api/formik-renderer.md',
        content: [
          '### Props',
          '',
          '| Name | Type | Required | Description |',
          '|------|------|----------|-------------|',
          '| initialValues | `Record<string, any>` | Yes | Initial form values |',
          '| onSubmit | `(values: Record<string, any>) => void` | Yes | Form submission handler |',
        ].join('\n'),
      });

      expect(result.success).toBe(true);
      expect(readFileSync(join(tempDir, 'docs/ffb-mui/api/formik-renderer.md'), 'utf8')).toContain('`Record<string, any>`');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('refuses broken LiveCodeBlock JSX attribute expressions in MDX files', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-mdx-livecodeblock-test-'));
    try {
      const ig = new IgnoreService();
      ig.load(tempDir);
      const { createWriteFileTool } = await import('../src/features/ce/tools/builtinTools');
      const result = await createWriteFileTool(tempDir, ig).execute({
        path: 'docs/ffb-mui/api/formik-renderer.md',
        content: [
          '<LiveCodeBlock',
          '  code={',
          '`import React from "react";',
          'export default function SimpleForm() { return null; }',
          'render(<SimpleForm />);`',
          '  componentName="SimpleForm"',
          '/>',
        ].join('\n'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not parse expression with acorn');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('ChunkingService', () => {
  it('chunks typescript by function boundaries', () => {
    const chunker = new ChunkingService();
    const content = `function foo() {\n  return 1;\n}\n\nfunction bar() {\n  return 2;\n}`;
    const chunks = chunker.chunkFile(content, 'typescript');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('fallback chunks large files', () => {
    const chunker = new ChunkingService();
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`);
    const chunks = chunker.chunkFile(lines.join('\n'), null);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('SymbolExtractor', () => {
  it('extracts TS symbols', () => {
    const content = 'export class Foo {}\nexport function bar() {}';
    const symbols = tsExtractor.extract(content);
    expect(symbols.some((s) => s.name === 'Foo')).toBe(true);
    expect(symbols.some((s) => s.name === 'bar')).toBe(true);
  });

  it('extracts Python symbols', () => {
    const content = 'class MyClass:\n    pass\ndef my_func():\n    pass';
    const symbols = pythonExtractor.extract(content);
    expect(symbols.some((s) => s.name === 'MyClass')).toBe(true);
    expect(symbols.some((s) => s.name === 'my_func')).toBe(true);
  });

  it('extracts Rust symbols via regex fallback', () => {
    const content = 'pub fn hello() {}\npub struct World;\npub enum Color { Red }';
    const symbols = extractSymbols(content, 'rust');
    expect(symbols.some((s) => s.name === 'hello')).toBe(true);
    expect(symbols.some((s) => s.name === 'World')).toBe(true);
    expect(symbols.some((s) => s.name === 'Color')).toBe(true);
  });

  it('extracts Ruby symbols via regex fallback', () => {
    const content = 'class User\n  def greet\n  end\nend';
    const symbols = extractSymbols(content, 'ruby');
    expect(symbols.some((s) => s.name === 'User')).toBe(true);
    expect(symbols.some((s) => s.name === 'greet')).toBe(true);
  });

  it('extracts Haskell symbols via regex fallback', () => {
    const content = 'data Tree a = Leaf | Node a (Tree a)\nmyFunc :: Int -> Int';
    const symbols = extractSymbols(content, 'haskell');
    expect(symbols.some((s) => s.name === 'Tree')).toBe(true);
    expect(symbols.some((s) => s.name === 'myFunc')).toBe(true);
  });
});

describe('languageRegistry', () => {
  it('supports 100+ file extensions', () => {
    expect(getSupportedExtensionCount()).toBeGreaterThanOrEqual(100);
  });

  it('detects common and niche languages', () => {
    expect(detectLanguageFromPath('src/main.rs')).toBe('rust');
    expect(detectLanguageFromPath('lib/kotlin/App.kt')).toBe('kotlin');
    expect(detectLanguageFromPath('contracts/token.sol')).toBe('solidity');
    expect(detectLanguageFromPath('schema/query.sql')).toBe('sql');
    expect(detectLanguageFromPath('infra/main.tf')).toBe('hcl');
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
  });

  it('maps tree-sitter WASM grammars for key languages', () => {
    const wasmLangs = getWasmLanguageIds();
    expect(wasmLangs).toContain('typescript');
    expect(wasmLangs).toContain('rust');
    expect(wasmLangs).toContain('swift');
    expect(wasmLangs.length).toBeGreaterThanOrEqual(30);
    expect(hasWasmGrammar('rust')).toBe(true);
    expect(hasWasmGrammar('haskell')).toBe(false);
  });
});

describe('FTS query sanitizer', () => {
  it('sanitizes queries', () => {
    const result = sanitizeFtsQuery('hello world!');
    expect(result).toContain('"hello"');
    expect(result).toContain('"world"');
  });

  it('returns empty for short query', () => {
    expect(sanitizeFtsQuery('a')).toBe('');
  });
});

describe('ToolPolicyEngine', () => {
  const engine = new ToolPolicyEngine(
    defaultThunderConfig().safety,
    () => false
  );

  it('allows read-only tools', () => {
    expect(engine.evaluate('read_file', { path: 'src/index.ts' }).decision).toBe('allow');
  });

  it('requires approval for writes', () => {
    expect(engine.evaluate('write_file', { path: 'src/index.ts' }).decision).toBe('require_approval');
  });

  it('requires approval for shell commands when shell approval is enabled', () => {
    expect(engine.evaluate('run_command', { command: 'rg "DineInKanban" src' }).decision).toBe('allow');
    expect(engine.evaluate('run_command', { command: 'npx depcheck' }).decision).toBe('allow');
    expect(engine.evaluate('run_command', { command: 'npm install lodash' }).decision).toBe('require_approval');
  });

  it('supports ask-before-delete approval mode', () => {
    const deleteEngine = new ToolPolicyEngine(
      { ...defaultThunderConfig().safety, approvalMode: 'ask_deletes' },
      () => false
    );

    expect(deleteEngine.evaluate('write_file', { path: 'src/index.ts', content: 'x' }).decision).toBe('allow');
    expect(deleteEngine.evaluate('run_command', { command: 'npm install lodash' }).decision).toBe('allow');
    expect(deleteEngine.evaluate('run_command', { command: 'npm uninstall lodash' }).decision).toBe('require_approval');
    expect(deleteEngine.evaluate('run_command', { command: 'rm src/old.ts' }).decision).toBe('require_approval');
  });

  it('supports ask-before-edit and auto approval modes', () => {
    const editEngine = new ToolPolicyEngine(
      { ...defaultThunderConfig().safety, approvalMode: 'ask_edits' },
      () => false
    );
    const autoEngine = new ToolPolicyEngine(
      { ...defaultThunderConfig().safety, approvalMode: 'auto' },
      () => false
    );

    expect(editEngine.evaluate('write_file', { path: 'src/index.ts', content: 'x' }).decision).toBe('require_approval');
    expect(editEngine.evaluate('run_command', { command: 'npm install lodash' }).decision).toBe('allow');
    expect(autoEngine.evaluate('write_file', { path: 'src/index.ts', content: 'x' }).decision).toBe('allow');
    expect(autoEngine.evaluate('run_command', { command: 'npm install lodash' }).decision).toBe('allow');
  });

  it('detects dangerous commands and requires approval even in auto mode', () => {
    expect(isDangerousCommand('rm -rf /')).toBe(true);
    expect(isDangerousCommand('rm -fr generated/')).toBe(true);
    expect(isDangerousCommand('rm --recursive --force generated/')).toBe(true);
    expect(isDangerousCommand('git clean -df generated/')).toBe(true);
    expect(isDangerousCommand('git push origin main -f')).toBe(true);
    expect(isDangerousCommand('npm test')).toBe(false);
    const autoEngine = new ToolPolicyEngine(
      { ...defaultThunderConfig().safety, approvalMode: 'auto', blockDangerousCommands: true },
      () => false
    );
    expect(autoEngine.evaluate('run_command', { command: 'git clean -fd generated/' })).toEqual({
      decision: 'require_approval',
      reason: 'Dangerous command requires explicit user approval',
    });
  });

  it('detects delete-like commands', () => {
    expect(isDeleteLikeCommand('git rm src/old.ts')).toBe(true);
    expect(isDeleteLikeCommand('pnpm remove unused-package')).toBe(true);
    expect(isDeleteLikeCommand('npm install lodash')).toBe(false);
  });
});

describe('ContextBudgeter', () => {
  it('budgets context items', () => {
    const budgeter = new ContextBudgeter();
    const items: ContextItem[] = [
      { id: '1', source: 'fts', content: 'a'.repeat(400), score: 5, reason: 'test', tokenEstimate: 100 },
      { id: '2', source: 'repo-map', content: 'b'.repeat(400), score: 3, reason: 'test', tokenEstimate: 100 },
    ];
    const pack = budgeter.budget(items, 150);
    expect(pack.items.length).toBeLessThanOrEqual(2);
    expect(pack.totalTokens).toBeLessThanOrEqual(150);
  });

  it('truncates oversized repo maps instead of dropping them', () => {
    const budgeter = new ContextBudgeter();
    const items: ContextItem[] = [
      { id: 'repo', source: 'repo-map', content: 'src/index.ts\n'.repeat(500), score: 7, reason: 'repo map', tokenEstimate: 1500 },
    ];
    const pack = budgeter.budget(items, 300);
    expect(pack.items).toHaveLength(1);
    expect(pack.items[0].source).toBe('repo-map');
    expect(pack.items[0].content).toContain('[truncated]');
    expect(pack.totalTokens).toBeLessThanOrEqual(300);
  });

  it('includes workspace overview context', () => {
    const budgeter = new ContextBudgeter();
    const items: ContextItem[] = [
      { id: 'overview', source: 'workspace-overview', content: 'README\npackage.json', score: 9, reason: 'overview', tokenEstimate: 5 },
    ];
    const pack = budgeter.budget(items, 100);
    expect(pack.items).toHaveLength(1);
    expect(pack.formatted).toContain('README');
  });
});

describe('Token estimate', () => {
  it('estimates tokens', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });

  it('tracks each provider completion as estimated AI usage', async () => {
    const records: Array<{ inputTokens: number; outputTokens: number; totalTokens: number }> = [];
    const provider = new UsageTrackingProvider({
      id: 'fake',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: true,
        supportsTools: true,
        supportsEmbeddings: false,
      },
      async *complete() {
        yield { content: 'hello ' };
        yield { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] };
        yield { content: 'world' };
        yield { done: true };
      },
    }, (usage) => records.push(usage));

    for await (const _ of provider.complete({
      messages: [{ role: 'user', content: 'inspect the file' }],
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
      }],
      stream: true,
    })) {
      // Drain the stream.
    }

    expect(records).toHaveLength(1);
    expect(records[0].inputTokens).toBeGreaterThan(0);
    expect(records[0].outputTokens).toBeGreaterThan(0);
    expect(records[0].totalTokens).toBe(records[0].inputTokens + records[0].outputTokens);
  });
});

describe('Thunder config', () => {
  it('defaults MCP bulk startup concurrency', () => {
    expect(defaultThunderConfig().mcp.maxConcurrentStartup).toBe(4);
  });

  it('preloads built-in MCP servers by default', () => {
    expect(defaultThunderConfig().mcp.preloadBuiltin).toBe(true);
  });
});

describe('Builtin MCP servers', () => {
  it('builds free official servers for a workspace', async () => {
    const { buildBuiltinMcpServers } = await import('../src/features/ce/mcp/builtinServers');
    const servers = buildBuiltinMcpServers('/tmp/my-project');

    expect(Object.keys(servers).sort()).toEqual(['agentmemory', 'filesystem', 'memory', 'puppeteer', 'sequential-thinking']);
    expect(servers.filesystem.command).toBe(process.platform === 'win32' ? 'cmd' : 'npx');
    expect(servers.filesystem.args).toContain('@modelcontextprotocol/server-filesystem');
    expect(servers.filesystem.args.at(-1)).toBe(resolve('/tmp/my-project'));
    expect(servers.memory.args).toContain('@modelcontextprotocol/server-memory');
    expect(servers['sequential-thinking'].args).toContain('@modelcontextprotocol/server-sequential-thinking');
    expect(servers.agentmemory).toMatchObject({ type: 'streamable-http', url: 'http://localhost:3111/mcp' });
  });

  it('omits filesystem when workspace is empty', async () => {
    const { buildBuiltinMcpServers } = await import('../src/features/ce/mcp/builtinServers');
    const servers = buildBuiltinMcpServers('');
    expect(Object.keys(servers).sort()).toEqual(['agentmemory', 'memory', 'puppeteer', 'sequential-thinking']);
  });

  it('lets user settings override built-in servers', async () => {
    const { resolveMcpServers } = await import('../src/features/ce/mcp/McpManager');
    const config = defaultThunderConfig();
    const servers = resolveMcpServers(
      {
        ...config.mcp,
        servers: {
          memory: {
            disabled: true,
            type: 'stdio',
            command: 'custom',
            args: ['memory'],
            env: {},
            url: '',
            headers: {},
            timeoutMs: 60_000,
          },
        },
      },
      '/tmp/project'
    );

    expect(servers.memory.command).toBe('custom');
    expect(servers.filesystem.command).toBe(process.platform === 'win32' ? 'cmd' : 'npx');
  });

  it('skips built-ins when preloadBuiltin is false', async () => {
    const { resolveMcpServers } = await import('../src/features/ce/mcp/McpManager');
    const config = defaultThunderConfig();
    const servers = resolveMcpServers({ ...config.mcp, preloadBuiltin: false }, '/tmp/project');
    expect(servers).toEqual({});
  });

  it('disables built-ins when session toggles are off', async () => {
    const { resolveMcpServers } = await import('../src/features/ce/mcp/McpManager');
    const config = defaultThunderConfig();
    const servers = resolveMcpServers(config.mcp, '/tmp/project', {
      filesystem: true,
      memory: false,
      sequentialThinking: true,
      puppeteer: false,
      agentmemory: false,
    });
    expect(servers.memory.disabled).toBe(true);
    expect(servers.filesystem.disabled).toBe(false);
  });

  it('defaults built-in MCP toggles on', () => {
    expect(defaultThunderConfig().mcp.builtinServers).toEqual({
      filesystem: true,
      memory: true,
      sequentialThinking: true,
      puppeteer: false,
      agentmemory: false,
    });
  });
});

describe('ProjectRulesService', () => {
  it('loads MITII.md from workspace root', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-rules-test-'));
    try {
      writeFileSync(join(tempDir, 'MITII.md'), 'mitii instructions');
      writeFileSync(join(tempDir, 'AGENTS.md'), 'agent instructions');

      const rules = new ProjectRulesService(tempDir).load();
      expect(rules.map((rule) => rule.relPath)).toEqual([
        'mitii:defaults/path-resolution',
        'MITII.md',
        'AGENTS.md',
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads compatibility files when MITII.md is missing', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-rules-test-'));
    try {
      writeFileSync(join(tempDir, 'AGENTS.md'), 'agent instructions');
      expect(new ProjectRulesService(tempDir).load().map((rule) => rule.relPath)).toEqual([
        'mitii:defaults/path-resolution',
        'AGENTS.md',
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('Config schema', () => {
  it('parses defaults', () => {
    const config = defaultThunderConfig();
    expect(config.provider.type).toBe('echo');
    expect(config.indexing.enabled).toBe(true);
  });
});

describe('Plan/Act task analysis', () => {
  it('plans actionable requests in plan mode without marking them for execution verification', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const analysis = analyzeTask('Implement a solid planning mode and separate act mode', 'plan');

    expect(analysis.kind).toBe('implementation');
    expect(analysis.shouldPlan).toBe(true);
    expect(analysis.shouldVerify).toBe(false);
    expect(analysis.summary).toContain('Plan mode');
  });

  it('plans and verifies actionable requests in agent mode', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const analysis = analyzeTask('Implement a solid planning mode and separate act mode', 'agent');

    expect(analysis.kind).toBe('implementation');
    expect(analysis.shouldPlan).toBe(true);
    expect(analysis.shouldVerify).toBe(true);
  });

  it('classifies gerund bug-report phrasing ("fixing", "issues") as bugfix intent', async () => {
    const { routePlanIntent } = await import('../src/features/ce/modes/plan/PlanIntentRouter');
    const route = routePlanIntent(
      "Can you plan on fixing this repo entirely, mainly @ai-service? I don't need any issues and the project should be fully functional."
    );

    expect(route.intent).toBe('bugfix');
    expect(route.qualityProfile).not.toBe('relaxed');
  });

  it('treats ask mode as read-only question answering', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const analysis = analyzeTask('implement auth and add tests for all routes', 'ask');

    expect(analysis.kind).toBe('question');
    expect(analysis.complexity).toBe('high');
    expect(analysis.shouldPlan).toBe(false);
    expect(analysis.shouldVerify).toBe(false);
    expect(analysis.shouldUseSubagents).toBe(true);
    expect(analysis.askIntent).toBe('implement_here');
    expect(analysis.summary).toContain('Ask mode');
  });
});

describe('Ask mode helpers', () => {
  it('filters tools to the read-only Ask allowlist', async () => {
    const { filterAskModeTools, ASK_ALLOWED_TOOLS } = await import('../src/features/ce/runtime/askMode');
    const tools = [
      { type: 'function' as const, function: { name: 'read_file', description: '', parameters: {} } },
      { type: 'function' as const, function: { name: 'write_file', description: '', parameters: {} } },
      { type: 'function' as const, function: { name: 'analyze_change_impact', description: '', parameters: {} } },
      { type: 'function' as const, function: { name: 'mcp__fs__read', description: '', parameters: {} } },
      { type: 'function' as const, function: { name: 'mark_step_complete', description: '', parameters: {} } },
    ];
    const filtered = filterAskModeTools(tools);
    expect(filtered.map((t) => t.function.name)).toEqual([
      'read_file',
      'analyze_change_impact',
      'mcp__fs__read',
    ]);
    expect(ASK_ALLOWED_TOOLS.has('spawn_research_agent')).toBe(true);
    expect(ASK_ALLOWED_TOOLS.has('project_catalog')).toBe(true);
    expect(ASK_ALLOWED_TOOLS.has('write_file')).toBe(false);
    expect(ASK_ALLOWED_TOOLS.has('analyze_jsonl')).toBe(true);
  });

  it('detects when Ask answers need grounding', async () => {
    const { needsAskGrounding, isGeneralKnowledgeQuestion, shouldEnableAskSubagents } =
      await import('../src/features/ce/runtime/askMode');

    expect(needsAskGrounding('Where is ChatOrchestrator.send defined?')).toBe(true);
    expect(needsAskGrounding('hi')).toBe(false);
    expect(isGeneralKnowledgeQuestion('What is a binary search tree?')).toBe(true);
    expect(needsAskGrounding('What is a binary search tree?')).toBe(false);
    expect(shouldEnableAskSubagents('How does authentication flow across the entire codebase?')).toBe(true);
    expect(shouldEnableAskSubagents('How do I implement OAuth in this project?')).toBe(true);
    expect(shouldEnableAskSubagents('What is OAuth?')).toBe(false);
  });

  it('blocks disallowed tools in ask mode via ToolExecutor', async () => {
    const { ToolExecutor } = await import('../src/features/ce/safety/ToolExecutor');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const { ToolPolicyEngine } = await import('../src/features/ce/safety/ToolPolicyEngine');
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');

    const runtime = new ToolRuntime();
    const executor = new ToolExecutor(
      runtime,
      new ToolPolicyEngine({
        requireApprovalForWrites: true,
        requireApprovalForShell: true,
        allowNetwork: false,
        blockDangerousCommands: true,
      }, () => false),
      new ApprovalQueue(),
      () => 'session-1',
      () => 'ask'
    );

    const result = await executor.execute('mark_step_complete', { stepId: 'step-1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available in Ask mode');
  });

  it('hard-blocks writes in Ask mode', async () => {
    const { ToolExecutor } = await import('../src/features/ce/safety/ToolExecutor');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const { ToolPolicyEngine } = await import('../src/features/ce/safety/ToolPolicyEngine');
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');
    const { createWriteFileTool } = await import('../src/features/ce/tools/builtinTools');
    const { IgnoreService } = await import('../src/features/ce/indexing/IgnoreService');

    const queue = new ApprovalQueue();
    const runtime = new ToolRuntime();
    runtime.register(createWriteFileTool(process.cwd(), new IgnoreService()));
    const executor = new ToolExecutor(
      runtime,
      new ToolPolicyEngine({
        requireApprovalForWrites: true,
        requireApprovalForShell: true,
        allowNetwork: false,
        blockDangerousCommands: true,
      }, () => false),
      queue,
      () => 'session-ask-write',
      () => 'ask'
    );

    const result = await executor.execute('write_file', { path: 'README.md', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.pendingApproval).not.toBe(true);
    expect(result.error).toContain('not available in Ask mode');
    expect(queue.getPending()).toHaveLength(0);
  });

  it('requires approval for mutating shell in Ask mode', async () => {
    const { ToolExecutor } = await import('../src/features/ce/safety/ToolExecutor');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const { ToolPolicyEngine } = await import('../src/features/ce/safety/ToolPolicyEngine');
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');
    const { createRunCommandTool } = await import('../src/features/ce/tools/builtinTools');

    const queue = new ApprovalQueue();
    const runtime = new ToolRuntime();
    runtime.register(createRunCommandTool(process.cwd(), () => 'ask'));
    const executor = new ToolExecutor(
      runtime,
      new ToolPolicyEngine({
        requireApprovalForWrites: true,
        requireApprovalForShell: true,
        allowNetwork: false,
        blockDangerousCommands: true,
      }, () => false),
      queue,
      () => 'session-ask-shell',
      () => 'ask'
    );

    const result = await executor.execute('run_command', { command: 'npm install lodash' });
    expect(result.success).toBe(false);
    expect(result.pendingApproval).toBe(true);
    expect(result.error).toBe('Awaiting approval');
    expect(queue.getPending()).toHaveLength(1);
    expect(queue.getPending()[0]?.reason).toContain('require your approval in all modes');
  });
});

describe('ThunderMode normalization', () => {
  it('maps legacy act to agent', async () => {
    const { normalizeThunderMode } = await import('../src/features/ce/session/ThunderSession');
    expect(normalizeThunderMode('act')).toBe('agent');
    expect(normalizeThunderMode('ask')).toBe('ask');
    expect(normalizeThunderMode('unknown')).toBe('plan');
  });
});

describe('ChatOrchestrator response handling', () => {
  const classifierProvider = (intent: 'question' | 'explain_code' = 'question') => ({
    id: 'classifier',
    capabilities: {
      contextWindow: 8192,
      supportsStreaming: true,
      supportsTools: false,
      supportsEmbeddings: false,
    },
    async *complete() {
      yield {
        content: JSON.stringify({
          intent,
          confidence: 0.9,
          alternatives: [],
          needsClarification: false,
        }),
      };
    },
  });

  it('turns empty model output into an explicit assistant message', async () => {
    const { EMPTY_ASSISTANT_RESPONSE_MESSAGE, normalizeAssistantResponse } =
      await import('../src/features/ce/orchestration/ChatOrchestrator');

    expect(normalizeAssistantResponse('')).toEqual({
      content: EMPTY_ASSISTANT_RESPONSE_MESSAGE,
      wasEmpty: true,
    });
    expect(normalizeAssistantResponse('   ')).toEqual({
      content: EMPTY_ASSISTANT_RESPONSE_MESSAGE,
      wasEmpty: true,
    });
    expect(normalizeAssistantResponse('ok')).toEqual({ content: 'ok', wasEmpty: false });
  });

  it('passes resolved tier policy into context retrieval', async () => {
    const { ChatOrchestrator } = await import('../src/features/ce/orchestration/ChatOrchestrator');
    const { ContextBudgeter } = await import('../src/features/ce/context/ContextBudgeter');
    const { ThunderSession } = await import('../src/features/ce/session/ThunderSession');
    let capturedQuery: import('../src/features/ce/context/types').ContextQuery | undefined;
    const retriever = {
      retrieve: async (query: import('../src/features/ce/context/types').ContextQuery) => {
        capturedQuery = query;
        return [];
      },
    };
    const provider = {
      id: 'fake-local',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: true,
        supportsTools: false,
        supportsEmbeddings: false,
        agenticTier: 'local-small' as const,
      },
      async *complete() {
        yield { content: 'done', done: true };
      },
    };

    const orchestrator = new ChatOrchestrator(
      retriever as unknown as import('../src/features/ce/context/HybridRetriever').HybridRetriever,
      new ContextBudgeter()
    );
    const session = new ThunderSession('/tmp/mitii-test', 'ask');
    for await (const chunk of orchestrator.send(session, provider, 'Explain this repo', [])) {
      expect(chunk).toBeDefined();
    }

    expect(capturedQuery?.tierPolicy?.skillInjection).toBe('none');
    expect(capturedQuery?.tierPolicy?.rulesMaxTotalChars).toBe(6_000);
    expect(capturedQuery?.maxItems).toBeLessThanOrEqual(18);
  });

  it('scopes touched-file audit lookups to the current turn', async () => {
    const { getTouchedFilesFromAudit } = await import('../src/features/ce/orchestration/ChatOrchestrator');
    const audit = [
      {
        toolName: 'write_file',
        input: { path: 'src/stale.ts' },
        result: { success: true, output: '' },
        timestamp: 1,
      },
      {
        toolName: 'read_file',
        input: { path: 'src/read.ts' },
        result: { success: true, output: '' },
        timestamp: 2,
      },
      {
        toolName: 'apply_patch',
        input: { path: 'src/current.ts' },
        result: { success: true, output: '' },
        timestamp: 3,
      },
    ];
    const runtime = { getAuditLog: () => audit };

    expect(getTouchedFilesFromAudit(runtime as never, 2)).toEqual(['src/current.ts']);
  });

  it('counts scoped git restore commands as current-turn workspace changes', async () => {
    const {
      getTouchedFilesFromAudit,
      hasWorkspaceMutationFromAudit,
    } = await import('../src/features/ce/orchestration/ChatOrchestrator');
    const audit = [
      {
        toolName: 'run_command',
        input: { command: 'git restore -- src/index.ts src/routes.ts' },
        result: { success: true, output: '' },
        timestamp: 1,
      },
    ];
    const runtime = { getAuditLog: () => audit };

    expect(getTouchedFilesFromAudit(runtime as never)).toEqual(['src/index.ts', 'src/routes.ts']);
    expect(hasWorkspaceMutationFromAudit(runtime as never)).toBe(true);
  });

  it('records a successful dependency mutation even when no exact file can be inferred', async () => {
    const {
      getTouchedFilesFromAudit,
      hasWorkspaceMutationFromAudit,
    } = await import('../src/features/ce/orchestration/ChatOrchestrator');
    const runtime = {
      getAuditLog: () => [{
        toolName: 'run_command',
        input: { command: 'pnpm remove unused-package' },
        result: { success: true, output: '' },
        timestamp: 1,
      }],
    };

    expect(getTouchedFilesFromAudit(runtime as never)).toEqual([]);
    expect(hasWorkspaceMutationFromAudit(runtime as never)).toBe(true);
  });

  it('subtracts explicit context before budgeting retrieved snippets', async () => {
    const { calculateRetrievalContextBudget } = await import('../src/features/ce/orchestration/ChatOrchestrator');

    expect(calculateRetrievalContextBudget(10_000, 1_200, 300)).toEqual({
      requestedContextBudget: 6_500,
      retrievalContextBudget: 5_000,
    });
    expect(calculateRetrievalContextBudget(10_000, 8_000, 100)).toEqual({
      requestedContextBudget: 6_500,
      retrievalContextBudget: 0,
    });
  });

  it('passes only current-turn audit entries to memory extraction', async () => {
    const { ChatOrchestrator } = await import('../src/features/ce/orchestration/ChatOrchestrator');
    const { ContextBudgeter } = await import('../src/features/ce/context/ContextBudgeter');
    const { ThunderSession } = await import('../src/features/ce/session/ThunderSession');
    const capturedAudits: unknown[] = [];
    const staleAudit = [{
      toolName: 'write_file',
      input: { path: 'src/previous.ts' },
      result: { success: true, output: '' },
      timestamp: Date.now(),
    }];
    const provider = {
      id: 'fake',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: true,
        supportsTools: false,
        supportsEmbeddings: false,
      },
      async *complete() {
        yield { content: 'done' };
      },
    };
    const orchestrator = new ChatOrchestrator(
      { retrieve: async () => [] } as unknown as import('../src/features/ce/context/HybridRetriever').HybridRetriever,
      new ContextBudgeter()
    );
    orchestrator.configure({
      toolRuntime: { getAuditLog: () => staleAudit } as never,
      memoryConfig: { enabled: true, summarizeAfterTask: false } as never,
      memoryExtractor: {
        extractAfterTask: (_sessionId: string, _user: string, _assistant: string, audit: unknown[]) => {
          capturedAudits.push(audit);
        },
      } as never,
      intentClassifierProvider: classifierProvider('explain_code') as never,
    });

    for await (const chunk of orchestrator.send(new ThunderSession('/tmp/mitii-memory-test', 'ask'), provider, 'Explain this', [])) {
      expect(chunk).toBeDefined();
    }

    expect(capturedAudits).toEqual([[]]);
  });

  it('does not auto-apply final response code blocks after tool-capable agent turns', async () => {
    const { z } = await import('zod');
    const { ChatOrchestrator } = await import('../src/features/ce/orchestration/ChatOrchestrator');
    const { ContextBudgeter } = await import('../src/features/ce/context/ContextBudgeter');
    const { ThunderSession } = await import('../src/features/ce/session/ThunderSession');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const writes: unknown[] = [];
    const toolRuntime = new ToolRuntime();
    toolRuntime.register({
      name: 'write_file',
      description: 'Write file',
      risk: 'medium',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async () => ({ success: true, output: '' }),
    });
    const provider = {
      id: 'fake-tools',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: true,
        supportsTools: true,
        supportsEmbeddings: false,
      },
      async *complete() {
        yield {
          content: 'Example only:\n```ts|CODE_EDIT_BLOCK|src/example.ts\nexport const example = true;\n```',
        };
      },
    };
    const orchestrator = new ChatOrchestrator(
      { retrieve: async () => [] } as unknown as import('../src/features/ce/context/HybridRetriever').HybridRetriever,
      new ContextBudgeter()
    );
    orchestrator.configure({
      toolRuntime,
      toolExecutor: {
        execute: async (name: string, input: Record<string, unknown>) => {
          writes.push({ name, input });
          return { success: true, output: '' };
        },
      } as never,
      intentClassifierProvider: classifierProvider('question') as never,
    });

    for await (const chunk of orchestrator.send(new ThunderSession('/tmp/mitii-tools-test', 'agent'), provider, 'Show an example for src/example.ts', [])) {
      expect(chunk).toBeDefined();
    }

    expect(writes).toEqual([]);
  });

  it('keeps legacy response auto-apply for agent turns without tool-capable model calls', async () => {
    const { ChatOrchestrator } = await import('../src/features/ce/orchestration/ChatOrchestrator');
    const { ContextBudgeter } = await import('../src/features/ce/context/ContextBudgeter');
    const { ThunderSession } = await import('../src/features/ce/session/ThunderSession');
    const writes: unknown[] = [];
    const provider = {
      id: 'fake-no-tools',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: true,
        supportsTools: false,
        supportsEmbeddings: false,
      },
      async *complete() {
        yield {
          content: '```ts|CODE_EDIT_BLOCK|src/example.ts\nexport const example = true;\n```',
        };
      },
    };
    const orchestrator = new ChatOrchestrator(
      { retrieve: async () => [] } as unknown as import('../src/features/ce/context/HybridRetriever').HybridRetriever,
      new ContextBudgeter()
    );
    orchestrator.configure({
      toolExecutor: {
        execute: async (name: string, input: Record<string, unknown>) => {
          writes.push({ name, input });
          return { success: true, output: '' };
        },
      } as never,
      intentClassifierProvider: classifierProvider('question') as never,
    });

    for await (const chunk of orchestrator.send(new ThunderSession('/tmp/mitii-no-tools-test', 'agent'), provider, 'Update src/example.ts', [])) {
      expect(chunk).toBeDefined();
    }

    expect(writes).toEqual([
      {
        name: 'write_file',
        input: {
          path: 'src/example.ts',
          content: 'export const example = true;',
        },
      },
    ]);
  });

  it('does not save plan-shaped ask responses as active plans', async () => {
    const { ChatOrchestrator } = await import('../src/features/ce/orchestration/ChatOrchestrator');
    const { ContextBudgeter } = await import('../src/features/ce/context/ContextBudgeter');
    const { ThunderSession } = await import('../src/features/ce/session/ThunderSession');
    const save = vi.fn();
    const provider = {
      id: 'fake',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: true,
        supportsTools: false,
        supportsEmbeddings: false,
      },
      async *complete() {
        yield {
          content: [
            'Here is illustrative JSON:',
            '```json',
            '{"goal":"Explain plan","assumptions":[],"steps":[],"requiredApprovals":[]}',
            '```',
          ].join('\n'),
        };
      },
    };
    const orchestrator = new ChatOrchestrator(
      { retrieve: async () => [] } as unknown as import('../src/features/ce/context/HybridRetriever').HybridRetriever,
      new ContextBudgeter()
    );
    orchestrator.configure({
      planPersistence: { save, getActive: () => undefined } as never,
      intentClassifierProvider: classifierProvider('explain_code') as never,
    });

    for await (const chunk of orchestrator.send(new ThunderSession('/tmp/mitii-plan-shape-test', 'ask'), provider, 'Explain this plan JSON', [])) {
      expect(chunk).toBeDefined();
    }

    expect(save).not.toHaveBeenCalled();
  });
});

describe('Plan parser', () => {
  it('flattens rich phase plans into executable steps', async () => {
    const { parsePlanFromText } = await import('../src/features/ce/plans/PlanActEngine');
    const parsed = parsePlanFromText(`\`\`\`json
{
  "goal": "Improve planning",
  "assumptions": [],
  "phases": [
    {
      "id": "phase-1",
      "title": "Phase 1: Diagnostics",
      "phase": "diagnostics",
      "objective": "Inspect current behavior",
      "steps": [
        {
          "id": "step-1",
          "title": "Inspect mode routing",
          "tools": ["read_file"],
          "successCriteria": ["Mode branch is understood"],
          "files": ["src/core/orchestration/ChatOrchestrator.ts"],
          "risk": "low"
        }
      ]
    }
  ],
  "requiredApprovals": []
}
\`\`\``);

    expect(parsed?.steps).toHaveLength(1);
    expect(parsed?.steps[0].phase).toBe('diagnostics');
    expect(parsed?.steps[0].objective).toBe('Inspect current behavior');
    expect(parsed?.steps[0].tools).toEqual(['read_file']);
    expect(parsed?.steps[0].successCriteria).toEqual(['Mode branch is understood']);
  });

  it('raises recursive deletion plans to high risk with explicit approvals', async () => {
    const { parsePlanFromText } = await import('../src/features/ce/plans/PlanActEngine');
    const parsed = parsePlanFromText(`\`\`\`json
{
  "goal": "Restore repository structure",
  "assumptions": [],
  "steps": [
    {
      "id": "step-1",
      "title": "Remove half-finished restructuring directories",
      "phase": "execute",
      "tools": ["run_command"],
      "script": { "command": "rm -rf ai-service/src/features ai-service/src/infrastructure" },
      "files": ["ai-service/src/features", "ai-service/src/infrastructure"],
      "risk": "low"
    }
  ],
  "requiredApprovals": []
}
\`\`\``);

    expect(parsed?.steps[0].risk).toBe('high');
    expect(parsed?.requiredApprovals).toContain('recursive_delete:ai-service/src/features,ai-service/src/infrastructure');
  });

  it('normalizes diagnostic build-capture steps even when the model declares execute', async () => {
    const { parsePlanFromText } = await import('../src/features/ce/plans/PlanActEngine');
    const parsed = parsePlanFromText(`\`\`\`json
{
  "goal": "Fix build errors",
  "assumptions": [],
  "steps": [
    {
      "id": "step-1",
      "title": "Capture exact ai-service build errors",
      "phase": "execute",
      "tools": ["run_command"],
      "successCriteria": ["Build error output is captured"],
      "files": ["ai-service/package.json"],
      "risk": "medium"
    }
  ],
  "requiredApprovals": []
}
\`\`\``);

    expect(parsed?.steps[0].phase).toBe('diagnostics');
  });

  it('hides internal plan phases from the default plan view', async () => {
    const { thunderPlanToView } = await import('../src/features/ce/modes/plan/planViewMapper');
    const plan = {
      goal: 'Fix build errors',
      assumptions: [],
      requiredApprovals: [],
      steps: [
        {
          id: 'step-1',
          title: 'Capture exact ai-service build errors',
          status: 'pending' as const,
          phase: 'diagnostics' as const,
          risk: 'medium' as const,
        },
      ],
    };

    expect(thunderPlanToView(plan).steps[0].phase).toBeUndefined();
    expect(thunderPlanToView(plan, { showInternalPhases: true }).steps[0].phase).toBe('diagnostics');
  });

  it('keeps generated plan phases mode-aware', async () => {
    const { PlanExecutor } = await import('../src/features/ce/runtime/PlanExecutor');
    const provider = {
      id: 'fake',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: false,
        supportsTools: false,
        supportsEmbeddings: false,
      },
      async *complete() {
        yield {
          content: `\`\`\`json
{
  "goal": "Fix bug",
  "assumptions": [],
  "steps": [
    {
      "id": "step-1",
      "title": "Fix Theme Utilities",
      "phase": "diagnostics",
      "tools": ["apply_patch"],
      "risk": "medium"
    }
  ],
  "requiredApprovals": []
}
\`\`\``,
        };
      },
    };
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: '',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };
    const executor = new PlanExecutor({} as never, { save: () => 'plan-id' } as never);

    const planMode = await executor.generatePlan(provider, 'plan', pack, 'fix bug');
    const actMode = await executor.generatePlan(provider, 'agent', pack, 'fix bug');

    expect(planMode?.steps[0].phase).toBe('diagnostics');
    expect(actMode?.steps[0].phase).toBe('execute');
  });

  it('fails an explicit scripted plan step when its command fails', async () => {
    const { PlanExecutor } = await import('../src/features/ce/runtime/PlanExecutor');
    const plan = {
      goal: 'Verify package',
      assumptions: [],
      requiredApprovals: [],
      steps: [
        {
          id: 'verify',
          title: 'Verify Compilation',
          status: 'pending' as const,
          risk: 'low' as const,
          phase: 'verify' as const,
          script: { command: 'npm run lint' },
        },
      ],
    };
    const persistence = {
      save: () => 'plan-id',
      updatePlan: () => undefined,
      complete: () => undefined,
    };
    const agentLoop = {
      hadPendingApproval: () => false,
      async *run() {
        throw new Error('agent loop should not run for explicit scripted steps');
      },
    };
    const toolExecutor = {
      execute: async () => ({ success: false, output: '', error: 'lint failed' }),
    };
    const executor = new PlanExecutor(agentLoop as never, persistence as never, undefined, toolExecutor as never);
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: '',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };
    let output = '';

    for await (const chunk of executor.executePlan(
      { id: 's1', mode: 'agent' } as never,
      {} as never,
      plan,
      pack,
      [],
      undefined,
      undefined,
      undefined,
      { stepMaxRetries: 0 }
    )) {
      output += chunk;
    }

    expect(plan.steps[0].status).toBe('failed');
    expect(output).toContain('lint failed');

    plan.steps[0].status = 'pending';
    let phasePolicyCalls = 0;
    const phasePolicyExecutor = new PlanExecutor(
      agentLoop as never,
      persistence as never,
      undefined,
      {
        execute: async () => {
          phasePolicyCalls += 1;
          return {
            success: false,
            output: '',
            error: 'Phase 4 (Verify) allows diagnostics, lint, tests, builds, and targeted file fixes, not arbitrary shell commands.',
          };
        },
      } as never
    );
    let phasePolicyOutput = '';
    for await (const chunk of phasePolicyExecutor.executePlan(
      { id: 's2', mode: 'agent' } as never,
      {} as never,
      plan,
      pack,
      [],
      undefined,
      undefined,
      undefined,
      { stepMaxRetries: 2 }
    )) {
      phasePolicyOutput += chunk;
    }
    expect(phasePolicyCalls).toBe(1);
    expect(plan.steps[0].status).toBe('failed');
    expect(phasePolicyOutput).toContain('will not be retried unchanged');
  });

  it('completes an explicit diagnostic reproduction step when the command captures a failing signal', async () => {
    const { PlanExecutor } = await import('../src/features/ce/runtime/PlanExecutor');
    const plan = {
      goal: 'Fix package build',
      assumptions: [],
      requiredApprovals: [],
      steps: [
        {
          id: 'reproduce',
          title: 'Reproduce build failure — capture initial failing signal',
          objective: 'Run pnpm run build and preserve current TypeScript errors',
          status: 'pending' as const,
          risk: 'low' as const,
          phase: 'diagnostics' as const,
          tools: ['run_command'],
          script: { command: 'pnpm run build' },
          successCriteria: ['Build output captured showing current errors'],
        },
      ],
    };
    const persistence = {
      save: () => 'plan-id',
      updatePlan: () => undefined,
      complete: () => undefined,
    };
    const agentLoop = {
      hadPendingApproval: () => false,
      async *run() {
        throw new Error('agent loop should not run for explicit scripted steps');
      },
    };
    let calls = 0;
    const toolExecutor = {
      execute: async () => {
        calls += 1;
        return {
          success: false,
          output: "src/index.ts(1,1): error TS2307: Cannot find module './missing'.",
          error: 'Command failed with exit code 2',
        };
      },
    };
    const executor = new PlanExecutor(agentLoop as never, persistence as never, undefined, toolExecutor as never);
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: '',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };
    let output = '';

    for await (const chunk of executor.executePlan(
      { id: 's1', mode: 'agent' } as never,
      {} as never,
      plan,
      pack,
      [],
      undefined,
      undefined,
      undefined,
      { stepMaxRetries: 2, finalValidationEnabled: false }
    )) {
      output += chunk;
    }

    expect(calls).toBe(1);
    expect(plan.steps[0].status).toBe('done');
    expect(output).toContain('Diagnostic failing signal captured');
  });

  it('grounds the next step in the exact files a failing build named, and persists the diagnostics', async () => {
    const { mkdtempSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { PlanExecutor } = await import('../src/features/ce/runtime/PlanExecutor');
    const { DiagnosticsStore } = await import('../src/features/ce/runtime/DiagnosticsStore');

    const workspace = mkdtempSync(join(tmpdir(), 'thunder-plan-diagnostics-'));
    try {
      const plan: ThunderPlan = {
        goal: 'Fix ai-service build errors',
        assumptions: [],
        requiredApprovals: [],
        steps: [
          {
            id: 'reproduce',
            title: 'Reproduce build failure — capture initial failing signal',
            objective: 'Run pnpm run build and preserve current TypeScript errors',
            status: 'pending' as const,
            risk: 'low' as const,
            phase: 'diagnostics' as const,
            tools: ['run_command'],
            script: { command: 'pnpm run build' },
            successCriteria: ['Build output captured showing current errors'],
          },
          {
            id: 'fix',
            title: 'Fix the reported errors',
            status: 'pending' as const,
            risk: 'low' as const,
            script: { command: 'echo done' },
          },
        ],
      };
      const persistence = { save: () => 'plan-id', updatePlan: () => undefined, complete: () => undefined };
      const agentLoop = {
        hadPendingApproval: () => false,
        async *run() {
          throw new Error('agent loop should not run for explicit scripted steps');
        },
      };
      let toolCalls = 0;
      const toolExecutor = {
        execute: async () => {
          toolCalls += 1;
          if (toolCalls === 1) {
            return {
              success: false,
              output:
                "src/features/document-parser/services/resume-builder-service.ts:20:38 - error TS2307: Cannot find module '../missing'.\n" +
                "src/jd-parser/services/manual-resume-service.ts:134:13 - error TS7006: Parameter 'url' implicitly has an 'any' type.",
              error: 'Command failed with exit code 2',
            };
          }
          return { success: true, output: 'Wrote file' };
        },
      };
      const executor = new PlanExecutor(agentLoop as never, persistence as never, undefined, toolExecutor as never);
      const pack = {
        items: [],
        totalTokens: 0,
        formatted: '',
        budgetLimit: 100,
        retrievedCount: 0,
        truncatedCount: 0,
        dropped: [],
      };
      let seededPaths: string[] | undefined;

      let output = '';
      for await (const chunk of executor.executePlan(
        { id: 'sess-diagnostics-1', mode: 'agent' } as never,
        {} as never,
        plan,
        pack,
        [],
        undefined,
        undefined,
        undefined,
        {
          stepMaxRetries: 2,
          finalValidationEnabled: false,
          workspace,
          seedFileScope: (paths: string[]) => {
            seededPaths = paths;
          },
        }
      )) {
        output += chunk;
      }
      void output;

      expect(plan.steps[0].status).toBe('done');
      expect(seededPaths).toEqual([
        'src/features/document-parser/services/resume-builder-service.ts',
        'src/jd-parser/services/manual-resume-service.ts',
      ]);
      // The plan itself now targets the compiler-named files instead of leaving the next
      // step's scope to be re-derived from narration.
      expect(plan.steps[1].files).toEqual([
        'src/features/document-parser/services/resume-builder-service.ts',
        'src/jd-parser/services/manual-resume-service.ts',
      ]);

      const record = new DiagnosticsStore(workspace, 'sess-diagnostics-1').latest();
      expect(record?.files).toEqual([
        'src/features/document-parser/services/resume-builder-service.ts',
        'src/jd-parser/services/manual-resume-service.ts',
      ]);
      expect(record?.entries.some((e) => e.code === 'TS2307')).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('completes an agent-loop diagnostic build capture when the command exits nonzero', async () => {
    const { PlanExecutor } = await import('../src/features/ce/runtime/PlanExecutor');
    const plan = {
      goal: 'Fix package build',
      assumptions: [],
      requiredApprovals: [],
      steps: [
        {
          id: 'capture',
          title: 'Run pnpm run build and capture errors',
          objective: 'Collect the current TypeScript build errors before editing',
          status: 'pending' as const,
          risk: 'low' as const,
          phase: 'diagnostics' as const,
          tools: ['run_command'],
          successCriteria: ['Build error output captured'],
        },
      ],
    };
    const persistence = {
      save: () => 'plan-id',
      updatePlan: () => undefined,
      complete: () => undefined,
    };
    let calls = 0;
    const agentLoop = {
      hadPendingApproval: () => false,
      async *run(_provider: unknown, _messages: unknown, _tools: unknown, _signal: unknown, callbacks: {
        onToolStart?: (name: string, input: Record<string, unknown>) => void;
        onToolEnd?: (name: string, success: boolean, output: string) => void;
      }) {
        calls += 1;
        callbacks.onToolStart?.('run_command', { command: 'pnpm run build' });
        callbacks.onToolEnd?.(
          'run_command',
          false,
          "src/index.ts(1,1): error TS2307: Cannot find module './missing'. Command failed with exit code 2"
        );
        yield 'Stopped after repeated identical tool failure: Command failed with exit code 2';
      },
    };
    const executor = new PlanExecutor(agentLoop as never, persistence as never);
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: '',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };

    for await (const _chunk of executor.executePlan(
      { id: 's1', mode: 'agent' } as never,
      {} as never,
      plan,
      pack,
      [],
      undefined,
      undefined,
      undefined,
      { stepMaxRetries: 2, finalValidationEnabled: false }
    )) {
      // consume stream
    }

    expect(calls).toBe(1);
    expect(plan.steps[0].status).toBe('done');
  });

  it('does not complete a verification step from prose without running a verifier', async () => {
    const { PlanExecutor } = await import('../src/features/ce/runtime/PlanExecutor');
    const plan = {
      goal: 'Verify package',
      assumptions: [],
      requiredApprovals: [],
      steps: [{
        id: 'verify',
        title: 'Verify Compilation',
        status: 'pending' as const,
        risk: 'low' as const,
        phase: 'verify' as const,
      }],
    };
    const persistence = {
      save: () => 'plan-id',
      updatePlan: () => undefined,
      complete: () => undefined,
    };
    const agentLoop = {
      hadPendingApproval: () => false,
      async *run() {
        // Weak model stopped without calling diagnostics/run_command.
      },
    };
    const executor = new PlanExecutor(agentLoop as never, persistence as never);
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: '',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };
    let output = '';

    for await (const chunk of executor.executePlan(
      { id: 's1', mode: 'agent' } as never,
      {} as never,
      plan,
      pack,
      [],
      undefined,
      undefined,
      undefined,
      { stepMaxRetries: 0 }
    )) {
      output += chunk;
    }

    expect(plan.steps[0].status).toBe('failed');
    expect(output).toContain('without a successful verification command');
  });

  it('does not complete a generic (non-write, non-verify) step whose tool calls all failed', async () => {
    const { PlanExecutor } = await import('../src/features/ce/runtime/PlanExecutor');
    const plan = {
      goal: 'Fix package build',
      assumptions: [],
      requiredApprovals: [],
      steps: [{
        id: 'scope',
        title: 'Propose file scope',
        status: 'pending' as const,
        risk: 'low' as const,
        phase: 'diagnostics' as const,
      }],
    };
    const persistence = {
      save: () => 'plan-id',
      updatePlan: () => undefined,
      complete: () => undefined,
    };
    let calls = 0;
    const agentLoop = {
      hadPendingApproval: () => false,
      async *run(_provider: unknown, _messages: unknown, _tools: unknown, _signal: unknown, callbacks: {
        onToolStart?: (name: string, input: Record<string, unknown>) => void;
        onToolEnd?: (name: string, success: boolean, output: string) => void;
      }) {
        calls += 1;
        callbacks.onToolStart?.('propose_file_scope', { paths: ['src/index.ts'] });
        callbacks.onToolEnd?.('propose_file_scope', false, 'Scope proposal rejected: quota exceeded');
        // Model narrates success even though the only tool call failed.
        yield 'Scope has been proposed and accepted.';
      },
    };
    const executor = new PlanExecutor(agentLoop as never, persistence as never);
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: '',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };
    let output = '';

    for await (const chunk of executor.executePlan(
      { id: 's1', mode: 'agent' } as never,
      {} as never,
      plan,
      pack,
      [],
      undefined,
      undefined,
      undefined,
      { stepMaxRetries: 0 }
    )) {
      output += chunk;
    }

    expect(calls).toBe(1);
    expect(plan.steps[0].status).toBe('failed');
    expect(output).toContain('no tool call succeeded');
  });

  it('resumes a blocked step from its suspended sub-loop state instead of restarting it', async () => {
    const { PlanExecutor } = await import('../src/features/ce/runtime/PlanExecutor');
    const plan = {
      goal: 'Fix package build',
      assumptions: [],
      requiredApprovals: [],
      steps: [{
        id: 'scope',
        title: 'Propose file scope',
        status: 'pending' as const,
        risk: 'low' as const,
        phase: 'diagnostics' as const,
      }],
    };
    const persistence = {
      save: () => 'plan-id',
      updatePlan: () => undefined,
      complete: () => undefined,
    };
    let runCalls = 0;
    let resumeCalls = 0;
    let seenState: unknown;
    let seenApproved: unknown;
    const suspendState = { messages: [{ role: 'assistant', content: 'partial' }], tools: [], options: {} };
    const approvedResults = [{ toolCallId: 't1', toolName: 'propose_file_scope', output: 'ok', success: true }];
    const agentLoop = {
      hadPendingApproval: () => false,
      async *run() {
        runCalls += 1;
        throw new Error('should resume the suspended step instead of restarting it');
      },
      async *resume(_provider: unknown, state: unknown, approved: unknown, _signal: unknown, callbacks: {
        onToolStart?: (name: string, input: Record<string, unknown>) => void;
        onToolEnd?: (name: string, success: boolean, output: string) => void;
      }) {
        resumeCalls += 1;
        seenState = state;
        seenApproved = approved;
        callbacks.onToolStart?.('propose_file_scope', { paths: ['src/index.ts'] });
        callbacks.onToolEnd?.('propose_file_scope', true, 'Scope accepted');
        yield 'Scope has been proposed and accepted.';
      },
    };
    const executor = new PlanExecutor(agentLoop as never, persistence as never);
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: '',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };

    for await (const _chunk of executor.executePlan(
      { id: 's1', mode: 'agent' } as never,
      {} as never,
      plan,
      pack,
      [],
      undefined,
      undefined,
      undefined,
      {
        stepMaxRetries: 0,
        finalValidationEnabled: false,
        resumeStep: { stepId: 'scope', suspendState: suspendState as never, approved: approvedResults as never },
      }
    )) {
      // consume stream
    }

    expect(runCalls).toBe(0);
    expect(resumeCalls).toBe(1);
    expect(seenState).toBe(suspendState);
    expect(seenApproved).toBe(approvedResults);
    expect(plan.steps[0].status).toBe('done');
  });

  it('does not reuse stale agent-loop approval state after an explicit step succeeds', async () => {
    const { PlanExecutor } = await import('../src/features/ce/runtime/PlanExecutor');
    const plan = {
      goal: 'Verify package',
      assumptions: [],
      requiredApprovals: [],
      steps: [
        {
          id: 'verify',
          title: 'Verify Compilation',
          status: 'pending' as const,
          risk: 'low' as const,
          phase: 'verify' as const,
          script: { command: 'npm run lint' },
        },
      ],
    };
    let completed = false;
    const persistence = {
      save: () => 'plan-id',
      updatePlan: () => undefined,
      complete: () => { completed = true; },
    };
    const agentLoop = {
      hadPendingApproval: () => true,
      async *run() {
        throw new Error('agent loop should not run for explicit scripted steps');
      },
    };
    const toolExecutor = {
      execute: async () => ({ success: true, output: 'lint ok' }),
    };
    const executor = new PlanExecutor(agentLoop as never, persistence as never, undefined, toolExecutor as never);
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: '',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };

    for await (const _chunk of executor.executePlan(
      { id: 's1', mode: 'agent' } as never,
      {} as never,
      plan,
      pack,
      [],
      undefined,
      undefined,
      undefined,
      { stepMaxRetries: 0, finalValidationEnabled: false }
    )) {
      // consume stream
    }

    expect(plan.steps[0].status).toBe('done');
    expect(completed).toBe(true);
  });
});

describe('extractFileMentions', () => {
  it('extracts file names from user text', async () => {
    const { extractFileMentions } = await import('../src/features/ce/context/fuzzyFileMatch');
    const mentions = extractFileMentions('Can you change DineInKanban.tsx and src/App.tsx?');
    expect(mentions).toContain('DineInKanban.tsx');
    expect(mentions).toContain('src/App.tsx');
  });
});

describe('fuzzyFileMatch', () => {
  it('expands DinInKanban to searchable kanban term', async () => {
    const { expandCamelCaseTerms, globPatternsForMention } = await import('../src/features/ce/context/fuzzyFileMatch');
    const terms = expandCamelCaseTerms('DinInKanban.tsx');
    expect(terms).toContain('kanban');
    const patterns = globPatternsForMention('DinInKanban.tsx');
    expect(patterns.some((p) => p.includes('kanban'))).toBe(true);
  });
});

describe('ApprovalQueue', () => {
  it('maps clarifying questions with options for persisted UI state', async () => {
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');
    const { toApprovalView } = await import('../src/adapters/vscode/ThunderController');
    const queue = new ApprovalQueue();
    const req = queue.createRequest('s1', 'ask_question', {
      question: 'Which project should I inspect?',
      options: ['agent', 'docs'],
    }, {
      decision: 'require_approval',
      reason: 'Clarifying question requires user response',
    });

    expect(toApprovalView(req)).toMatchObject({
      id: req.id,
      toolName: 'ask_question',
      kind: 'question',
      question: 'Which project should I inspect?',
      options: ['agent', 'docs'],
    });
  });

  it('stores full input for large write_file payloads', async () => {
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');
    const queue = new ApprovalQueue();
    const bigContent = 'x'.repeat(20_000);
    const req = queue.createRequest('s1', 'write_file', { path: 'src/Foo.tsx', content: bigContent }, {
      decision: 'require_approval',
      reason: 'test',
    });
    expect(req.inputPreview).toContain('20,000');
    expect(req.contentLength).toBe(20_000);
    const full = queue.getFullInput(req.id);
    expect(full?.content).toBe(bigContent);
  });

  it('keeps task approval grants explicit and clearable', async () => {
    const { ApprovalQueue } = await import('../src/features/ce/safety/ApprovalQueue');
    const queue = new ApprovalQueue();
    const req = queue.createRequest('s1', 'write_file', { path: 'src/Foo.tsx', content: 'x' }, {
      decision: 'require_approval',
      reason: 'test',
    });

    queue.resolve(req.id, 'approved');
    expect(queue.hasApprovalGrant('s1', 'write_file')).toBe(false);

    queue.grantForTask('s1', 'write_file');
    expect(queue.hasApprovalGrant('s1', 'write_file')).toBe(true);
    expect(queue.hasApprovalGrant('s1', 'apply_patch')).toBe(false);

    queue.clearTaskGrants('s1');
    expect(queue.hasApprovalGrant('s1', 'write_file')).toBe(false);
  });
});

describe('codeEditParser', () => {
  it('parses CODE_EDIT_BLOCK format', async () => {
    const { parseCodeEdits } = await import('../src/features/ce/apply/codeEditParser');
    const response = 'Here is the file:\n```tsx|CODE_EDIT_BLOCK|src/Foo.tsx\nexport const x = 1\n```';
    const edits = parseCodeEdits(response);
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toBe('src/Foo.tsx');
    expect(edits[0].content).toContain('export const x');
  });

  it('infers path from user mention when one code block', async () => {
    const { parseCodeEdits } = await import('../src/features/ce/apply/codeEditParser');
    const response = '```tsx\nexport const DineInKanban = () => null\n```';
    const edits = parseCodeEdits(response, 'redesign DineInKanban.tsx');
    expect(edits[0]?.path).toBe('DineInKanban.tsx');
  });
});

describe('ContextCompaction', () => {
  it('keeps recent messages within budget', async () => {
    const { compactMessages } = await import('../src/features/ce/runtime/ContextCompaction');
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: `message ${i} `.repeat(50),
    }));
    const compacted = compactMessages(messages, 200);
    expect(compacted.length).toBeLessThanOrEqual(messages.length);
  });
});

describe('autonomyPresets', () => {
  it('pilot preset auto-approves writes', async () => {
    const { applyAutonomyPreset } = await import('../src/features/ce/safety/autonomyPresets');
    const base = defaultThunderConfig().safety;
    const pilot = applyAutonomyPreset(base, 'pilot');
    expect(pilot.requireApprovalForWrites).toBe(false);
    expect(pilot.requireApprovalForShell).toBe(true);
  });

  it('resolveEffectiveSafety keeps auto approval when preset is guided', async () => {
    const { resolveEffectiveSafety } = await import('../src/features/ce/safety/autonomyPresets');
    const resolved = resolveEffectiveSafety({
      ...defaultThunderConfig().safety,
      approvalMode: 'auto',
      autonomyPreset: 'guided',
    });
    expect(resolved.approvalMode).toBe('auto');
    expect(resolved.requireApprovalForWrites).toBe(false);
    expect(resolved.requireApprovalForShell).toBe(false);
    expect(resolved.allowNetwork).toBe(true);
  });

  it('resolveEffectiveSafety honors ask_edits over pilot preset defaults', async () => {
    const { resolveEffectiveSafety } = await import('../src/features/ce/safety/autonomyPresets');
    const resolved = resolveEffectiveSafety({
      ...defaultThunderConfig().safety,
      approvalMode: 'ask_edits',
      autonomyPreset: 'pilot',
    });
    expect(resolved.approvalMode).toBe('ask_edits');
    expect(resolved.requireApprovalForWrites).toBe(true);
    expect(resolved.requireApprovalForShell).toBe(false);
  });

  it('differentiates safe, guided, and builder', async () => {
    const { applyAutonomyPreset } = await import('../src/features/ce/safety/autonomyPresets');
    const base = defaultThunderConfig().safety;
    const safe = applyAutonomyPreset(base, 'safe');
    const guided = applyAutonomyPreset(base, 'guided');
    const builder = applyAutonomyPreset(base, 'builder');
    expect(safe.allowNetwork).toBe(false);
    expect(guided.allowNetwork).toBe(true);
    expect(builder.requireApprovalForWrites).toBe(false);
    expect(guided.approvalMode).toBe('ask_edits');
    expect(builder.approvalMode).toBe('ask_commands');
  });
});

describe('shouldDecomposeTask', () => {
  it('decomposes implementation tasks and explicit plan requests in act mode', async () => {
    const { shouldDecomposeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    expect(
      shouldDecomposeTask('implement auth and then add tests step by step for all routes', 'agent')
    ).toBe(true);
    expect(shouldDecomposeTask('implement auth and then add tests for all routes', 'agent')).toBe(true);
    expect(
      shouldDecomposeTask('identify and remove unused files and dependencies in the whole project', 'agent')
    ).toBe(true);
    expect(shouldDecomposeTask('implement auth and then add tests', 'plan')).toBe(true);
    expect(shouldDecomposeTask('hi', 'agent')).toBe(false);
    expect(shouldDecomposeTask('what does this project do?', 'agent')).toBe(false);
  });
});

describe('TaskAnalyzer', () => {
  it('classifies task kinds', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const audit = analyzeTask('find unused dependencies and clean up dead code', 'agent');
    expect(audit.kind).toBe('audit');
    expect(audit.shouldPlan).toBe(true);

    const question = analyzeTask('how does authentication work?', 'agent');
    expect(question.kind).toBe('question');
    expect(question.shouldPlan).toBe(false);

    const impl = analyzeTask('implement login and then add tests for the auth module', 'agent');
    expect(impl.kind).toBe('implementation');
    expect(impl.shouldPlan).toBe(false);
    expect(impl.shouldVerify).toBe(true);
  });

  it('classifies UI polish requests with typos as implementation work', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const result = analyzeTask(
      '@src/utils/kitchen-status.ts Can you imporve the Ui and UX of this file and also its child compoenents, cards and all',
      'agent'
    );

    expect(result.kind).toBe('implementation');
    expect(result.shouldPlan).toBe(false);
    expect(result.shouldVerify).toBe(true);
  });

  it('treats short product/action trigger words as implementation work', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const result = analyzeTask('need animated enterprise landing page UI', 'agent');

    expect(result.kind).toBe('implementation');
    expect(result.shouldPlan).toBe(false);
    expect(result.shouldVerify).toBe(true);
  });

  it('plans broad documentation feature work', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const result = analyzeTask('add docs for all ffb-mui features', 'agent');

    expect(result.kind).toBe('docs');
    expect(result.complexity).toBe('medium');
    expect(result.shouldPlan).toBe(true);
    expect(result.shouldVerify).toBe(false);
  });

  it('routes single-file day/row appends as direct simple edits', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const result = analyzeTask(
      'Can you add Day 17 and  18 to Add Java in Oracle Fusion learn plan',
      'agent'
    );

    expect(result.kind).toBe('simple_edit');
    expect(result.shouldPlan).toBe(false);
    expect(result.shouldVerify).toBe(true);
  });

  it('does not treat low-complexity "and" lists as full implementation work', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const result = analyzeTask('rename foo and bar in config.json', 'agent');

    expect(result.kind).toBe('simple_edit');
    expect(result.shouldPlan).toBe(false);
  });

  it('recognizes gerund/plural action-verb forms ("fixing", "entirely") instead of falling back to a question', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const result = analyzeTask(
      "Can you plan on fixing this repo entirely, mainly @ai-service? I don't need any issues and the project should be fully functional.",
      'plan'
    );

    expect(result.kind).not.toBe('question');
    expect(result.kind).toBe('implementation');
    expect(result.actIntent).toBe('bugfix');
    expect(result.shouldPlan).toBe(true);
  });
});

describe('contextRelevance', () => {
  it('includes diagnostics only for error-fix requests', async () => {
    const { isDiagnosticsRelevant } = await import('../src/features/ce/context/contextRelevance');
    expect(isDiagnosticsRelevant('fix the type errors in auth.ts')).toBe(true);
    expect(isDiagnosticsRelevant('list unused files and dependencies')).toBe(false);
  });

  it('skips passive editor context unless the file is mentioned', async () => {
    const { isFileContextRelevant } = await import('../src/features/ce/context/contextRelevance');
    expect(isFileContextRelevant('clean up unused deps', 'src/screens/DineInKanban.tsx')).toBe(false);
    expect(isFileContextRelevant('fix DineInKanban.tsx imports', 'src/screens/DineInKanban.tsx')).toBe(true);
  });

  it('excludes internal agent log files from passive editor context', async () => {
    const { isFileContextRelevant, isInternalAgentPath } = await import('../src/features/ce/context/contextRelevance');
    expect(isInternalAgentPath('.thunder/logs/session.jsonl')).toBe(true);
    expect(isFileContextRelevant('add docs for all ffb-mui features', '.thunder/logs/session.jsonl')).toBe(false);
  });
});

describe('context query expansion', () => {
  it('adds docs routing and package export hints for broad docs tasks', async () => {
    const { expandContextQuery } = await import('../src/features/ce/context/contextQueryExpansion');
    const expanded = expandContextQuery('add docs for all ffb-mui features');

    expect(expanded).toContain('apps/docs/docusaurus.config.ts');
    expect(expanded).toContain('sidebars.ts');
    expect(expanded).toContain('packages/ffb-mui/src/index.ts');
    expect(expanded).toContain('packages/ffb-mui/src/fields/index.ts');
  });

  it('uses package-like names as indexed path search terms', async () => {
    const { extractIndexedSearchTerms } = await import('../src/features/ce/context/fuzzyFileMatch');
    expect(extractIndexedSearchTerms('add docs for all ffb-mui features')).toContain('ffb-mui');
  });
});

describe('taskKind', () => {
  it('detects audit/cleanup tasks', async () => {
    const { isAuditCleanupTask } = await import('../src/features/ce/runtime/taskKind');
    expect(isAuditCleanupTask('identify and remove unused files and dependencies')).toBe(true);
    expect(isAuditCleanupTask('what does this project do?')).toBe(false);
  });
});

describe('TaskAnalyzer', () => {
  it('does not re-plan approval continuations', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const result = analyzeTask('Continue the current approved task from where it paused.\nOriginal user request: refactor app', 'agent');
    expect(result.shouldPlan).toBe(false);
    expect(result.summary).toContain('resume');
  });

  it('classifies cleanup tasks with common typos as audit', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const result = analyzeTask(
      'Can you remove all the unsed imports and files and dependencies from the entire porject',
      'agent'
    );
    expect(result.kind).toBe('audit');
    expect(result.shouldPlan).toBe(true);
    expect(result.shouldUseSubagents).toBe(false);
  });

  it('enables subagents for medium-complexity implementation tasks with multi-file signal', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const result = analyzeTask(
      'Fix the bug in api/routes.ts, update models/user.ts, and also check utils/helper.ts imports for correctness',
      'agent'
    );
    expect(result.kind).toBe('implementation');
    expect(result.complexity).toBe('medium');
    expect(result.shouldUseSubagents).toBe(true);
  });

  it('does not enable subagents for medium-complexity implementation tasks without multi-file/multi-step signal', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const result = analyzeTask(
      'Refactor the authentication module to improve readability and use consistent naming everywhere across the whole codebase for maintainability purposes today',
      'agent'
    );
    expect(result.kind).toBe('implementation');
    expect(result.complexity).toBe('medium');
    expect(result.shouldUseSubagents).toBe(false);
  });
});

describe('auditRouting', () => {
  it('detects dependency enumeration subagent tasks', async () => {
    const { isDependencyEnumerationTask, estimateSubagentAuditSeconds, estimateScriptAuditSeconds } =
      await import('../src/features/ce/runtime/auditRouting');
    expect(isDependencyEnumerationTask('Check each of the 64 npm dependencies for usage')).toBe(true);
    expect(isDependencyEnumerationTask('Find unused dependencies in package.json')).toBe(true);
    expect(isDependencyEnumerationTask('Map the src folder structure')).toBe(false);
    expect(estimateSubagentAuditSeconds(64)).toBeGreaterThan(60);
    expect(estimateScriptAuditSeconds()).toBeLessThan(10);
  });

  it('blocks spawn_research_agent for dependency audits', async () => {
    const { createSpawnResearchAgentTool } = await import('../src/features/ce/tools/builtinTools');
    const tool = createSpawnResearchAgentTool();
    const result = await tool.execute({
      task: 'Check all unused npm dependencies listed in package.json (18 prod, 46 dev)',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('audit-dependencies.mjs');
    expect(result.output.toLowerCase()).toContain('subagent blocked');
  });

  it('blocks spawn_research_agent for unused imports audit', async () => {
    const { createSpawnResearchAgentTool } = await import('../src/features/ce/tools/builtinTools');
    const tool = createSpawnResearchAgentTool();
    const result = await tool.execute({
      task: 'Audit unused imports within source files. Look at each .ts file and identify imports never used.',
      focus: 'unused imports within source files',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('execute_workspace_script');
  });

  it('blocks Audit unused npm dependencies task from log', async () => {
    const { isDependencyEnumerationTask } = await import('../src/features/ce/runtime/auditRouting');
    const task =
      'Audit unused npm dependencies in this project. For each dependency in package.json, search whether it is actually imported';
    expect(isDependencyEnumerationTask(task)).toBe(true);
  });

  it('routes vulnerability / CVE tasks to audit-vulnerabilities script', async () => {
    const {
      isVulnerabilityAuditTask,
      buildScriptFirstAuditMessage,
    } = await import('../src/features/ce/runtime/auditRouting');
    expect(isVulnerabilityAuditTask('Can you check the vulnerabilities in my package.json?')).toBe(true);
    expect(isVulnerabilityAuditTask('Find unused dependencies')).toBe(false);
    const msg = buildScriptFirstAuditMessage('check vulnerabilities and use web to check online');
    expect(msg).toContain('audit-vulnerabilities.mjs');
    expect(msg).toContain('fetch_web');
    expect(msg).not.toMatch(/Preferred:\n1\. `execute_workspace_script\(\{ script: "audit-dependencies\.mjs" \}\)`/);
  });
});

describe('shouldUsePlanner', () => {
  it('skips planner for audit tasks in act mode', async () => {
    const { shouldUsePlanner } = await import('../src/features/ce/orchestration/ChatOrchestrator');
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const analysis = analyzeTask('remove unused imports and dependencies', 'agent');
    expect(analysis.kind).toBe('audit');
    expect(shouldUsePlanner('agent', analysis, true, true)).toBe(false);
    expect(shouldUsePlanner('agent', analysis, true, false)).toBe(true);
    expect(shouldUsePlanner('plan', analysis, true, true)).toBe(true);
  });

  it('removes plan-only tools from direct agent runs', async () => {
    const { filterDirectAgentTools, shouldRunDirectFinalValidation } = await import('../src/features/ce/orchestration/ChatOrchestrator');
    const tools = [
      { type: 'function', function: { name: 'read_file', description: '', parameters: {} } },
      { type: 'function', function: { name: 'mark_step_complete', description: '', parameters: {} } },
      { type: 'function', function: { name: 'propose_plan_mutation', description: '', parameters: {} } },
      { type: 'function', function: { name: 'apply_patch', description: '', parameters: {} } },
    ] as const;

    expect(filterDirectAgentTools([...tools]).map((tool) => tool.function.name)).toEqual([
      'read_file',
      'apply_patch',
    ]);
    expect(shouldRunDirectFinalValidation('simple_edit')).toBe(false);
    expect(shouldRunDirectFinalValidation('simple_edit', ['README.md'])).toBe(false);
    expect(shouldRunDirectFinalValidation('simple_edit', ['apps/docs/docs/ffb-mui/example.mdx'])).toBe(true);
    expect(shouldRunDirectFinalValidation('implementation')).toBe(true);
  });
});

describe('AgentTaskState', () => {
  it('blocks repeated depcheck after analyze completes', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.setTaskContext('audit', 'Audit/cleanup task', 'remove unused dependencies');
    state.recordToolSuccess('run_command', { command: 'npx depcheck' }, 'Unused: foo');
    expect(state.getPhase()).toBe('execute');
    const blocked = state.checkBlocked('run_command', { command: 'npx depcheck --ignores=x' });
    expect(blocked).toContain('depcheck');
    const soft = state.buildSoftBlockResponse('run_command', { command: 'npx depcheck --ignores=x' });
    expect(soft).toContain('confirmed cleanup changes');
    expect(soft).toContain('package.json');
  });

  it('allows depcheck again after write_file', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.setTaskContext('audit', 'Audit/cleanup task', 'remove unused dependencies');
    state.recordToolSuccess('run_command', { command: 'npx depcheck' }, 'Unused: foo');
    state.recordToolSuccess('write_file', { path: 'package.json' }, 'Wrote file');
    const blocked = state.checkBlocked('run_command', { command: 'npx depcheck' });
    expect(blocked).toBeNull();
  });

  it('blocks repeated verification after edits already verified', async () => {
    const { AgentTaskState, normalizeDiagnosticKey } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.setTaskContext(
      'simple_edit',
      'Compiler/runtime error in apps/docs/src/components/live-demo-mui.tsx',
      "Module not found: Error: Can't resolve 'ffb-mui'"
    );
    state.recordToolSuccess('apply_patch', { path: 'apps/docs/src/components/live-demo-mui.tsx' }, 'Patch applied');
    state.recordToolSuccess(
      'run_command',
      { command: 'cd apps/docs && npm run build 2>&1 | grep -i "cannot find module" || echo "No errors"' },
      'No errors'
    );

    const soft = state.buildSoftBlockResponse('run_command', {
      command: 'cd apps/docs && npm run build 2>&1 | grep -i "cannot find module" || echo "No errors"',
    });

    expect(soft).toContain('already succeeded after edits');
    expect(soft).toContain('Stop using tools now');
    expect(soft).toContain('Cached evidence reference');
    expect(soft).not.toContain('\nNo errors\n');
    expect(normalizeDiagnosticKey('cd packages/ffb-mui && npm run build:types')).toBe('build:packages/ffb-mui');
    expect(normalizeDiagnosticKey('cd apps/docs && npm run build')).toBe('docs-build:apps/docs');
    expect(normalizeDiagnosticKey('cd ai-service && npx tsc --noEmit')).toBe('tsc:ai-service');
    expect(normalizeDiagnosticKey('cd frontend && npx tsc --noEmit')).toBe('tsc:frontend');
  });

  it('does not let a single-file tsc success satisfy whole-project verification', async () => {
    const { AgentTaskState, normalizeDiagnosticKey } = await import('../src/features/ce/runtime/AgentTaskState');

    // A file-targeted invocation must get a distinct cache key from the project-wide one,
    // so it can never be looked up as evidence the project build passed (bug1.md: this
    // conflation let the agent declare a failing `pnpm run build` fixed).
    expect(
      normalizeDiagnosticKey(
        'cd ai-service && npx tsc --noEmit --skipLibCheck src/features/document-parser/types/resume-parser.types.ts'
      )
    ).toBe('tsc-files:ai-service');
    expect(normalizeDiagnosticKey('cd ai-service && npx tsc --noEmit')).toBe('tsc:ai-service');
    expect(normalizeDiagnosticKey('cd ai-service && npx tsc --noEmit -p tsconfig.json')).toBe('tsc:ai-service');

    const state = new AgentTaskState();
    state.setTaskContext('debugging', 'Fix ai-service build errors', 'fix all the issues in @ai-service');
    state.recordToolSuccess('apply_patch', { path: 'ai-service/src/types/shared/resume-parser.types.ts' }, 'Patch applied');
    state.recordToolSuccess(
      'run_command',
      { command: 'cd ai-service && npx tsc --noEmit --skipLibCheck src/types/shared/resume-parser.types.ts' },
      'no errors'
    );

    // The single-file check must not be reported back to the model as "verification
    // complete" — it should still be told to run the real project build.
    const soft = state.buildSoftBlockResponse('run_command', {
      command: 'cd ai-service && npx tsc --noEmit --skipLibCheck src/types/shared/resume-parser.types.ts',
    });
    expect(soft ?? '').not.toContain('already succeeded after edits');
    expect(soft ?? '').not.toContain('Verification for this task is complete');

    // A subsequent project-wide build failure must still be actionable (not treated as an
    // already-completed duplicate of the narrower file check).
    const projectBuildBlocked = state.checkBlocked('run_command', { command: 'cd ai-service && pnpm run build' });
    expect(projectBuildBlocked).toBeNull();
  });

  it('builds pause summary with next step hint', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.setTaskContext('audit', 'Audit/cleanup task', 'remove unused dependencies');
    state.recordToolSuccess('run_command', { command: 'npx depcheck' }, 'Unused dependencies\n* @date-io/dayjs');
    const summary = state.buildPauseSummary('remove unused deps', 'audit');
    expect(summary).toContain('@date-io/dayjs');
    expect(summary).toContain('Next step');
  });

  it('returns soft block with cached eslint output in execute phase', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.recordToolSuccess('run_command', { command: 'npx eslint src/' }, 'no-unused-vars: 3 errors');
    expect(state.getPhase()).toBe('execute');
    const soft = state.buildSoftBlockResponse('run_command', { command: 'npx eslint src/' });
    expect(soft).toContain('(Skipped run_command — reason:duplicate — phase: execute)');
    expect(soft).toContain('Cached evidence reference');
    expect(soft).not.toContain('no-unused-vars');
    expect(soft).toContain('smallest exact next action');
    expect(soft).not.toContain('package.json');
  });

  it('uses MDX repair guidance instead of audit cleanup guidance', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.setTaskContext(
      'simple_edit',
      'MDX/Docusaurus compilation error in apps/docs/docs/ffb-mui/api/formik-renderer.md',
      'Error: MDX compilation failed for file "apps/docs/docs/ffb-mui/api/formik-renderer.md"'
    );
    state.recordToolSuccess('run_command', { command: 'rg -n "Record<string, any>" apps/docs/docs/ffb-mui' }, 'formik-renderer.md:17');
    const soft = state.buildSoftBlockResponse('run_command', { command: 'rg -n "Record<string, any>" apps/docs/docs/ffb-mui' });
    expect(soft).toContain('MDX repair loop');
    expect(soft).toContain('Read the exact MDX file');
    expect(soft).toContain('Unexpected character `,` in name');
    expect(soft).toContain('Could not parse expression with acorn');
    expect(soft).toContain('form-builder.md');
    expect(soft).toContain('Run the docs build');
    expect(soft).not.toContain('Remove unused dependencies');
    expect(state.buildApprovalResumeInstruction()).toContain('fix only the next exact MDX/Docusaurus failure');
  });

  it('blocks repeated read_file after first successful read', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.setFileScope(['apps/docs/docusaurus.config.ts']);
    state.recordToolSuccess('read_file', { path: 'apps/docs/docusaurus.config.ts' }, 'export default {}');
    const blocked = state.checkBlocked('read_file', { path: 'apps/docs/docusaurus.config.ts' });
    expect(blocked).toContain('Already read');
    const soft = state.buildSoftBlockResponse('read_file', { path: 'apps/docs/docusaurus.config.ts' });
    expect(soft).toContain('Cached evidence reference');
    expect(soft).not.toContain('export default');
  });

  it('invalidates read cache after apply_patch', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.setFileScope(['src/foo.ts']);
    state.recordToolSuccess('read_file', { path: 'src/foo.ts' }, 'const x = 1');
    state.recordToolSuccess('apply_patch', { path: 'src/foo.ts' }, 'Patched');
    expect(state.checkBlocked('read_file', { path: 'src/foo.ts' })).toBeNull();
  });

  it('requires proposed file scope before reads and edits', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    expect(state.checkFileScopeBlocked('read_file', { path: 'src/foo.ts' })).toContain('propose_file_scope');
    state.setFileScope(['src/foo.ts', 'src/other.ts'], 1);
    expect(state.checkFileScopeBlocked('read_file', { path: 'src/foo.ts' })).toBeNull();
    expect(state.checkFileScopeBlocked('write_file', { path: 'src/bar.ts' })).toContain('outside the accepted file scope');
    state.recordToolSuccess('read_file', { path: 'src/foo.ts' }, 'const x = 1');
    expect(state.checkFileScopeBlocked('read_file', { path: 'src/foo.ts' })).toBeNull();
    expect(state.checkFileScopeBlocked('read_file', { path: 'src/other.ts' })).toContain('File read budget exceeded');
  });

  it('expands an exhausted read budget when a later plan step adds valid scope', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.setFileScope(['src/a.ts'], 1);
    state.recordToolSuccess('read_file', { path: 'src/a.ts' }, 'a');
    state.mergeFileScope(['src/b.ts', 'src/c.ts'], 2);

    expect(state.checkFileScopeBlocked('read_file', { path: 'src/b.ts' })).toBeNull();
    expect(state.getFileScopeSnapshot().maxFilesRead).toBeGreaterThanOrEqual(3);
  });

  it('allows propose_file_scope access upgrades for the same path', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.recordToolSuccess(
      'propose_file_scope',
      { candidates: [{ path: 'frontend/src/app/api/stripe/checkout/route.ts', intent: 'read' }] },
      'accepted'
    );
    expect(
      state.checkBlocked('propose_file_scope', {
        candidates: [{ path: 'frontend/src/app/api/stripe/checkout/route.ts', intent: 'read' }],
      })
    ).toContain('already');
    expect(
      state.checkBlocked('propose_file_scope', {
        candidates: [{ path: 'frontend/src/app/api/stripe/checkout/route.ts', intent: 'write' }],
      })
    ).toBeNull();
  });

  it('blocks stale diagnostic log files as current evidence', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const { isStaleDiagnosticLogPath } = await import('../src/features/ce/pipeline/classify/artifactClassifier');
    expect(isStaleDiagnosticLogPath('build-error.log')).toBe(true);
    expect(isStaleDiagnosticLogPath('.mitii-state.json')).toBe(true);
    expect(isStaleDiagnosticLogPath('ai-service/src/index.ts')).toBe(false);

    const state = new AgentTaskState();
    state.setFileScope(['build-error.log', 'ai-service/src/index.ts']);
    expect(state.checkFileScopeBlocked('read_file', { path: 'build-error.log' })).toContain('Stale diagnostic log');
    expect(state.checkFileScopeBlocked('read_file', { path: 'ai-service/src/index.ts' })).toBeNull();
  });

  it('blocks reloading .mitii-state.json on a new task turn, but allows it on an explicit resume', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();

    state.setTaskContext('implementation', 'Fix ai-service build', 'fix all issues in @ai-service');
    expect(
      state.checkBlocked('execute_workspace_script', { script: 'read-checkpoint.sh' })
    ).toContain('not a resume');
    expect(
      state.checkBlocked('run_command', { command: 'bash scripts/read-checkpoint.sh' })
    ).toContain('not a resume');
    // Writing a checkpoint is unrelated to reload safety and must never be blocked.
    expect(
      state.checkBlocked('execute_workspace_script', { script: 'write-checkpoint.sh' })
    ).toBeNull();

    state.setTaskContext('implementation', 'Resume saved plan', 'fix all issues in @ai-service', true);
    expect(
      state.checkBlocked('execute_workspace_script', { script: 'read-checkpoint.sh' })
    ).toBeNull();
  });

  it('rejects mismatched checkpoint identity before resume', async () => {
    const { canResumeCheckpoint, hashCheckpointGoal } = await import('../src/features/ce/runtime/checkpointIdentity');
    const goalHash = hashCheckpointGoal('fix all issues in @ai-service');
    expect(
      canResumeCheckpoint(
        {
          targetProjectId: 'frontend',
          goalHash: 'old-frontend-goal',
          planId: 'plan-1',
          branch: 'main',
          commit: 'abc123',
        },
        { targetProjectId: 'ai-service', goalHash, planId: 'plan-2' }
      )
    ).toEqual(expect.objectContaining({
      ok: false,
      code: 'CHECKPOINT_TASK_MISMATCH',
    }));
    expect(
      canResumeCheckpoint(
        { targetProjectId: 'ai-service', goalHash, planId: 'plan-2', branch: 'main', commit: 'abc123' },
        { targetProjectId: 'ai-service', goalHash, planId: 'plan-2', branch: 'main', baseCommit: 'abc123' }
      )
    ).toEqual({ ok: true });
    expect(
      canResumeCheckpoint(
        { plan: 'old frontend stripe findings', findings: 'build-error.log' },
        { targetProjectId: 'ai-service' }
      )
    ).toEqual(expect.objectContaining({
      ok: false,
      code: 'CHECKPOINT_MISSING_IDENTITY',
    }));
  });

  it('scopes repository profiles to the requested project root', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { WorkspaceRepositoryProfileProvider } = await import('../src/features/ce/skills/RepositoryProfileProvider');

    const tempDir = mkdtempSync(join(tmpdir(), 'mitii-profile-scope-'));
    try {
      mkdirSync(join(tempDir, 'ai-service'), { recursive: true });
      mkdirSync(join(tempDir, 'frontend'), { recursive: true });
      writeFileSync(join(tempDir, 'ai-service/package.json'), JSON.stringify({
        name: 'ai-service',
        dependencies: { fastify: '^4.0.0' },
      }));
      writeFileSync(join(tempDir, 'ai-service/index.ts'), 'export {}');
      writeFileSync(join(tempDir, 'frontend/package.json'), JSON.stringify({
        name: 'frontend',
        dependencies: { next: '^14.0.0', react: '^18.0.0' },
      }));
      writeFileSync(join(tempDir, 'frontend/page.tsx'), 'export default function Page() { return null }');

      const provider = new WorkspaceRepositoryProfileProvider(tempDir);
      const whole = provider.getProfile();
      const scoped = provider.getProfile('ai-service');

      expect(whole.frameworks).toEqual(expect.arrayContaining(['fastify', 'nextjs', 'react']));
      expect(scoped.frameworks).toEqual(['fastify']);
      expect(scoped.frameworks).not.toContain('react');
      expect(scoped.frameworks).not.toContain('nextjs');
      expect(scoped.paths.every((path) => path === 'ai-service' || path.startsWith('ai-service/'))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('clears forced synthesis between structured plan step loops', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.markForceSynthesis();
    expect(state.shouldForceSynthesis()).toBe(true);
    state.beginAgentLoop();
    expect(state.shouldForceSynthesis()).toBe(false);
  });

  it('parses and gates JSON intent classifications', async () => {
    const {
      classifyIntent,
      classifyIntentFastPath,
      gateIntentClassification,
      parseIntentClassification,
      safeDefaultIntent,
    } = await import('../src/features/ce/runtime/intentClassifier');
    const parsed = parseIntentClassification(
      '{"intent":"docs","confidence":0.82,"alternatives":[{"intent":"feature","confidence":0.4},{"intent":"feature","confidence":0.6}]}',
      ['bugfix', 'feature', 'docs'] as const
    );
    expect(parsed).toMatchObject({ intent: 'docs', confidence: 0.82, source: 'llm' });
    expect(parsed.alternatives).toEqual([{ intent: 'feature', confidence: 0.6 }]);

    const gated = gateIntentClassification(
      {
        intent: 'feature' as const,
        confidence: 0.3,
        alternatives: [],
        needsClarification: false,
        source: 'llm' as const,
      },
      'agent',
      'question' as const
    );
    expect(gated.intent).toBe('feature');
    expect(gated.needsClarification).toBe(true);

    const fallback = gateIntentClassification(
      {
        intent: 'docs' as const,
        confidence: 0.6,
        alternatives: [{ intent: 'feature' as const, confidence: 0.35 }],
        needsClarification: false,
        source: 'llm' as const,
      },
      'agent',
      'question' as const
    );
    expect(fallback).toMatchObject({
      intent: 'question',
      confidence: 0,
      source: 'fallback',
      originalIntent: 'docs',
      originalConfidence: 0.6,
      gated: true,
    });

    const clarification = gateIntentClassification(
      {
        intent: 'docs' as const,
        confidence: 0.98,
        alternatives: [],
        needsClarification: true,
        source: 'llm' as const,
      },
      'agent',
      'question' as const
    );
    expect(clarification).toMatchObject({
      intent: 'docs',
      needsClarification: true,
      gated: false,
    });

    const logPath = classifyIntentFastPath(
      'agent',
      String.raw`Analyze C:\project\.mitii\logs`,
      ['bugfix', 'log_audit', 'audit'] as const
    );
    expect(logPath).toMatchObject({
      intent: 'log_audit',
      source: 'fast_path',
      matchedRule: 'log target + analysis verb',
    });

    expect(classifyIntentFastPath(
      'agent',
      'Audit authentication security',
      ['audit', 'question'] as const
    )).toBeNull();
    expect(classifyIntentFastPath(
      'agent',
      'Execute the saved plan',
      ['feature', 'question'] as const
    )).toBeNull();

    expect(() => parseIntentClassification(
      '{"intent":"docs","confidence":0.9} {"intent":"feature","confidence":0.8}',
      ['docs', 'feature'] as const
    )).not.toThrow();
    const finalJson = parseIntentClassification(
      '<think>Maybe {"intent":"feature","confidence":0.91}</think>\n{"intent":"bugfix","confidence":0.92,"alternatives":[]}',
      ['bugfix', 'feature', 'docs'] as const
    );
    expect(finalJson).toMatchObject({ intent: 'bugfix', confidence: 0.92 });
    expect(() => parseIntentClassification(
      '{"intent":"docs","confidence":0.9,"unexpected":true}',
      ['docs', 'feature'] as const
    )).toThrow();
    expect(() => parseIntentClassification(
      '{"intent":"docs","confidence":0.9',
      ['docs', 'feature'] as const
    )).toThrow(/complete JSON object/);
    expect(() => safeDefaultIntent('ask', [])).toThrow(/at least one allowed intent/);

    let providerCalled = false;
    const blank = await classifyIntent(
      {
        id: 'test',
        capabilities: {
          contextWindow: 8_192,
          supportsTools: false,
          supportsVision: false,
          supportsReasoning: false,
          supportsStreaming: true,
          supportsEmbeddings: false,
        },
        async *complete() {
          providerCalled = true;
          yield { content: '{}' };
        },
      },
      'ask',
      '   ',
      ['explain_code', 'general_knowledge'] as const,
      {
        explain_code: 'Explain code.',
        general_knowledge: 'Answer general knowledge.',
      }
    );
    expect(providerCalled).toBe(false);
    expect(blank).toMatchObject({
      intent: 'explain_code',
      confidence: 0,
      needsClarification: true,
      source: 'fallback',
      gateReason: 'empty_message',
    });

    await expect(classifyIntent(
      {
        id: 'test',
        capabilities: {
          contextWindow: 8_192,
          supportsTools: false,
          supportsVision: false,
          supportsReasoning: false,
          supportsStreaming: true,
          supportsEmbeddings: false,
        },
        async *complete() {
          yield { content: '{}' };
        },
      },
      'ask',
      'Explain this',
      ['explain_code'] as const,
      {} as never
    )).rejects.toThrow(/Missing intent description: explain_code/);
  });

  it('keeps intent-classifier fast paths narrow and punctuation-safe', async () => {
    const { classifyIntentFastPath } = await import('../src/features/ce/runtime/intentClassifier');

    expect(classifyIntentFastPath(
      'plan',
      'okay',
      ['question', 'bugfix'] as const
    )).toMatchObject({
      intent: 'question',
      matchedRule: 'short acknowledgement or greeting',
    });
    expect(classifyIntentFastPath(
      'plan',
      'okay fix the test',
      ['question', 'bugfix'] as const
    )).toBeNull();

    for (const message of [
      'What is knip?',
      'Explain how depcheck works.',
      'Is ts-prune reliable?',
      'Remove unused variable from this function.',
    ]) {
      expect(classifyIntentFastPath(
        'agent',
        message,
        ['audit', 'question'] as const
      )).toBeNull();
    }

    for (const message of [
      'Run knip',
      'Find unused imports',
      'Scan dead code',
      'Audit dependencies',
    ]) {
      expect(classifyIntentFastPath(
        'agent',
        message,
        ['audit', 'question'] as const
      )).toMatchObject({
        intent: 'audit',
        source: 'fast_path',
        matchedRule: 'explicit dependency or dead-code cleanup',
      });
    }

    for (const message of [
      'Analyze session.jsonl.',
      'Review agent.jsonl,',
      'Inspect .mitii/logs/session.jsonl:',
    ]) {
      expect(classifyIntentFastPath(
        'agent',
        message,
        ['bugfix', 'log_audit', 'audit'] as const
      )).toMatchObject({
        intent: 'log_audit',
        source: 'fast_path',
        matchedRule: 'log target + analysis verb',
      });
    }
  });

  it('resolves state-aware control intent before domain routing', async () => {
    const { resolveControlIntent } = await import('../src/features/ce/runtime/controlIntent');

    expect(resolveControlIntent('yes', { hasPendingApproval: true }).intent).toBe('approve_pending');
    expect(resolveControlIntent('yes').intent).toBe('acknowledgement');
    expect(resolveControlIntent('continue', { hasActiveTask: true }).intent).toBe('continue_task');
    expect(resolveControlIntent('continue').intent).toBe('clarify_previous');
    expect(resolveControlIntent('?', { hasActiveTask: true }).intent).toBe('clarify_previous');
    expect(resolveControlIntent('cancel', { hasActiveTask: true }).intent).toBe('cancel_task');
    expect(resolveControlIntent('Update README.md').intent).toBe('new_task');
  });

  it('caps sequential-thinking MCP calls', async () => {
    const { AgentTaskState } = await import('../src/features/ce/runtime/AgentTaskState');
    const state = new AgentTaskState();
    state.setLimits({ maxSequentialThinkingCalls: 2 });
    state.recordToolSuccess('mcp__sequential-thinking__sequentialthinking', {}, 'thought 1');
    state.recordToolSuccess('mcp__sequential-thinking__sequentialthinking', {}, 'thought 2');
    expect(state.checkMcpCap('mcp__sequential-thinking__sequentialthinking')).toContain('cap');
  });
});

describe('tool input coercion', () => {
  it('coerces JSON string arrays for read_files paths', async () => {
    const { normalizeToolInput } = await import('../src/kernel/tools/coerceInput');
    const { stringArray } = await import('../src/kernel/tools/coerceInput');
    const schema = stringArray(1, 12);
    const normalized = normalizeToolInput('read_files', {
      paths: '["package.json","src/App.tsx"]',
    });
    const parsed = schema.safeParse((normalized as { paths: unknown }).paths);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(['package.json', 'src/App.tsx']);
    }
  });

  it('coerces search_batch queries sent as JSON string', async () => {
    const { stringArray } = await import('../src/kernel/tools/coerceInput');
    const schema = stringArray(1, 10);
    const parsed = schema.safeParse('["@date-io/dayjs","escpos-usb"]');
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(2);
    }
  });

  it('repairs a misspelled propose_file_scope field name instead of failing schema validation', async () => {
    const { normalizeToolInput } = await import('../src/kernel/tools/coerceInput');
    const normalized = normalizeToolInput('propose_file_scope', {
      objecive: 'Fix the broken relative imports',
      candidatePaths: '["ai-service/src/foo.ts","ai-service/src/bar.ts"]',
    }) as { objective?: string; candidates?: unknown };

    expect(normalized.objective).toBe('Fix the broken relative imports');
    expect(normalized.candidates).toBe('["ai-service/src/foo.ts","ai-service/src/bar.ts"]');
  });
});

describe('PlanActEngine read-only shell', () => {
  it('allows inspection commands in plan mode', async () => {
    const { classifyCommandEffect, inferTouchedFilesFromCommand, isShellAllowed, isReadOnlyCommand, isToolAllowedInPlanPhase, stripLeadingCd } = await import('../src/features/ce/plans/PlanActEngine');
    expect(isReadOnlyCommand('npx depcheck')).toBe(true);
    expect(isReadOnlyCommand('cd /home/user && rg "foo" src')).toBe(true);
    expect(isReadOnlyCommand("sed -n '70,90p' src/screens/printer/printer.tsx")).toBe(true);
    expect(isReadOnlyCommand("grep -n 'uuid\\|randomUUID' src/screens/printer/printer.tsx")).toBe(true);
    expect(isReadOnlyCommand('npx tsc --noEmit')).toBe(true);
    expect(isReadOnlyCommand('npm run compile')).toBe(true);
    expect(isReadOnlyCommand('npx docusaurus build')).toBe(true);
    expect(isReadOnlyCommand('cd apps/docs && npm run build 2>&1 | head -50')).toBe(true);
    expect(isReadOnlyCommand('npx vitest run')).toBe(true);
    expect(isReadOnlyCommand('npx vitest')).toBe(false);
    expect(isReadOnlyCommand('npm run verify')).toBe(true);
    expect(isReadOnlyCommand('npm run doctor')).toBe(true);
    expect(isReadOnlyCommand('pnpm validate')).toBe(true);
    expect(isReadOnlyCommand('pnpm audit --json')).toBe(true);
    expect(isReadOnlyCommand('pnpm outdated --filter frontend')).toBe(true);
    expect(isReadOnlyCommand('cd frontend && pnpm audit --json 2>&1 | head -300')).toBe(true);
    expect(isReadOnlyCommand('yarn outdated')).toBe(true);
    expect(isReadOnlyCommand('yarn audit --json')).toBe(true);
    expect(isReadOnlyCommand('cat .mitii/logs/a.jsonl | python3 -c "import sys; print(sys.stdin.read()[:10])"')).toBe(true);
    expect(isReadOnlyCommand('python3 -c "open(\'x\',\'w\').write(\'nope\')"')).toBe(false);
    expect(isReadOnlyCommand('for f in logs/*.jsonl; do grep error "$f"; done')).toBe(true);
    expect(stripLeadingCd('cd /home/user && npm ls')).toBe('npm ls');
    expect(isShellAllowed('plan', 'npx depcheck')).toBe(true);
    expect(isShellAllowed('ask', 'npx depcheck')).toBe(true);
    expect(isShellAllowed('ask', 'pnpm audit --json')).toBe(true);
    expect(isShellAllowed('plan', 'pnpm outdated')).toBe(true);
    expect(isShellAllowed('plan', 'npm install lodash')).toBe(false);
    expect(isShellAllowed('ask', 'npm install lodash')).toBe(false);
    expect(isToolAllowedInPlanPhase('execute', 'run_command', { command: 'npm run build' }).allowed).toBe(true);
    expect(isToolAllowedInPlanPhase('verify', 'run_command', { command: 'npm run build' }).allowed).toBe(true);
    expect(isToolAllowedInPlanPhase('diagnostics', 'run_command', { command: 'npm run build' }).allowed).toBe(true);
    expect(isToolAllowedInPlanPhase('verify', 'run_command', { command: 'node scripts/custom-mutator.js' }).allowed).toBe(false);
    expect(classifyCommandEffect('rg "foo" src')).toBe('inspect_only');
    expect(classifyCommandEffect('npm run build')).toBe('verification_with_artifacts');
    expect(classifyCommandEffect('pnpm run build')).toBe('verification_with_artifacts');
    expect(classifyCommandEffect('pnpm --filter frontend run build')).toBe('verification_with_artifacts');
    expect(classifyCommandEffect('cd ai-service && pnpm exec tsc --noEmit')).toBe('inspect_only');
    expect(classifyCommandEffect('pnpm run build > /tmp/ai-service-build.log 2>&1')).toBe('verification_with_artifacts');
    expect(classifyCommandEffect('npx tsc --noEmit > /dev/null 2>&1')).toBe('inspect_only');
    expect(classifyCommandEffect('pnpm run build > build-output.log')).toBe('workspace_mutation');
    expect(classifyCommandEffect('npm install lodash')).toBe('dependency_mutation');
    expect(classifyCommandEffect('git checkout -- src/index.ts')).toBe('workspace_mutation');
    expect(classifyCommandEffect('git restore -- src/index.ts src/routes.ts')).toBe('workspace_mutation');
    expect(inferTouchedFilesFromCommand('git restore -- src/index.ts src/routes.ts')).toEqual(['src/index.ts', 'src/routes.ts']);
    expect(classifyCommandEffect("sed -i 's/foo/bar/' src/jd-parser/services/jd-parser-service.ts")).toBe('workspace_mutation');
    expect(inferTouchedFilesFromCommand("sed -i 's/foo/bar/' src/jd-parser/services/jd-parser-service.ts")).toEqual([
      'src/jd-parser/services/jd-parser-service.ts',
    ]);
    expect(inferTouchedFilesFromCommand("sed -i '' 's/foo/bar/' src/a.ts src/b.ts")).toEqual(['src/a.ts', 'src/b.ts']);
    expect(inferTouchedFilesFromCommand('rm ai-service/src/jd-parser/services/base-ai-service.ts')).toEqual([
      'ai-service/src/jd-parser/services/base-ai-service.ts',
    ]);
  });

  it('classifies step phases without treating all build steps as verification', async () => {
    const { inferStepPhase, normalizeDeclaredStepPhase, resolveStepPhaseLock, stepImpliesWrite } = await import('../src/features/ce/plans/PlanActEngine');
    expect(inferStepPhase('Capture exact ai-service build errors', 0)).toBe('diagnostics');
    expect(inferStepPhase('Run pnpm run build and capture errors', 0)).toBe('diagnostics');
    expect(inferStepPhase('Build the new settings component', 1)).toBe('execute');
    expect(inferStepPhase('Run the production build', 3)).toBe('verify');
    expect(normalizeDeclaredStepPhase({
      title: 'Run pnpm run build and capture errors',
      phase: 'verify',
    }, 0, 'agent')).toBe('diagnostics');
    expect(stepImpliesWrite({ title: 'Capture exact ai-service build errors' })).toBe(false);
    expect(stepImpliesWrite({ title: 'Audit Current Implementation & Identify Bugs' })).toBe(false);
    expect(stepImpliesWrite({ title: 'Fix ReferenceError & Prepare Theme Utilities' })).toBe(true);
    expect(
      resolveStepPhaseLock(
        { title: 'Fix ReferenceError & Prepare Theme Utilities', phase: 'diagnostics' },
        'agent'
      )
    ).toBe('execute');
    expect(
      resolveStepPhaseLock(
        { title: 'Audit Current Implementation & Identify Bugs', phase: 'diagnostics' },
        'agent'
      )
    ).toBe('diagnostics');
    expect(stepImpliesWrite({
      title: 'Identify and remove unused imports',
      tools: ['apply_patch'],
    })).toBe(true);
  });

  it('detects phase-lock write errors', async () => {
    const { isPhaseLockWriteError } = await import('../src/features/ce/plans/PlanActEngine');
    expect(isPhaseLockWriteError('Phase 1 (Diagnostics) is read-only; file writes are locked until Phase 3 (Execute).')).toBe(true);
    expect(isPhaseLockWriteError('Patch failed')).toBe(false);
  });

  it('detects phase-lock run_command errors', async () => {
    const { isPhaseLockRunCommandError } = await import('../src/features/ce/plans/PlanActEngine');
    expect(isPhaseLockRunCommandError('Phase 4 (Verify) allows diagnostics, lint, tests, builds, and targeted file fixes, not arbitrary shell commands.')).toBe(true);
    expect(isPhaseLockRunCommandError('Phase 1 (Diagnostics) allows only read-only shell commands.')).toBe(true);
    expect(isPhaseLockRunCommandError('Command exited with code 1')).toBe(false);
  });
});

describe('verifyCommandDiscovery', () => {
  it('skips missing npm scripts and placeholder npm tests', async () => {
    const { resolveProjectVerifyCommands } = await import('../src/features/ce/runtime/verifyCommandDiscovery');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-verify-npm-test-'));
    try {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
          typecheck: 'tsc --noEmit',
        },
      }));

      const plan = resolveProjectVerifyCommands(tempDir, ['npm run lint', 'npm test']);

      expect(plan.commands).toEqual(['npm run typecheck']);
      expect(plan.skipped.join('\n')).toContain('script "lint" not found');
      expect(plan.skipped.join('\n')).toContain('test script is a placeholder');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the first matching docs build command from workspace suggestions', async () => {
    const { resolveProjectVerifyCommands } = await import('../src/features/ce/runtime/verifyCommandDiscovery');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-verify-docs-test-'));
    try {
      const docsDir = join(tempDir, 'apps/docs');
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        scripts: { build: 'echo root build' },
      }));
      writeFileSync(join(docsDir, 'package.json'), JSON.stringify({
        name: 'docs',
        scripts: { build: 'docusaurus build' },
      }));

      const plan = resolveProjectVerifyCommands(tempDir, [
        'cd apps/docs && npm run build',
        'npm run build --workspace docs',
        'pnpm --filter docs build',
        'npm run build',
      ]);

      expect(plan.commands).toEqual(['cd apps/docs && npm run build']);
      expect(plan.skipped.join('\n')).not.toContain('npm run build:');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('adds docs build verification when docs files changed and default verify scripts are missing', async () => {
    const { resolveProjectVerifyCommands } = await import('../src/features/ce/runtime/verifyCommandDiscovery');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-verify-docs-touched-test-'));
    try {
      const docsDir = join(tempDir, 'apps/docs');
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
        },
      }));
      writeFileSync(join(docsDir, 'package.json'), JSON.stringify({
        name: 'docs',
        scripts: { build: 'docusaurus build' },
      }));

      const plan = resolveProjectVerifyCommands(tempDir, ['npm run lint', 'npm test'], {
        touchedFiles: ['apps/docs/docs/ffb-mui/components/multi-text/basic-multi-text-example.mdx'],
      });

      expect(plan.commands).toEqual(['cd apps/docs && npm run build']);
      expect(plan.skipped.join('\n')).toContain('script "lint" not found');
      expect(plan.skipped.join('\n')).toContain('test script is a placeholder');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('auto-discovers scripts from package.json when verifyCommands is empty', async () => {
    const { resolveProjectVerifyCommands } = await import('../src/features/ce/runtime/verifyCommandDiscovery');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-verify-auto-test-'));
    try {
      mkdirSync(join(tempDir, 'src'), { recursive: true });
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        scripts: {
          typecheck: 'tsc --noEmit',
          lint: 'eslint .',
        },
      }));

      const plan = resolveProjectVerifyCommands(tempDir, [], {
        touchedFiles: ['src/index.ts'],
      });

      expect(plan.commands).toEqual(['npm run typecheck']);
      expect(plan.discoveredScripts['.']).toContain('typecheck');
      expect(plan.discoveredScripts['.']).toContain('lint');
      expect(plan.notes.some((n) => /scanned/i.test(n))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses pnpm workspace membership and does not fall back to root checks', async () => {
    const { resolveProjectVerifyCommands } = await import('../src/features/ce/runtime/verifyCommandDiscovery');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-verify-workspace-test-'));
    try {
      mkdirSync(join(tempDir, 'packages/channels/src'), { recursive: true });
      mkdirSync(join(tempDir, 'fixtures/example/src'), { recursive: true });
      writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'root',
        scripts: { lint: 'tsc --noEmit', test: 'vitest run' },
      }));
      writeFileSync(join(tempDir, 'packages/channels/package.json'), JSON.stringify({
        name: '@example/channels',
      }));
      writeFileSync(join(tempDir, 'fixtures/example/package.json'), JSON.stringify({
        name: 'fixture',
        scripts: { lint: 'exit 1' },
      }));

      const plan = resolveProjectVerifyCommands(tempDir, [], {
        touchedFiles: ['packages/channels/src/index.ts'],
      });

      expect(plan.commands).toEqual([]);
      expect(plan.discoveredScripts).toEqual({});
      expect(plan.notes.join('\n')).toContain('No package-local verification script');
      expect(plan.notes.join('\n')).not.toContain('workspace-root manifest');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('builds a workspace-wide verification matrix from pnpm members', async () => {
    const { resolveProjectVerifyCommands } = await import('../src/features/ce/runtime/verifyCommandDiscovery');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-verify-workspace-all-test-'));
    try {
      mkdirSync(join(tempDir, 'packages/web/src'), { recursive: true });
      mkdirSync(join(tempDir, 'packages/api/src'), { recursive: true });
      writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'root',
        packageManager: 'pnpm@10.13.1',
      }));
      writeFileSync(join(tempDir, 'packages/web/package.json'), JSON.stringify({
        name: 'web',
        scripts: { build: 'vite build' },
      }));
      writeFileSync(join(tempDir, 'packages/api/package.json'), JSON.stringify({
        name: 'api',
        scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
      }));

      const plan = resolveProjectVerifyCommands(tempDir, [], {
        touchedFiles: ['packages/web/src/index.ts'],
        userMessage: 'Fix all build errors in the whole workspace',
      });

      expect(plan.commands).toEqual([
        'cd packages/api && pnpm run typecheck',
        'cd packages/web && pnpm run build',
      ]);
      expect(Object.keys(plan.discoveredScripts).sort()).toEqual([
        'packages/api',
        'packages/web',
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('discovers non-JS test commands from manifests only when appropriate', async () => {
    const { resolveProjectVerifyCommands } = await import('../src/features/ce/runtime/verifyCommandDiscovery');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-verify-polyglot-test-'));
    try {
      writeFileSync(join(tempDir, 'pom.xml'), '<project />');
      expect(resolveProjectVerifyCommands(tempDir, ['npm run lint', 'npm test']).commands).toEqual(['mvn test']);

      rmSync(join(tempDir, 'pom.xml'));
      writeFileSync(join(tempDir, 'go.mod'), 'module example.com/app\n');
      expect(resolveProjectVerifyCommands(tempDir, ['npm run lint', 'npm test']).commands).toEqual([]);
      writeFileSync(join(tempDir, 'main_test.go'), 'package main\n');
      expect(resolveProjectVerifyCommands(tempDir, ['npm run lint', 'npm test']).commands).toEqual(['go test ./...']);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('pathUtils', () => {
  it('normalizes "." to empty root', async () => {
    const { normalizeRelPath } = await import('../src/kernel/util/paths');
    expect(normalizeRelPath('.')).toBe('');
    expect(normalizeRelPath('./src/foo.ts')).toBe('src/foo.ts');
  });

  it('rejects invalid workspace roots', async () => {
    const { normalizeWorkspaceRoot } = await import('../src/kernel/util/paths');
    expect(normalizeWorkspaceRoot('')).toBeNull();
    expect(normalizeWorkspaceRoot('   ')).toBeNull();
    expect(normalizeWorkspaceRoot('/tmp')).toMatch(/tmp/);
  });

  it('strips embedded workspace root from pseudo-absolute paths', async () => {
    const { resolveWorkspaceRelPath } = await import('../src/kernel/util/paths');
    const ws = '/Users/me/proj';
    expect(resolveWorkspaceRelPath(ws, 'Users/me/proj/apps/docs/config.ts')).toBe('apps/docs/config.ts');
    expect(resolveWorkspaceRelPath(ws, '/Users/me/proj/apps/docs/config.ts')).toBe('apps/docs/config.ts');
    expect(resolveWorkspaceRelPath(ws, 'apps/docs/config.ts')).toBe('apps/docs/config.ts');
  });

  it('suggests extension variants for missing paths', async () => {
    const { pathExistenceVariants } = await import('../src/kernel/util/paths');
    const variants = pathExistenceVariants('apps/docs/docusaurus.config.js');
    expect(variants).toContain('apps/docs/docusaurus.config.ts');
  });
});

describe('modelNormalize', () => {
  it('maps deepseek-v4-flash to deepseek-chat', async () => {
    const { normalizeProviderModel } = await import('../src/kernel/llm/modelNormalize');
    expect(normalizeProviderModel('deepseek', 'deepseek-v4-flash').model).toBe('deepseek-chat');
  });

  it('rejects local Ollama model ids on DeepSeek provider', async () => {
    const { normalizeProviderModel } = await import('../src/kernel/llm/modelNormalize');
    const result = normalizeProviderModel('deepseek', 'qwen3-coder:30b');
    expect(result.model).toBe('deepseek-chat');
    expect(result.warning).toMatch(/local/i);
  });
});

describe('toolAliases', () => {
  it('maps search_files to search', async () => {
    const { resolveToolName } = await import('../src/kernel/tools/toolAliases');
    expect(resolveToolName('search_files')).toBe('search');
  });
});

describe('promptBuilder', () => {
  it('includes cause-specific MDX generic repair guidance only for MDX repair mode', async () => {
    const { buildSystemPrompt } = await import('../src/features/ce/plans/promptBuilder');
    const defaultPrompt = buildSystemPrompt('agent', true);
    expect(defaultPrompt).not.toContain('Unexpected character `,` in name');
    expect(defaultPrompt).not.toContain('LiveCodeBlock');

    const prompt = buildSystemPrompt('agent', true, { mdxRepairMode: true });

    expect(prompt).toContain('Unexpected character `,` in name');
    expect(prompt).toContain('Record<string, any>');
    expect(prompt).toContain('Could not parse expression with acorn');
    expect(prompt).toContain("Can't resolve");
    expect(prompt).toContain('form-builder.md');
  });
});

describe('pageRank', () => {
  it('ranks highly referenced nodes higher', async () => {
    const { computePageRank } = await import('../src/features/ce/context/pageRank');
    const scores = computePageRank(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        { from: 'b.ts', to: 'a.ts' },
        { from: 'c.ts', to: 'a.ts' },
        { from: 'a.ts', to: 'b.ts' },
      ]
    );
    expect((scores.get('a.ts') ?? 0)).toBeGreaterThan(scores.get('c.ts') ?? 0);
  });
});

describe('PassiveMemoryInjector', () => {
  it('returns empty without memory service', async () => {
    const { PassiveMemoryInjector } = await import('../src/features/ce/memory/PassiveMemoryInjector');
    const injector = new PassiveMemoryInjector(undefined);
    expect(await injector.inject('auth module')).toEqual([]);
  });
});

describe('PatchApplyService validateSyntax', () => {
  it('rejects invalid JSON', async () => {
    const { PatchApplyService } = await import('../src/features/ce/apply/PatchApplyService');
    const svc = new PatchApplyService('/tmp');
    const result = svc.validateSyntax('data.json', '{ invalid');
    expect(result.success).toBe(false);
  });

  it('rejects MDX patches that leave raw TypeScript generics in table cells', async () => {
    const { PatchApplyService } = await import('../src/features/ce/apply/PatchApplyService');
    const svc = new PatchApplyService('/tmp');
    const result = svc.validateSyntax(
      'docs/ffb-mui/api/formik-renderer.md',
      [
        '| Name | Type | Required | Description |',
        '|------|------|----------|-------------|',
        '| initialValues | Record<string, any> | Yes | Initial form values |',
      ].join('\n')
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('raw TypeScript generic');
  });

  it('does not run source-code bracket balance checks on plain Markdown', async () => {
    const { PatchApplyService } = await import('../src/features/ce/apply/PatchApplyService');
    const svc = new PatchApplyService('/tmp');
    const result = svc.validateSyntax(
      'README.md',
      [
        '## Ollama Configuration',
        '',
        'Install [Ollama](https://ollama.ai) and run:',
        '',
        '```bash',
        'ollama pull llama3.1  # or qwen2.5, mistral-large, command-r-plus',
        '```',
      ].join('\n')
    );

    expect(result.success).toBe(true);
  });

  it('allows apply_patch to remove a Markdown section with links and fenced code', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-patch-markdown-test-'));

    try {
      const { createApplyPatchTool } = await import('../src/features/ce/tools/builtinTools');
      const ig = new IgnoreService();
      ig.load(tempDir);
      const readmePath = join(tempDir, 'README.md');
      const ollamaSection = [
        '## Ollama Configuration',
        '',
        'Career-Ops supports **Ollama** as a local provider.',
        '',
        '```bash',
        'ollama pull llama3.1  # or qwen2.5, mistral-large, command-r-plus',
        '```',
        '',
        '> **Tip:** See [`modes/_shared.md`](modes/_shared.md) -> "Provider Options".',
        '',
      ].join('\n');
      writeFileSync(readmePath, `# Project\n\n${ollamaSection}## Usage\n\nRun it.\n`);

      const result = await createApplyPatchTool(tempDir, ig).execute({
        path: 'README.md',
        oldText: ollamaSection,
        newText: '',
      });

      expect(result.success).toBe(true);
      const updated = readFileSync(readmePath, 'utf8');
      expect(updated).not.toContain('Ollama Configuration');
      expect(updated).toContain('## Usage');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows targeted TSX patches when the final file has many self-closing components', async () => {
    const { PatchApplyService } = await import('../src/features/ce/apply/PatchApplyService');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-patch-tsx-test-'));

    try {
      const path = 'Kanban.tsx';
      const oldText = "border: (t) => `1px solid ${t.palette.divider}`";
      const newText = "border: `1px solid ${theme.palette.divider}`";
      const children = Array.from({ length: 16 }, (_, index) => `        <ItemCard key="${index}" />`).join('\n');
      const content = `import React from 'react';

export function Kanban() {
  const theme = { palette: { divider: '#ddd' } };
  return (
    <Box
      sx={{
        ${oldText},
      }}
    >
${children}
    </Box>
  );
}
`;

      writeFileSync(join(tempDir, path), content, 'utf-8');
      const result = new PatchApplyService(tempDir).apply({ path, oldText, newText });

      expect(result.success).toBe(true);
      expect(result.proposedContent).toContain(newText);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('HashEmbeddingProvider', () => {
  it('produces normalized embeddings', async () => {
    const { HashEmbeddingProvider, cosineSimilarity } = await import('../src/features/ce/indexing/EmbeddingProvider');
    const provider = new HashEmbeddingProvider();
    const [a, b] = await provider.embed(['hello world', 'hello there']);
    expect(a.length).toBeGreaterThan(0);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0);
  });
});

describe('ContextReranker', () => {
  it('reranks candidates by lexical overlap', async () => {
    const { LexicalContextReranker } = await import('../src/features/ce/context/ContextReranker');
    const reranker = new LexicalContextReranker();
    const items = [
      { id: 'a', source: 'fts', content: 'unrelated blob', score: 9, reason: 'fts', tokenEstimate: 10 },
      { id: 'b', source: 'fts', content: 'authentication middleware login', score: 5, reason: 'fts', tokenEstimate: 10 },
    ];
    const ranked = await reranker.rerank('authentication login', items, 1);
    expect(ranked[0]?.id).toBe('b');
  });
});

describe('HybridRetriever reranker', () => {
  it('applies reranker top-k when enabled', async () => {
    const { HybridRetriever } = await import('../src/features/ce/context/HybridRetriever');
    const { LexicalContextReranker } = await import('../src/features/ce/context/ContextReranker');
    const retriever = new HybridRetriever(
      [{
        id: 'mock',
        async retrieve() {
          return Array.from({ length: 12 }, (_, i) => ({
            id: `item-${i}`,
            source: 'fts',
            content: i === 3 ? 'target auth token flow' : `noise ${i}`,
            score: 12 - i,
            reason: 'mock',
            tokenEstimate: 5,
          }));
        },
      }],
      new LexicalContextReranker(),
      { enabled: true, candidatePool: 10, topK: 3 }
    );
    const results = await retriever.retrieve({ text: 'auth token', maxItems: 20 });
    expect(results.length).toBe(3);
    expect(results.some((r) => r.content.includes('auth'))).toBe(true);
  });

  it('emits source and reranker timings', async () => {
    const { HybridRetriever } = await import('../src/features/ce/context/HybridRetriever');
    const { LexicalContextReranker } = await import('../src/features/ce/context/ContextReranker');
    const timings: Array<{ source: string; success: boolean }> = [];
    const retriever = new HybridRetriever(
      [{
        id: 'mock',
        async retrieve() {
          return [{
            id: 'item-1',
            source: 'fts',
            content: 'auth token',
            score: 1,
            reason: 'mock',
            tokenEstimate: 5,
          }];
        },
      }],
      new LexicalContextReranker(),
      { enabled: true, candidatePool: 10, topK: 1 },
      (timing) => timings.push(timing)
    );

    const results = await retriever.retrieve({ text: 'auth token', maxItems: 1 });

    expect(results.length).toBe(1);
    expect(timings.some((timing) => timing.source === 'mock' && timing.success)).toBe(true);
    expect(timings.some((timing) => timing.source === 'reranker' && timing.success)).toBe(true);
  });
});

describe('MemoryService FTS', () => {
  it('searches observations via FTS5', async () => {
    const { mkdtempSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { ThunderDb } = await import('../src/features/ce/indexing/ThunderDb');
    const { MigrationRunner } = await import('../src/features/ce/indexing/migrations');
    const { MemoryService } = await import('../src/features/ce/memory/MemoryService');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-memory-fts-'));
    const db = new ThunderDb(join(dir, 'thunder.sqlite'));
    db.open();
    new MigrationRunner(db).run();

    const memory = new MemoryService(db, 'ws', { maxItems: 10 });
    memory.write('s1', 'decision', 'Use JWT for authentication middleware');
    memory.write('s1', 'bugfix', 'Fixed unrelated pagination bug');

    const hits = memory.search('authentication JWT', 5);
    expect(hits.some((h) => h.text.includes('JWT'))).toBe(true);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('SubagentTracker', () => {
  it('tracks run lifecycle', async () => {
    const { SubagentTracker } = await import('../src/features/ce/runtime/SubagentTracker');
    const tracker = new SubagentTracker();
    const updates: number[] = [];
    tracker.setUpdateCallback((runs) => updates.push(runs.length));
    const id = tracker.start('find unused deps');
    tracker.finish(id, 'found 3 unused packages');
    expect(tracker.getRuns()[0]?.status).toBe('done');
    expect(updates.length).toBeGreaterThan(0);
  });
});

describe('SessionLogService', () => {
  it('separates turn lifecycle from session lifecycle', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { SessionLogService } = await import('../src/kernel/telemetry/SessionLogService');

    const dir = mkdtempSync(join(tmpdir(), 'mitii-turn-log-'));
    try {
      const log = new SessionLogService();
      log.configure(dir, 'turn-session', true);
      log.writeSessionHeader({ mode: 'agent' });
      const turnId = log.beginTurn({ mode: 'agent' });
      log.append('user_message', 'Update README');
      log.endTurn('completed', { toolCalls: 1 });

      let events = readFileSync(log.getLogPath(), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(events.map((event) => event.type)).toEqual([
        'session_start',
        'turn_start',
        'user_message',
        'turn_end',
      ]);
      expect(events[2].data.turnId).toBe(turnId);
      expect(events.some((event) => event.type === 'session_end')).toBe(false);

      log.endSession({ reason: 'test_complete' });
      events = readFileSync(log.getLogPath(), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(events.at(-1)?.type).toBe('session_end');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes JSONL events and builds a summary', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { SessionLogService } = await import('../src/kernel/telemetry/SessionLogService');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-log-'));
    const workspace = join(dir, 'ws');
    const log = new SessionLogService();
    log.configure(workspace, 'sess-1', true);
    log.writeSessionHeader({ mode: 'agent' });
    log.append('user_message', 'hello', { mode: 'agent' });
    log.append('tool_start', 'read_file', { input: { path: 'package.json' } });

    const path = log.getLogPath();
    expect(path).toContain('.mitii/logs');
    expect(path).toContain('sess-1.jsonl');
    const content = readFileSync(path!, 'utf-8');
    expect(content).toContain('user_message');
    const firstEvent = JSON.parse(content.trim().split('\n')[0]);
    expect(firstEvent.time).toEqual(expect.any(String));
    expect(firstEvent.data.startedAtLocal).toEqual(expect.any(String));
    expect(log.exportSummary()).toContain('sess-1');

    rmSync(dir, { recursive: true, force: true });
  });

  it('records canonical tool start and end fields from ToolRuntime', async () => {
    const { z } = await import('zod');
    const { readFileSync } = await import('fs');
    const { ToolRuntime } = await import('../src/kernel/tools/ToolRuntime');
    const { SessionLogService } = await import('../src/kernel/telemetry/SessionLogService');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-tool-log-'));
    try {
      const runtime = new ToolRuntime();
      const log = new SessionLogService();
      log.configure(dir, 'tool-session', true, true);
      runtime.setSessionLog(log);
      runtime.register({
        name: 'run_command',
        description: 'Run command',
        risk: 'low',
        inputSchema: z.object({ command: z.string() }),
        execute: async (input: { command: string }) => ({ success: true, output: `ran ${input.command}` }),
      });

      const result = await runtime.execute('run_command', { command: 'npm test' });
      expect(result.success).toBe(true);

      const lines = readFileSync(log.getLogPath(), 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
      const starts = lines.filter((event) => event.type === 'tool_start');
      const ends = lines.filter((event) => event.type === 'tool_end');
      const start = starts[0];
      const end = ends[0];
      expect(starts.length).toBe(1);
      expect(ends.length).toBe(1);
      expect(start.data.toolCallId).toEqual(expect.any(String));
      expect(end.data.toolCallId).toBe(start.data.toolCallId);
      expect(start.data.toolName).toBe('run_command');
      expect(start.data.command).toBe('npm test');
      expect(end.data.success).toBe(true);
      expect(end.data.durationMs).toEqual(expect.any(Number));
      expect(end.data.inputPreview).toContain('npm test');
      expect(end.data.outputPreview).toContain('ran npm test');
      expect(lines.some((event) => event.type === 'info' && event.data?.eventType === 'tool_start')).toBe(true);
      expect(lines.some((event) => event.type === 'info' && event.data?.eventType === 'tool_end')).toBe(true);
      expect(log.exportSummary()).toContain('## Tool calls');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('toolSchema', () => {
  it('converts zod tool to OpenAI definition', async () => {
    const { z } = await import('zod');
    const { toolToDefinition } = await import('../src/kernel/tools/toolSchema');
    const def = toolToDefinition({
      name: 'read_file',
      description: 'Read a file',
      risk: 'low',
      inputSchema: z.object({ path: z.string() }),
      execute: async () => ({ success: true, output: '' }),
    });
    expect(def.function.name).toBe('read_file');
    expect(def.function.parameters).toHaveProperty('properties');
  });
});

describe('UserExplicitContextBuilder', () => {
  it('injects full file content under token limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thunder-explicit-'));
    try {
      writeFileSync(join(dir, 'hello.ts'), 'export function hello() { return 1; }\n');
      const { UserExplicitContextBuilder } = await import('../src/features/ce/context/UserExplicitContextBuilder');
      const builder = new UserExplicitContextBuilder(undefined, dir);
      const result = builder.build([{ path: 'hello.ts', kind: 'file' }]);
      expect(result.formatted).toContain('<user_explicit_context>');
      expect(result.formatted).toContain('<file path="hello.ts">');
      expect(result.formatted).toContain('export function hello');
      expect(result.items[0]?.source).toBe('user-explicit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to scoped AST for large files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thunder-explicit-large-'));
    try {
      const body = Array.from({ length: 12000 }, (_, i) => `// line ${i}`).join('\n');
      writeFileSync(join(dir, 'big.ts'), `export class Big {}\n${body}`);
      const { UserExplicitContextBuilder } = await import('../src/features/ce/context/UserExplicitContextBuilder');
      const builder = new UserExplicitContextBuilder(undefined, dir);
      const result = builder.build([{ path: 'big.ts', kind: 'file' }]);
      expect(result.formatted).toContain('representation="scoped-ast"');
      expect(result.formatted).toContain('class Big');
      expect(result.formatted).not.toContain('line 11000');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildPrompt explicit context', () => {
  it('places user_explicit_context inside the untrusted workspace context', async () => {
    const { buildPrompt } = await import('../src/features/ce/plans/promptBuilder');
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: 'auto context',
      retrievedCount: 0,
      budgetLimit: 1000,
      dropped: [],
      truncatedCount: 0,
    };
    const messages = buildPrompt(
      'plan',
      pack,
      'fix the bug',
      [],
      false,
      false,
      false,
      undefined,
      undefined,
      false,
      '<user_explicit_context><file path="a.ts">code</file></user_explicit_context>'
    );
    const user = messages.find((m) => m.role === 'user');
    const content = user?.content ?? '';
    const workspaceStart = content.indexOf('<workspace_context trust="untrusted-data">');
    const explicitStart = content.indexOf('<user_explicit_context>');
    const workspaceEnd = content.indexOf('</workspace_context>');
    expect(workspaceStart).toBeGreaterThanOrEqual(0);
    expect(explicitStart).toBeGreaterThan(workspaceStart);
    expect(explicitStart).toBeLessThan(workspaceEnd);
    expect(user?.content).toContain('## Codebase Context');
  });
});

describe('conversation task message resolution', () => {
  it('expands terse follow-ups using the latest substantive user turn', async () => {
    const { resolveConversationTaskMessage } = await import('../src/features/ce/runtime/taskMessage');
    const resolved = resolveConversationTaskMessage('add them', [
      { role: 'user', content: 'Can you add Day 17 and 18 to the Oracle Fusion learn plan' },
      { role: 'assistant', content: 'Planning failed quality gate' },
    ]);

    expect(resolved).toContain('add them');
    expect(resolved).toContain('Day 17 and 18');
  });
});

describe('TaskAnalyzer direct error fix', () => {
  it('routes syntax/compiler errors to direct execution without replanning', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const message = `Syntax error: Missing semicolon. (2:28)
src/screens/kitchen-screen/components/DineInKanban.tsx

  1 | // BEFORE (crashed)
> 2 | '&::-webkit-scrollbar-thumb': (t) => ({`;

    const analysis = analyzeTask(message, 'agent');
    expect(analysis.kind).toBe('simple_edit');
    expect(analysis.shouldPlan).toBe(false);
    expect(analysis.summary).toContain('DineInKanban.tsx');
  });

  it('routes MDX compilation failures to direct exact-file repair', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const analysis = analyzeTask(
      'Error: MDX compilation failed for file "/repo/apps/docs/docs/ffb-mui/api/formik-renderer.md" Cause: Unexpected character `,`',
      'agent'
    );

    expect(analysis.kind).toBe('simple_edit');
    expect(analysis.shouldPlan).toBe(false);
    expect(analysis.shouldVerify).toBe(true);
    expect(analysis.summary).toContain('MDX/Docusaurus compilation error');
    expect(analysis.summary).toContain('formik-renderer.md');
  });

  it('routes module resolution failures in docs builds to direct repair', async () => {
    const { analyzeTask } = await import('../src/features/ce/runtime/TaskAnalyzer');
    const analysis = analyzeTask(
      "Module not found: Error: Can't resolve 'ffb-mui' in '/repo/apps/docs/src/components'",
      'agent'
    );

    expect(analysis.kind).toBe('simple_edit');
    expect(analysis.shouldPlan).toBe(false);
    expect(analysis.shouldVerify).toBe(true);
  });
});

describe('mdxRepairRouting', () => {
  it('detects pasted Docusaurus build failures', async () => {
    const { isMdxRepairTask, extractMdxErrorFile, buildMdxRepairBootstrapBlock } = await import(
      '../src/features/ce/runtime/mdxRepairRouting'
    );
    const text = `Compiled with problems:
ERROR in ./docs/ffb-mui/api/formik-renderer.md
MDX compilation failed for file "/repo/apps/docs/docs/ffb-mui/api/formik-renderer.md"
Cause: Could not parse expression with acorn`;

    expect(isMdxRepairTask(text)).toBe(true);
    expect(extractMdxErrorFile(text)).toContain('formik-renderer.md');
    expect(buildMdxRepairBootstrapBlock(extractMdxErrorFile(text))).toContain('form-builder.md');
    expect(buildMdxRepairBootstrapBlock(extractMdxErrorFile(text))).toContain("Can't resolve");
  });
});

describe('SessionLogService timing', () => {
  it('records timing events and omits debug payloads when debugMetrics is off', async () => {
    const { SessionLogService } = await import('../src/kernel/telemetry/SessionLogService');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-session-log-'));

    try {
      const service = new SessionLogService();
      service.configure(tempDir, 'test-session', true, false);
      service.appendTiming('context_retrieval', 120, { itemCount: 3 });
      service.appendDebug('tool_start', 'read_file', { input: { path: 'src/a.ts' } });
      service.append('tool_start', 'read_file', { tool: 'read_file' });

      const raw = service.exportForAnalysis();
      expect(raw).toContain('"type":"timing"');
      expect(raw).toContain('"durationMs":120');
      expect(raw).not.toContain('"input"');
      expect(raw).toContain('"tool":"read_file"');

      const summary = service.exportSummary();
      expect(summary).toContain('context_retrieval');
      expect(summary).toContain('120ms');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('captures debug payloads when debugMetrics is enabled', async () => {
    const { SessionLogService } = await import('../src/kernel/telemetry/SessionLogService');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-session-log-debug-'));

    try {
      const service = new SessionLogService();
      service.configure(tempDir, 'debug-session', true, true);
      service.appendDebug('tool_start', 'read_file', { input: { path: 'src/a.ts' } });

      const raw = service.exportForAnalysis();
      expect(raw).toContain('"input"');
      expect(raw).toContain('src/a.ts');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('workspace scaffolding', () => {
  it('creates default .mitii/mcp.json and README on first init', async () => {
    const { mkdtempSync, existsSync, readFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { scaffoldMitiiWorkspace } = await import('../src/features/ce/mcp/scaffoldMitiiWorkspace');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-scaffold-'));
    try {
      scaffoldMitiiWorkspace(dir);
      const mcpPath = join(dir, '.mitii', 'mcp.json');
      const readmePath = join(dir, '.mitii', 'README.md');
      expect(existsSync(mcpPath)).toBe(true);
      expect(existsSync(readmePath)).toBe(true);
      const mcp = JSON.parse(readFileSync(mcpPath, 'utf-8')) as { mcpServers: Record<string, unknown> };
      expect(mcp.mcpServers).toEqual({});
      expect(readFileSync(readmePath, 'utf-8')).toContain('filesystem');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not overwrite existing mcp.json', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { scaffoldMitiiWorkspace } = await import('../src/features/ce/mcp/scaffoldMitiiWorkspace');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-scaffold-'));
    try {
      mkdirSync(join(dir, '.mitii'), { recursive: true });
      writeFileSync(join(dir, '.mitii', 'mcp.json'), '{"mcpServers":{"custom":{}}}\n');
      scaffoldMitiiWorkspace(dir);
      expect(readFileSync(join(dir, '.mitii', 'mcp.json'), 'utf-8')).toContain('custom');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('run_command exit codes', () => {
  it('treats rg exit 1 as success but not npm test failures', async () => {
    const { mkdtempSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { createRunCommandTool } = await import('../src/features/ce/tools/builtinTools');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-cmd-'));
    try {
      const tool = createRunCommandTool(dir, () => 'agent');
      const grep = await tool.execute({ command: 'grep -r "__definitely_missing_pattern_xyz__" .' });
      expect(grep.success).toBe(true);

      const npm = await tool.execute({ command: 'npm test' });
      expect(npm.success).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not treat historical "not found" in stdout as a shell failure', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { createRunCommandTool } = await import('../src/features/ce/tools/builtinTools');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-cmd-log-'));
    try {
      writeFileSync(
        join(dir, 'sample.jsonl'),
        '{"error":"File not found: missing.md","message":"read file failed"}\n'
      );
      const tool = createRunCommandTool(dir, () => 'ask');
      const result = await tool.execute({
        command: 'grep -h "failure\\|not found\\|error" sample.jsonl | head -5',
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain('File not found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects verification pipelines that mask the real exit code', async () => {
    const { mkdtempSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { createRunCommandTool } = await import('../src/features/ce/tools/builtinTools');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-cmd-tsc-pipe-'));
    try {
      const tool = createRunCommandTool(dir, () => 'agent');
      const result = await tool.execute({
        command: 'printf "src/index.ts(1,1): error TS18046: bad type\\n" | tail -20 # tsc --noEmit',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('real exit code');

      const count = await tool.execute({
        command: 'npx tsc --noEmit 2>&1 | grep "error TS" | wc -l',
      });
      expect(count.success).toBe(false);
      expect(count.error).toContain('run directly');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strips a trailing head/tail/echo-$?/|| true wrapper and runs the real verification command', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { createRunCommandTool } = await import('../src/features/ce/tools/builtinTools');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-cmd-strip-'));
    try {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'x', scripts: { build: 'node -e "console.error(\'error TS2304: boom\'); process.exit(2)"' } })
      );
      const tool = createRunCommandTool(dir, () => 'agent');

      // A weak model piping to head to see truncated output — should run for real instead of
      // being rejected outright, since this tool already returns full stdout+stderr.
      const piped = await tool.execute({ command: 'npm run build 2>&1 | head -120' });
      expect(piped.error).not.toContain('run directly');
      expect(piped.success).toBe(false);
      expect(piped.output).toContain('error TS2304');

      // `|| true` / `; echo $?` variants should be stripped the same way.
      const orTrue = await tool.execute({ command: 'npm run build 2>&1 || true' });
      expect(orTrue.error).not.toContain('run directly');
      expect(orTrue.success).toBe(false);

      const echoExit = await tool.execute({ command: 'npm run build 2>&1; echo "EXIT_CODE: $?"' });
      expect(echoExit.error).not.toContain('run directly');
      expect(echoExit.success).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Ask v2 routing, scope, and impact', () => {
  it('routes canonical Ask intents and profiles', async () => {
    const { routeAskIntent } = await import('../src/features/ce/modes/ask');

    expect(routeAskIntent('Where is Ask mode defined?')).toMatchObject({
      intent: 'locate',
      profile: 'concise',
      includeImpact: false,
    });
    expect(routeAskIntent('Explain ChatOrchestrator flow across the repo')).toMatchObject({
      intent: 'architecture',
      profile: 'deep',
      shouldUseSubagents: true,
    });
    expect(routeAskIntent('How do I implement OAuth in this project?')).toMatchObject({
      intent: 'implement_here',
      profile: 'deep',
      includeImpact: true,
      allowWeb: true,
    });
    expect(routeAskIntent('What is recursion?')).toMatchObject({
      intent: 'general_knowledge',
      groundingRequired: false,
    });
    expect(routeAskIntent('Need commit message for the changes in stage @mitii-ai-agent')).toMatchObject({
      intent: 'explain_code',
      groundingRequired: true,
    });
  });

  it('discovers monorepo projects and persists a catalog file', async () => {
    const { discoverProjectCatalog, saveProjectCatalog, loadProjectCatalog, formatProjectCatalog } =
      await import('../src/features/ce/modes/ask');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-project-catalog-test-'));
    try {
      writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), ['packages:', "  - 'apps/*'", "  - 'packages/*'"].join('\n'));
      mkdirSync(join(tempDir, 'apps/docs'), { recursive: true });
      writeFileSync(join(tempDir, 'apps/docs/package.json'), JSON.stringify({
        name: 'mitii-docs',
        dependencies: { '@docusaurus/core': '^3.0.0' },
        scripts: { build: 'docusaurus build' },
      }));
      writeFileSync(join(tempDir, 'apps/docs/docusaurus.config.ts'), 'export default {};');
      mkdirSync(join(tempDir, 'packages/sdk/src'), { recursive: true });
      writeFileSync(join(tempDir, 'packages/sdk/package.json'), JSON.stringify({
        name: '@mitii/sdk',
        scripts: { test: 'vitest' },
      }));
      writeFileSync(join(tempDir, 'packages/sdk/src/index.ts'), 'export const sdk = true;');

      const catalog = discoverProjectCatalog(tempDir);
      expect(catalog.projects.map((project) => project.id)).toEqual(['docs', 'sdk']);
      expect(catalog.projects.find((project) => project.id === 'docs')?.type).toBe('docs');
      expect(catalog.projects.find((project) => project.id === 'sdk')?.type).toBe('lib');

      saveProjectCatalog(catalog);
      expect(existsSync(join(tempDir, '.mitii/projects.json'))).toBe(true);
      expect(loadProjectCatalog(tempDir).projects).toHaveLength(2);
      expect(formatProjectCatalog(catalog)).toContain('## Workspace projects');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves explicit, type-based, and cross-project scopes', async () => {
    const { resolveAskScope } = await import('../src/features/ce/modes/ask');
    const catalog = {
      workspaceRoot: '/tmp/repo',
      generatedAt: 'now',
      projects: [
        { id: 'agent', name: 'mitii-agent', root: 'apps/agent', type: 'extension' as const, entryFiles: [], scripts: {} },
        { id: 'docs', name: 'mitii-docs', root: 'apps/docs', type: 'docs' as const, entryFiles: [], scripts: {} },
      ],
    };

    expect(resolveAskScope('How do I implement OAuth in mitii-docs?', catalog)).toMatchObject({
      status: 'matched',
      scopeRoot: 'apps/docs',
    });
    expect(resolveAskScope('Where is the extension entry point?', catalog)).toMatchObject({
      status: 'matched',
      scopeRoot: 'apps/agent',
    });
    expect(resolveAskScope('How do docs relate to the agent across projects?', catalog).status).toBe('all');
  });

  it('analyzes likely affected files without mutating source files', async () => {
    const { analyzeChangeImpact } = await import('../src/features/ce/modes/ask');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-impact-test-'));
    try {
      mkdirSync(join(tempDir, 'src/core/auth'), { recursive: true });
      mkdirSync(join(tempDir, 'test'), { recursive: true });
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'impact-app',
        scripts: { test: 'vitest', lint: 'eslint .' },
      }));
      writeFileSync(join(tempDir, 'src/core/auth/session.ts'), 'export function createSession(token: string) { return token; }');
      writeFileSync(join(tempDir, 'src/core/routes.ts'), 'export const routes = ["/login"];');
      writeFileSync(join(tempDir, 'test/unit.test.ts'), 'import { describe } from "vitest";');

      const impact = analyzeChangeImpact(tempDir, 'How do I implement OAuth login?', '.');

      expect(impact.summary).toContain('OAuth');
      expect(impact.files.modify.some((file) => file.path === 'src/core/auth/session.ts')).toBe(true);
      expect(impact.files.create.some((file) => file.path.includes('OAuthProvider.ts'))).toBe(true);
      expect(impact.files.maybe.some((file) => file.path === 'package.json')).toBe(true);
      expect(impact.files.tests).toContain('test/unit.test.ts');
      expect(impact.suggestedOrder.join('\n')).toContain('npm run test');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('exposes project catalog and impact through read-only built-in tools', async () => {
    const { createProjectCatalogTool, createAnalyzeChangeImpactTool } = await import('../src/features/ce/tools/builtinTools');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-ask-tools-test-'));
    try {
      mkdirSync(join(tempDir, 'src'), { recursive: true });
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
        name: 'tool-app',
        scripts: { test: 'vitest' },
      }));
      writeFileSync(join(tempDir, 'src/index.ts'), 'export const auth = true;');

      const catalog = await createProjectCatalogTool(tempDir).execute({});
      expect(catalog.success).toBe(true);
      expect(catalog.output).toContain('tool-app');

      const impact = await createAnalyzeChangeImpactTool(tempDir).execute({
        feature: 'How do I add auth?',
        scopeRoot: '.',
      });
      expect(impact.success).toBe(true);
      expect(impact.output).toContain('"files"');
      expect(readFileSync(join(tempDir, 'src/index.ts'), 'utf8')).toContain('auth');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('prepares a headless Ask run plan for SDK-compatible callers', async () => {
    const { AskOrchestrator } = await import('../src/features/ce/modes/ask');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-ask-orchestrator-test-'));
    try {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'ask-app' }));

      const plan = AskOrchestrator.prepare('How do I implement rate limiting here?', {
        workspaceRoot: tempDir,
      });

      expect(plan.route.intent).toBe('implement_here');
      expect(plan.promptContext).toContain('## Ask routing');
      expect(plan.promptContext).toContain('analyze_change_impact');
      expect(plan.maxSteps).toBe(20);
      expect(plan.autoContinue).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses Ask step ceilings instead of overriding every intent with the setting', async () => {
    const { AskOrchestrator } = await import('../src/features/ce/modes/ask');

    expect(AskOrchestrator.prepare('Where is Ask mode defined?', {
      configuredMaxSteps: 18,
    }).maxSteps).toBe(8);

    expect(AskOrchestrator.prepare('Compare plan mode and ask mode', {
      configuredMaxSteps: 18,
    }).maxSteps).toBe(16);

    expect(AskOrchestrator.prepare('How do I implement OAuth here?', {
      configuredMaxSteps: 18,
    }).maxSteps).toBe(18);

    expect(AskOrchestrator.prepare('Explain ChatOrchestrator flow', {
      configuredMaxSteps: 50,
      askDepth: 'deep',
      askMaxAutoContinues: 3,
    })).toMatchObject({ maxSteps: 22, maxAutoContinues: 1 });
  });

  it('loads cached project catalogs during Ask preparation', async () => {
    const { AskOrchestrator } = await import('../src/features/ce/modes/ask');
    const tempDir = mkdtempSync(join(tmpdir(), 'thunder-ask-cached-catalog-test-'));
    try {
      mkdirSync(join(tempDir, '.mitii'), { recursive: true });
      writeFileSync(join(tempDir, '.mitii/projects.json'), JSON.stringify({
        workspaceRoot: tempDir,
        generatedAt: 'cached',
        projects: [
          { id: 'cached-docs', root: 'apps/docs', name: 'cached-docs', type: 'docs', entryFiles: [], scripts: {} },
        ],
      }));

      const plan = AskOrchestrator.prepare('How do docs work?', { workspaceRoot: tempDir });
      expect(plan.catalog?.generatedAt).toBe('cached');
      expect(plan.scope.scopeRoot).toBe('apps/docs');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('filters scoped search and retrieve_context tool results', async () => {
    const { createSearchTool, createRetrieveContextTool } = await import('../src/features/ce/tools/builtinTools');
    const { ContextBudgeter } = await import('../src/features/ce/context/ContextBudgeter');
    const fakeFts = {
      search: () => [
        { relPath: 'apps/docs/src/index.ts', snippet: 'docs result' },
        { relPath: 'apps/agent/src/index.ts', snippet: 'agent result' },
      ],
    };

    const searchResult = await createSearchTool(fakeFts as any).execute({
      query: 'index',
      scopeRoot: 'apps/docs',
    });

    expect(searchResult.output).toContain('apps/docs/src/index.ts');
    expect(searchResult.output).not.toContain('apps/agent/src/index.ts');

    const fakeRetriever = {
      retrieve: async (query: { scopeRoot?: string }) => [
        {
          id: 'scoped',
          source: 'fts',
          relPath: `${query.scopeRoot}/src/index.ts`,
          content: 'scoped context',
          score: 10,
          reason: 'test',
          tokenEstimate: 4,
        },
      ],
    };
    const contextResult = await createRetrieveContextTool(fakeRetriever as any, new ContextBudgeter()).execute({
      query: 'index',
      scopeRoot: 'apps/docs',
    });
    expect(contextResult.output).toContain('apps/docs/src/index.ts');
  });

  it('injects Ask routing instructions without forcing deep prose on concise profiles', async () => {
    const { buildPrompt, buildSystemPrompt } = await import('../src/features/ce/plans/promptBuilder');

    const system = buildSystemPrompt('ask', true);
    expect(system).not.toContain('technical blog post');
    expect(system).toContain('analyze_change_impact');
    expect(system).not.toContain('Keep prose concise. Avoid filler');

    const deepSystem = buildSystemPrompt('ask', true, { askProfile: 'deep' });
    expect(deepSystem).toContain('technical blog post');

    const messages = buildPrompt(
      'ask',
      { items: [], totalTokens: 0, formatted: 'repo context', retrievedCount: 0, budgetLimit: 100, dropped: [], truncatedCount: 0 },
      'Explain the architecture',
      [],
      true,
      false,
      false,
      undefined,
      undefined,
      false,
      undefined,
      '## Ask routing\nIntent: architecture',
      undefined,
      { askProfile: 'deep' }
    );

    expect(messages.at(-1)?.content).toContain('## Ask routing');
    expect(messages.at(-1)?.content).toContain('repo context');
  });
});

describe('SCM commit message generation', () => {
  it('redacts sensitive diff lines before prompting', async () => {
    const { buildCommitMessagePrompt } = await import('../src/features/ce/scm');
    const prompt = buildCommitMessagePrompt({
      stagedDiff: [
        'diff --git a/.env b/.env',
        '+OPENAI_API_KEY=sk-secret',
        '+normal=value',
      ].join('\n'),
      changedFiles: ['.env'],
      recentCommits: ['aa2660f feat(ask): add structured ask mode'],
    });

    expect(prompt).toContain('[redacted sensitive line]');
    expect(prompt).not.toContain('sk-secret');
  });

  it('normalizes model output to a 72-character subject', async () => {
    const { normalizeCommitMessage } = await import('../src/features/ce/scm');
    const result = normalizeCommitMessage('```text\nfeat(ask): add an extremely long subject that should be shortened because it will not fit in git history cleanly\n\nAdds details.\n```');

    expect(result.subject.length).toBeLessThanOrEqual(72);
    expect(result.fullMessage).toContain('Adds details.');
    expect(result.fullMessage).not.toContain('```');
  });

  it('generates a commit message through the configured provider', async () => {
    const { generateCommitMessage } = await import('../src/features/ce/scm');
    const provider = {
      id: 'fake',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: true,
        supportsTools: false,
        supportsEmbeddings: false,
      },
      async *complete() {
        yield { content: 'feat(scm): generate commit messages' };
        yield { done: true };
      },
    };

    const result = await generateCommitMessage({
      stagedDiff: 'diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;',
      changedFiles: ['src/a.ts'],
      recentCommits: [],
    }, provider);

    expect(result.fullMessage).toBe('feat(scm): generate commit messages');
  });

  it('rejects empty staged diffs', async () => {
    const { generateCommitMessage } = await import('../src/features/ce/scm');
    const provider = {
      id: 'fake',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: true,
        supportsTools: false,
        supportsEmbeddings: false,
      },
      async *complete() {
        yield { content: 'chore: noop' };
      },
    };

    await expect(generateCommitMessage({
      stagedDiff: '',
      unstagedDiff: 'diff --git a/src/a.ts b/src/a.ts\n+unstaged',
      changedFiles: ['src/a.ts'],
      recentCommits: [],
    }, provider)).rejects.toThrow('No staged changes');
  });

  it('contributes the SCM title command with an icon', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      contributes: {
        commands: Array<{ command: string; icon?: string }>;
        menus?: Record<string, Array<{ command: string }>>;
        configuration: { properties: Record<string, unknown> };
      };
    };

    expect(pkg.contributes.commands.find((command) => command.command === 'thunder.generateCommitMessage')?.icon).toBe('media/mitii-activitybar.svg');
    expect((pkg as { activationEvents?: string[] }).activationEvents).toContain('onCommand:thunder.generateCommitMessage');
    expect(pkg.contributes.menus?.['scm/title']?.some((entry) => entry.command === 'thunder.generateCommitMessage')).toBe(true);
    expect(pkg.contributes.configuration.properties['thunder.scm.commitMessageEnabled']).toBeTruthy();
  });
});
