import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ensureAgentsMarkdown,
  ensureMitiiGitignore,
  ensureMitiiWorkspace,
} from '../src/workspaceBootstrap.js';

describe('workspaceBootstrap', () => {
  it('creates .mitii layout and modes catalog', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-boot-'));
    try {
      const result = ensureMitiiWorkspace(dir);
      expect(result.mitiiDir).toBe(join(dir, '.mitii'));
      expect(result.createdDirs.length).toBeGreaterThan(0);
      expect(result.modesCatalog.path).toContain('.mitii');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends Mitii gitignore patterns once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-gi-'));
    try {
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
      const first = ensureMitiiGitignore(dir);
      expect(first.added).toEqual(['.mitii/', '.env', '.env.local']);
      const text = readFileSync(join(dir, '.gitignore'), 'utf8');
      expect(text).toMatch(/# Mitii/);
      expect(text).toMatch(/\.mitii\//);
      const second = ensureMitiiGitignore(dir);
      expect(second.added).toEqual([]);
      expect(second.skipped.length).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates AGENTS.md only when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-agents-'));
    try {
      const created = ensureAgentsMarkdown(dir);
      expect(created.created).toBe(true);
      expect(readFileSync(created.path, 'utf8')).toMatch(/Project brief/);
      const again = ensureAgentsMarkdown(dir);
      expect(again.created).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
