import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = resolve(__dirname, '../src');
const MAX_LINES = 600;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const lineCount = (file: string) => readFileSync(file, 'utf8').split('\n').length;

describe('webview source layout', () => {
  it('keeps App.tsx as a thin composition root', () => {
    expect(lineCount(join(src, 'App.tsx'))).toBeLessThanOrEqual(MAX_LINES);
  });

  it('keeps every split module within the 600-line limit', () => {
    const dirs = ['app', 'hooks', 'hostMessages', 'containers', 'components/settings', 'styles'];
    const offenders = dirs
      .flatMap((d) => walk(join(src, d)))
      .filter((f) => lineCount(f) > MAX_LINES);
    expect(offenders).toEqual([]);
    expect(lineCount(join(src, 'components/SettingsPanel.tsx'))).toBeLessThanOrEqual(MAX_LINES);
  });

  it('imports the ui-theme adapter first, then every style partial in order', () => {
    const entry = readFileSync(join(src, 'styles.css'), 'utf8');
    const imports = [...entry.matchAll(/@import '([^']+)';/g)].map((m) => m[1]);
    expect(imports[0]).toBe('@mitii/ui-theme/vscode.css');
    const partials = imports.slice(1);
    const onDisk = readdirSync(join(src, 'styles'))
      .filter((f) => f.endsWith('.css'))
      .sort()
      .map((f) => `./styles/${f}`);
    expect(partials).toEqual(onDisk);
    expect(partials.some((p) => p.includes('settings'))).toBe(true);
    expect(partials.some((p) => p.includes('token-meter'))).toBe(true);
    expect(partials.some((p) => p.includes('chat'))).toBe(true);
  });

  it('does not declare rules in the styles entry beyond imports', () => {
    const entry = readFileSync(join(src, 'styles.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@import '[^']+';/g, '')
      .trim();
    expect(entry).toBe('');
  });
});
