/**
 * Discover real workspace packages under npm/pnpm/yarn workspace patterns.
 * Soft-fail per entry — never invents packages without package.json.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CatalogProjectSlice } from './readWorkspaceCatalogSlice.js';

export interface DiscoveredProject extends CatalogProjectSlice {
  name?: string;
  dependencies?: string[];
  developmentDependencies?: string[];
}

function detectPackageManager(
  pkg: Record<string, unknown>,
): string | undefined {
  if (typeof pkg.packageManager === 'string' && pkg.packageManager.trim()) {
    const raw = pkg.packageManager.trim();
    if (raw.startsWith('pnpm')) return 'pnpm';
    if (raw.startsWith('yarn')) return 'yarn';
    if (raw.startsWith('npm')) return 'npm';
    if (raw.startsWith('bun')) return 'bun';
  }
  return undefined;
}

function asStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const out = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => typeof v === 'string',
    ) as Array<[string, string]>,
  );
  return Object.keys(out).length > 0 ? out : undefined;
}

function dependencyNames(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 128);
}

function inferTestRoots(
  scripts: Record<string, string> | undefined,
  projectId: string,
): string[] {
  if (!scripts) return [];
  const keys = Object.keys(scripts);
  if (keys.some((k) => /test|vitest|jest|mocha/.test(k))) {
    return [`${projectId === '.' ? '' : `${projectId}/`}tests`.replace(
      /^\//,
      '',
    )];
  }
  return [];
}

export async function readProjectAt(
  workspaceRoot: string,
  relativeId: string,
  packageManager?: string,
): Promise<DiscoveredProject | undefined> {
  const id = relativeId.replace(/\/+$/, '') || '.';
  const pkgPath = join(
    workspaceRoot,
    id === '.' ? 'package.json' : join(id, 'package.json'),
  );
  let raw: string;
  try {
    raw = await readFile(pkgPath, 'utf8');
  } catch {
    return undefined;
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const scripts = asStringRecord(pkg.scripts);
  const name =
    typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name.trim() : undefined;
  const deps = dependencyNames(pkg.dependencies);
  const devDeps = dependencyNames(pkg.devDependencies);
  const pm = detectPackageManager(pkg) ?? packageManager;
  const testRoots = inferTestRoots(scripts, id);

  return {
    id,
    ...(name ? { name } : {}),
    language: 'typescript',
    ...(pm ? { packageManager: pm } : {}),
    ...(scripts ? { scripts } : {}),
    ...(testRoots.length > 0 ? { testRoots } : { testRoots: [] }),
    ...(deps.length > 0 ? { dependencies: deps } : {}),
    ...(devDeps.length > 0 ? { developmentDependencies: devDeps } : {}),
  };
}

/**
 * Expand workspace globs one level (packages/* → packages/foo, …).
 */
export async function expandWorkspacePattern(
  workspaceRoot: string,
  pattern: string,
  packageManager?: string,
  limit = 48,
): Promise<DiscoveredProject[]> {
  const normalized = pattern.replace(/\/+$/, '');
  if (!normalized.includes('*')) {
    const project = await readProjectAt(
      workspaceRoot,
      normalized,
      packageManager,
    );
    return project ? [project] : [];
  }

  // Support patterns like "packages/*" or "apps/*" only (one segment wildcard).
  const starIdx = normalized.indexOf('*');
  if (starIdx < 0) return [];
  const before = normalized.slice(0, starIdx).replace(/\/+$/, '');
  const after = normalized.slice(starIdx + 1).replace(/^\//, '');
  if (after.includes('*') || after.includes('/')) {
    // Multi-segment globs omitted — keep host gather cheap.
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(join(workspaceRoot, before || '.'));
  } catch {
    return [];
  }

  const out: DiscoveredProject[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const id = before ? `${before}/${entry}` : entry;
    const project = await readProjectAt(workspaceRoot, id, packageManager);
    if (project) {
      out.push(project);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export async function readPnpmWorkspacePatterns(
  workspaceRoot: string,
): Promise<string[]> {
  try {
    const raw = await readFile(
      join(workspaceRoot, 'pnpm-workspace.yaml'),
      'utf8',
    );
    const patterns: string[] = [];
    let inPackages = false;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('packages:')) {
        inPackages = true;
        continue;
      }
      if (!inPackages) continue;
      if (/^[a-zA-Z]/.test(trimmed) && !trimmed.startsWith('-')) {
        break;
      }
      const m = trimmed.match(/^-\s+['"]?([^'"]+)['"]?$/);
      if (m?.[1]) patterns.push(m[1]);
    }
    return patterns;
  } catch {
    return [];
  }
}
