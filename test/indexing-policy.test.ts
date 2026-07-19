import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scaffoldMitiiWorkspace } from '../src/features/ce/mcp/scaffoldMitiiWorkspace';
import { sortIndexCandidates } from '../src/features/ce/indexing/indexingPolicy';

describe('indexing policy', () => {
  it('prioritizes package metadata, config, and src files before broad repo files', () => {
    const sorted = sortIndexCandidates([
      { relPath: 'docs/guide.md' },
      { relPath: 'src/main.ts' },
      { relPath: 'vite.config.ts' },
      { relPath: 'package.json' },
    ]);

    expect(sorted.map((file) => file.relPath)).toEqual([
      'package.json',
      'vite.config.ts',
      'src/main.ts',
      'docs/guide.md',
    ]);
  });

  it('scaffolds workspace and git ignore defaults without removing existing entries', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-ignore-test-'));
    try {
      writeFileSync(join(workspace, '.gitignore'), 'custom.log\n', 'utf-8');
      scaffoldMitiiWorkspace(workspace);

      const mitiiIgnore = readFileSync(join(workspace, '.mitiiignore'), 'utf-8');
      expect(mitiiIgnore).toContain('node_modules/');
      expect(mitiiIgnore).toContain('*.map');

      const gitignore = readFileSync(join(workspace, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('custom.log');
      expect(gitignore).toContain('.mitii/');
      expect(gitignore).toContain('.mitti/');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
