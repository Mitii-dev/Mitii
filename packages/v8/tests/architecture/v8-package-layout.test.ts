import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  engineRoot,
  modulesRoot,
  PUBLIC_ENGINE_COMPONENTS,
  PUBLIC_MODULES,
  PUBLIC_ROOTS,
  repoRoot,
  scanImports,
  v8PackageRoot,
  v8SrcRoot,
} from './support/v8Sources';

describe('v8 package layout', () => {
  it('places live V8 under packages/v8 with no parallel src/v8 tree', () => {
    expect(existsSync(v8PackageRoot)).toBe(true);
    expect(existsSync(modulesRoot)).toBe(true);
    expect(existsSync(engineRoot)).toBe(true);
    expect(existsSync(join(v8PackageRoot, 'package.json'))).toBe(true);
    expect(existsSync(join(repoRoot, 'src/v8'))).toBe(false);
    expect(existsSync(join(modulesRoot, 'agent-engine'))).toBe(false);
    expect(existsSync(join(modulesRoot, 'tool-runtime'))).toBe(false);
    expect(existsSync(join(v8SrcRoot, 'core'))).toBe(false);
    expect(existsSync(join(v8SrcRoot, 'repository'))).toBe(false);
    expect(existsSync(join(v8SrcRoot, 'intent'))).toBe(false);
  });

  it('names the package @mitii/v8 without vscode or sdk runtime deps', () => {
    const pkg = JSON.parse(
      readFileSync(join(v8PackageRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe('@mitii/v8');
    const runtimeDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    };
    expect(runtimeDeps).not.toHaveProperty('vscode');
    expect(runtimeDeps).not.toHaveProperty('@mitii/sdk');
    expect(runtimeDeps).not.toHaveProperty('@types/vscode');
  });

  it('places contracts/ under every public module and engine root', () => {
    const missing = PUBLIC_ROOTS.filter(
      ({ root }) => !existsSync(join(root, 'contracts')),
    ).map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it('registers all expected public module folders', () => {
    const dirs = readdirSync(modulesRoot).filter((entry) =>
      statSync(join(modulesRoot, entry)).isDirectory(),
    );
    expect(dirs.sort()).toEqual([...PUBLIC_MODULES].sort());
  });

  it('registers all expected public engine folders', () => {
    const dirs = readdirSync(engineRoot).filter((entry) =>
      statSync(join(engineRoot, entry)).isDirectory(),
    );
    expect(dirs.sort()).toEqual([...PUBLIC_ENGINE_COMPONENTS].sort());
  });

  it('gives every public module and engine root an index.ts', () => {
    const missing = PUBLIC_ROOTS.filter(
      ({ root }) => !existsSync(join(root, 'index.ts')),
    ).map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it('bans every vscode import form anywhere in packages/v8', () => {
    const vscodeImportPatterns = [
      /\bfrom\s+['"]vscode['"]/,
      /\bimport\(\s*['"]vscode['"]\s*\)/,
      /\brequire\(\s*['"]vscode['"]\s*\)/,
      /\bimport\s+['"]vscode['"]/,
    ] as const;
    const violations = [
      ...scanImports(v8SrcRoot, vscodeImportPatterns),
      ...scanImports(join(v8PackageRoot, 'tests'), vscodeImportPatterns),
    ];
    expect(violations).toEqual([]);
  });

  it('does not keep the dead VS Code file-system adapter inside V8', () => {
    expect(
      existsSync(
        join(
          modulesRoot,
          'repository-state/internal/shared/filesystem/VsCodeFileSystemAdapter.ts',
        ),
      ),
    ).toBe(false);
  });
});
