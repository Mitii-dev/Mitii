import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      out.push(...walkTs(full));
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('desktop architecture boundaries', () => {
  it('does not import sibling apps (REPO_LAYOUT forbids app→app)', () => {
    const files = walkTs(join(root, 'src'));
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (
        /from\s+['"]@mitii\/(?:cli|daemon|acp)['"]/.test(text) ||
        /from\s+['"].*apps\/(?:cli|daemon|acp|vscode)/.test(text)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('depends inward through host/sdk only in package.json', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).toContain('@mitii/host');
    expect(deps).toContain('@mitii/sdk');
    expect(deps).toContain('@mitii/mcp');
    expect(deps).not.toContain('@mitii/cli');
    expect(deps).not.toContain('@mitii/acp');
    expect(deps).not.toContain('@mitii/daemon');
  });
});
