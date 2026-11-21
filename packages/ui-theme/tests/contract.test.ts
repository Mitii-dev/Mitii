import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MITII_THEME_TOKENS } from '../src/index.js';

const cssDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'css');

function read(file: string): string {
  return readFileSync(join(cssDir, file), 'utf8');
}

/** Custom properties declared in the file (`--name:`). */
function declaredTokens(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/(--mitii-[a-z0-9-]+)\s*:/g)) {
    names.add(match[1]!);
  }
  return names;
}

function contractFor(adapter: string): Set<string> {
  const tokens = declaredTokens(read('tokens.css'));
  if (/@import\s+['"]\.\/tokens\.css['"]/.test(read(adapter))) {
    for (const name of declaredTokens(read(adapter))) tokens.add(name);
  }
  return tokens;
}

describe('@mitii/ui-theme token contract', () => {
  for (const adapter of ['vscode.css', 'standalone.css']) {
    it(`${adapter} imports tokens.css and defines every contract token`, () => {
      expect(read(adapter)).toMatch(/@import\s+['"]\.\/tokens\.css['"]/);
      const defined = contractFor(adapter);
      const missing = MITII_THEME_TOKENS.filter((token) => !defined.has(token));
      expect(missing).toEqual([]);
    });

    it(`${adapter} does not declare tokens outside the contract`, () => {
      const known = new Set<string>(MITII_THEME_TOKENS);
      const extra = [...declaredTokens(read(adapter))].filter(
        (token) => !known.has(token),
      );
      expect(extra).toEqual([]);
    });
  }

  it('tokens.css declares only contract tokens', () => {
    const known = new Set<string>(MITII_THEME_TOKENS);
    const extra = [...declaredTokens(read('tokens.css'))].filter(
      (token) => !known.has(token),
    );
    expect(extra).toEqual([]);
  });

  it('standalone adapter provides a dark palette', () => {
    expect(read('standalone.css')).toContain(":root[data-theme='dark']");
  });

  it('vscode adapter derives surfaces from --vscode-* variables', () => {
    const css = read('vscode.css');
    expect(css).toContain('var(--vscode-editor-background)');
    expect(css).toContain('var(--vscode-foreground)');
  });

  it('standalone adapter never references --vscode-* variables', () => {
    expect(read('standalone.css')).not.toContain('--vscode-');
  });
});
