/**
 * Resolve bundled tool binaries (rg / sg / scip-typescript) before PATH fallback.
 */

import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { resolveRuntimeFilename } from '../internal/resolveRuntimeFilename.js';

function requireFromHere() {
  return createRequire(resolveRuntimeFilename());
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    try {
      accessSync(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function requireWithFallback(specifier: string): string | undefined {
  try {
    return requireFromHere().resolve(specifier);
  } catch {
    try {
      return createRequire(join(process.cwd(), 'package.json')).resolve(
        specifier,
      );
    } catch {
      return undefined;
    }
  }
}

function resolvePackageJson(packageName: string): string | undefined {
  return requireWithFallback(`${packageName}/package.json`);
}

function binFromPackage(
  packageName: string,
  binName: string,
): string | undefined {
  const pkgJsonPath = resolvePackageJson(packageName);
  if (!pkgJsonPath) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const binField = pkg.bin;
    const rel =
      typeof binField === 'string'
        ? binField
        : (binField?.[binName] ??
          binField?.[Object.keys(binField ?? {})[0] ?? '']);
    if (!rel) return undefined;
    const abs = join(dirname(pkgJsonPath), rel);
    return isExecutable(abs) ? abs : undefined;
  } catch {
    return undefined;
  }
}

function detectAstGrepPlatformPackage(): string | undefined {
  const { platform, arch } = process;
  switch (platform) {
    case 'darwin':
      if (arch === 'arm64') return '@ast-grep/cli-darwin-arm64';
      if (arch === 'x64') return '@ast-grep/cli-darwin-x64';
      return undefined;
    case 'linux': {
      let libc: 'gnu' | 'musl' = 'gnu';
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const detect = requireFromHere()('detect-libc') as {
          familySync?: () => string;
          MUSL?: string;
        };
        if (detect.familySync?.() === detect.MUSL) libc = 'musl';
      } catch {
        /* default gnu */
      }
      if (arch === 'arm64') return `@ast-grep/cli-linux-arm64-${libc}`;
      if (arch === 'x64') return `@ast-grep/cli-linux-x64-${libc}`;
      return undefined;
    }
    case 'win32':
      if (arch === 'arm64') return '@ast-grep/cli-win32-arm64-msvc';
      if (arch === 'ia32') return '@ast-grep/cli-win32-ia32-msvc';
      if (arch === 'x64') return '@ast-grep/cli-win32-x64-msvc';
      return undefined;
    default:
      return undefined;
  }
}

/** Prefer `@vscode/ripgrep` platform binary, else PATH `rg`. */
export function resolveRipgrepBinary(override?: string): string {
  if (override && isExecutable(override)) return override;

  const arch = process.env.npm_config_arch || process.arch;
  const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const platformPkg = `@vscode/ripgrep-${process.platform}-${arch}`;
  const fromPlatform = requireWithFallback(`${platformPkg}/bin/${binaryName}`);
  if (fromPlatform && isExecutable(fromPlatform)) return fromPlatform;

  try {
    // ESM package: sync resolve may still surface platform path via CJS interop.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = requireFromHere()('@vscode/ripgrep') as { rgPath?: string };
    if (mod.rgPath && isExecutable(mod.rgPath)) return mod.rgPath;
  } catch {
    /* optional */
  }

  return 'rg';
}

/**
 * Prefer `@ast-grep/cli` native binary, then package shim, else PATH names.
 * Returns undefined when nothing is resolvable (caller probes PATH).
 */
export function resolveAstGrepBinary(override?: string): string | undefined {
  if (override && isExecutable(override)) return override;

  const binaryName =
    process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep';
  const platformPkg = detectAstGrepPlatformPackage();
  if (platformPkg) {
    const pkgJson = resolvePackageJson(platformPkg);
    if (pkgJson) {
      const native = join(dirname(pkgJson), binaryName);
      if (isExecutable(native)) return native;
    }
  }

  const fromPkg = binFromPackage('@ast-grep/cli', 'ast-grep');
  if (fromPkg) return fromPkg;

  return undefined;
}

/**
 * Resolve `scip-typescript` when present as a local package.
 * Not an optionalDependency of @mitii/host (upstream ships a `.vscode/` tree);
 * workspaces may install it explicitly or put `scip-typescript` on PATH.
 */
export function resolveScipTypescriptBinary(): string | undefined {
  return binFromPackage('@sourcegraph/scip-typescript', 'scip-typescript');
}

export function mitiiScipDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'scip');
}

export function scipIndexPaths(workspaceRoot: string): {
  dir: string;
  scip: string;
  jsonl: string;
  workspaceScip: string;
} {
  const dir = mitiiScipDir(workspaceRoot);
  return {
    dir,
    scip: join(dir, 'index.scip'),
    jsonl: join(dir, 'index.jsonl'),
    workspaceScip: join(workspaceRoot, 'index.scip'),
  };
}

export function hasTsOrJsProject(workspaceRoot: string): boolean {
  return (
    existsSync(join(workspaceRoot, 'tsconfig.json')) ||
    existsSync(join(workspaceRoot, 'jsconfig.json')) ||
    existsSync(join(workspaceRoot, 'package.json'))
  );
}
