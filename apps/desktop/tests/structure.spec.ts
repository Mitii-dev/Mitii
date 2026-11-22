import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const renderer = join(src, 'renderer');

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.test(name)) out.push(full);
  }
  return out;
}

const lineCount = (file: string): number => {
  const text = readFileSync(file, 'utf8');
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
};

describe('desktop source structure (Wave 1.4 god-file splits)', () => {
  it('engine server.ts only wires the route table (no inline routes)', () => {
    const text = readFileSync(join(src, 'engine/server.ts'), 'utf8');
    expect(text).not.toMatch(/['"]\/v1\//);
    expect(lineCount(join(src, 'engine/server.ts'))).toBeLessThan(200);
  });

  it('renderer root keeps only the composition root, barrel and entry assets', () => {
    const files = readdirSync(renderer).filter((n) =>
      statSync(join(renderer, n)).isFile(),
    );
    expect(files.sort()).toEqual(
      ['App.tsx', 'api.ts', 'index.html', 'main.tsx', 'styles.css'].sort(),
    );
  });

  it('api.ts is a thin barrel over renderer/api/ modules', () => {
    const text = readFileSync(join(renderer, 'api.ts'), 'utf8');
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').trim().split('\n');
    expect(code.every((l) => l.startsWith('export '))).toBe(true);
    expect(code.length).toBeLessThan(40);
  });

  it('App.tsx is a composition root', () => {
    expect(lineCount(join(renderer, 'App.tsx'))).toBeLessThan(30);
  });

  it('styles.css imports the ui-theme adapter first, then ordered partials', () => {
    const text = readFileSync(join(renderer, 'styles.css'), 'utf8');
    const imports = [...text.matchAll(/@import\s+'([^']+)';/g)].map((m) => m[1]);
    expect(imports[0]).toBe('@mitii/ui-theme/standalone.css');
    const partials = imports.slice(1);
    expect(partials.length).toBeGreaterThan(10);
    expect([...partials].sort()).toEqual(partials);
    for (const rel of partials) {
      expect(lineCount(join(renderer, rel))).toBeLessThanOrEqual(600);
    }
  });

  it('split modules stay within the 600-line rule', () => {
    const roots = [
      join(src, 'engine/routes'),
      join(src, 'engine/chat'),
      join(src, 'engine/http'),
      join(renderer, 'api'),
      join(renderer, 'app'),
      join(renderer, 'settings'),
      join(renderer, 'indexing'),
      join(renderer, 'chat/hooks'),
      join(renderer, 'shell/hooks'),
      join(renderer, 'explorer'),
      join(renderer, 'git'),
    ];
    const offenders = roots
      .flatMap((dir) => walk(dir, /\.(ts|tsx)$/))
      .filter((f) => lineCount(f) > 600)
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it('WorkspacePanel stays a thin activity-bar host over explorer/', () => {
    const file = join(renderer, 'shell/WorkspacePanel.tsx');
    expect(lineCount(file)).toBeLessThanOrEqual(600);
    const text = readFileSync(file, 'utf8');
    for (const piece of [
      'ExplorerTreePane',
      'WorkspaceEditorPane',
      'ExplorerContextMenu',
      'GitWorkingTreePane',
      'McpManager',
      'SkillsManager',
      'RecipesManager',
      'ResizeHandle',
    ]) {
      expect(text).toContain(piece);
    }
    expect(text).not.toMatch(/fetchWorkspace(Tree|File)|saveWorkspaceFile/);
  });

  it('GitWorkingTreePane is a thin facade over git/ hooks and parts', () => {
    const file = join(renderer, 'git/GitWorkingTreePane.tsx');
    expect(lineCount(file)).toBeLessThanOrEqual(260);
    const text = readFileSync(file, 'utf8');
    for (const piece of [
      'useGitWorkingTreeStatus',
      'useScmSelection',
      'useScmJobs',
      'useScmMutations',
      'ScmPaneHeader',
      'ScmCommitBox',
      'ScmResourceGroup',
      'ScmContextMenu',
      'ScmReviewPanel',
    ]) {
      expect(text).toContain(piece);
    }
    expect(text).not.toMatch(/runRecipe|streamPrompt|gitStageFiles/);
  });

  it('renderer feature modules do not import engine code', () => {
    const offenders = walk(renderer, /\.(ts|tsx)$/).filter((f) =>
      /from\s+['"][^'"]*\/engine\//.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });
});
