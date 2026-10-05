import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeJsDiagnosticsPort } from './createNodeJsDiagnosticsPort.js';

describe('createNodeJsDiagnosticsPort', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports duplicate export as an error diagnostic', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-node-diag-'));
    dirs.push(root);
    writeFileSync(
      join(root, 'dup.js'),
      'export function foo() {}\nexport { foo };\n',
      'utf8',
    );

    const port = createNodeJsDiagnosticsPort({ workspaceRoot: root });
    const items = await port.readDiagnostics({
      workspaceRoot: root,
      paths: ['dup.js'],
    });

    expect(items.some((item) => item.severity === 'error')).toBe(true);
    expect(items[0]?.message).toMatch(/Duplicate export|SyntaxError/i);
  });

  it('returns no diagnostics for a clean module', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-node-diag-ok-'));
    dirs.push(root);
    writeFileSync(join(root, 'ok.js'), 'export function foo() { return 1; }\n', 'utf8');

    const port = createNodeJsDiagnosticsPort({ workspaceRoot: root });
    const items = await port.readDiagnostics({
      workspaceRoot: root,
      paths: ['ok.js'],
    });

    expect(items).toEqual([]);
  });
});
