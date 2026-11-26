import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative, sep } from 'path';

/**
 * Shared helpers for V8 architecture tests. Everything here is read-only
 * source analysis; no test in this folder imports production code.
 */

/** Monorepo root or `packages/v8` — vitest may start in either. */
const cwd = process.cwd();
export const v8PackageRoot = existsSync(join(cwd, 'src/runtime'))
  ? cwd
  : join(cwd, 'packages/v8');
export const repoRoot = existsSync(join(cwd, 'packages/v8/src'))
  ? cwd
  : join(v8PackageRoot, '../..');
export const v8SrcRoot = join(v8PackageRoot, 'src');
export const modulesRoot = join(v8SrcRoot, 'modules');
export const engineRoot = join(v8SrcRoot, 'engine');
/** Clubbed rewrite target (ENGINE_REWRITE_PLAN) — coexists with engine/ during cutover. */
export const runtimeRoot = join(v8SrcRoot, 'runtime');
export const baselinesRoot = join(
  v8PackageRoot,
  'tests/architecture/baselines',
);

export const PUBLIC_MODULES = [
  'request-intake',
  'request-understanding',
  'repository-state',
  'repository-context',
  'decision-policy',
  'mcp-attach',
  'prompt-construction',
  'model-gateway',
  'verification',
  'skills',
  'memory',
  'planning',
  'task-list',
  'code-navigation',
  'change-impact',
  'review',
  'window-budget',
] as const;

export const PUBLIC_ENGINE_COMPONENTS = ['v8-engine', 'tool-runtime'] as const;

export interface PublicRoot {
  readonly name: string;
  readonly root: string;
}

export const PUBLIC_ROOTS: readonly PublicRoot[] = [
  ...PUBLIC_MODULES.map((name) => ({ name, root: join(modulesRoot, name) })),
  ...PUBLIC_ENGINE_COMPONENTS.map((name) => ({
    name,
    root: join(engineRoot, name),
  })),
];

export function toRepoPath(file: string): string {
  return relative(repoRoot, file).split(sep).join('/');
}

export function listTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith('.ts')) files.push(abs);
    }
  };
  if (existsSync(root)) walk(root);
  return files.sort();
}

export function listRuntimeTypeScriptFiles(): string[] {
  return [modulesRoot, engineRoot, runtimeRoot].flatMap(listTypeScriptFiles);
}

export function isTestFile(file: string): boolean {
  const rel = toRepoPath(file);
  return (
    /\.(?:spec|test)\.ts$/.test(rel) ||
    /(?:^|\/)tests?\//.test(rel) ||
    /(?:^|\/)fixtures\//.test(rel)
  );
}

export function owningPublicUnit(file: string): string | undefined {
  for (const { name, root } of PUBLIC_ROOTS) {
    const rel = relative(root, file);
    if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) {
      return name;
    }
  }
  return undefined;
}

export function publicRootOf(unit: string): string {
  const found = PUBLIC_ROOTS.find((candidate) => candidate.name === unit);
  if (!found) throw new Error(`unknown public unit: ${unit}`);
  return found.root;
}

export interface ImportRef {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly text: string;
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/,
] as const;

export function readImportRefs(file: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const [index, text] of readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .entries()) {
    for (const pattern of SPECIFIER_PATTERNS) {
      const specifier = text.match(pattern)?.[1];
      if (specifier) {
        refs.push({ file, line: index + 1, specifier, text: text.trim() });
        break;
      }
    }
  }
  return refs;
}

export function scanImports(root: string, patterns: readonly RegExp[]): string[] {
  return listTypeScriptFiles(root).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => patterns.some((pattern) => pattern.test(line)))
      .map(({ line, index }) => `${toRepoPath(file)}:${index + 1}: ${line.trim()}`),
  );
}

/** Cross-unit relative import: importer unit, target unit, target path within it. */
export interface CrossUnitImport extends ImportRef {
  readonly fromUnit: string;
  readonly toUnit: string;
  /** Target path relative to the owner root ('' for the root index). */
  readonly targetRel: string;
}

export function listCrossUnitImports(): CrossUnitImport[] {
  const out: CrossUnitImport[] = [];
  for (const file of listRuntimeTypeScriptFiles()) {
    const fromUnit = owningPublicUnit(file);
    if (!fromUnit) continue;
    for (const ref of readImportRefs(file)) {
      if (!ref.specifier.startsWith('.')) continue;
      const target = join(dirname(file), ref.specifier);
      const toUnit = owningPublicUnit(target);
      if (!toUnit || toUnit === fromUnit) continue;
      const rel = relative(publicRootOf(toUnit), target)
        .split(sep)
        .join('/');
      out.push({
        ...ref,
        fromUnit,
        toUnit,
        targetRel: rel === 'index' ? '' : rel,
      });
    }
  }
  return out;
}

/** Shrinking baselines: entries may only be removed, never added. */
export function readBaseline<T>(name: string, fallback: T): T {
  const path = join(baselinesRoot, name);
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export const WRITE_BASELINES = process.env.MITII_ARCH_WRITE_BASELINES === '1';

export function writeBaseline(name: string, value: unknown): void {
  writeFileSync(
    join(baselinesRoot, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

/**
 * Compare current violations to a shrinking allowlist.
 * `added` fail the build; `stale` entries must be removed (ratchet).
 */
export function diffAgainstBaseline(
  current: readonly string[],
  baseline: readonly string[],
): { added: string[]; stale: string[] } {
  const base = new Set(baseline);
  const now = new Set(current);
  return {
    added: [...now].filter((entry) => !base.has(entry)).sort(),
    stale: [...base].filter((entry) => !now.has(entry)).sort(),
  };
}
