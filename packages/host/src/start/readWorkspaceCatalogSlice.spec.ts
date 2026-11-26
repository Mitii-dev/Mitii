import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readWorkspaceCatalogSlice } from './readWorkspaceCatalogSlice.js';

describe('readWorkspaceCatalogSlice', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mitii-catalog-slice-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns undefined without package.json', async () => {
    await expect(readWorkspaceCatalogSlice(root)).resolves.toBeUndefined();
  });

  it('discovers workspace members + depends_on relationships', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'mono',
        packageManager: 'pnpm@9.15.0',
        workspaces: ['packages/*'],
        scripts: { build: 'pnpm -r build' },
      }),
      'utf8',
    );
    writeFileSync(join(root, 'tsconfig.json'), '{}', 'utf8');
    mkdirSync(join(root, 'packages', 'sdk'), { recursive: true });
    mkdirSync(join(root, 'packages', 'v8'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'sdk', 'package.json'),
      JSON.stringify({
        name: '@mitii/sdk',
        scripts: { test: 'vitest' },
      }),
      'utf8',
    );
    writeFileSync(
      join(root, 'packages', 'v8', 'package.json'),
      JSON.stringify({
        name: '@mitii/v8',
        dependencies: { '@mitii/sdk': 'workspace:*' },
        scripts: { test: 'vitest' },
      }),
      'utf8',
    );
    writeFileSync(
      join(root, 'packages', 'v8', 'tsconfig.json'),
      '{}',
      'utf8',
    );

    const slice = await readWorkspaceCatalogSlice(root);
    expect(slice?.projects[0]?.id).toBe('.');
    expect(slice?.projects[0]?.packageManager).toBe('pnpm');
    expect(slice?.projects.some((p) => p.id === 'packages/sdk')).toBe(true);
    expect(slice?.projects.some((p) => p.id === 'packages/v8')).toBe(true);
    expect(
      slice?.projects.find((p) => p.id === 'packages/sdk')?.name,
    ).toBe('@mitii/sdk');
    expect(slice?.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromProjectId: '.',
          toProjectId: 'packages/sdk',
          type: 'workspace_member',
        }),
        expect.objectContaining({
          fromProjectId: 'packages/v8',
          toProjectId: 'packages/sdk',
          type: 'depends_on',
        }),
      ]),
    );
    expect(slice?.configPointers).toEqual(
      expect.arrayContaining([
        'package.json',
        'tsconfig.json',
        'packages/v8/tsconfig.json',
      ]),
    );
  });
});
