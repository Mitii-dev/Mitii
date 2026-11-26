/**
 * Best-effort catalog slice for Orient — no full repository-state pin required.
 * Discovers workspace packages, scripts, relationships, and config pointers.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  expandWorkspacePattern,
  readPnpmWorkspacePatterns,
  readProjectAt,
  type DiscoveredProject,
} from './discoverWorkspaceProjects.js';
import {
  extractCatalogRelationships,
  type CatalogRelationship,
} from './extractCatalogRelationships.js';

export interface CatalogProjectSlice {
  id: string;
  name?: string;
  language?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  testRoots?: string[];
}

export interface WorkspaceCatalogSlice {
  projects: CatalogProjectSlice[];
  configPointers: string[];
  relationships: CatalogRelationship[];
}

function workspacePatternsFromPkg(pkg: Record<string, unknown>): string[] {
  const workspaces = pkg.workspaces;
  if (Array.isArray(workspaces)) {
    return workspaces.filter((w): w is string => typeof w === 'string');
  }
  if (
    workspaces &&
    typeof workspaces === 'object' &&
    Array.isArray((workspaces as { packages?: unknown }).packages)
  ) {
    return ((workspaces as { packages: unknown[] }).packages).filter(
      (w): w is string => typeof w === 'string',
    );
  }
  return [];
}

function toPublicProject(project: DiscoveredProject): CatalogProjectSlice {
  return {
    id: project.id,
    ...(project.name ? { name: project.name } : {}),
    ...(project.language ? { language: project.language } : {}),
    ...(project.packageManager
      ? { packageManager: project.packageManager }
      : {}),
    ...(project.scripts ? { scripts: project.scripts } : {}),
    ...(project.testRoots ? { testRoots: project.testRoots } : {}),
  };
}

async function collectConfigPointers(
  workspaceRoot: string,
  projects: readonly CatalogProjectSlice[],
): Promise<string[]> {
  const pointers = new Set<string>();
  const rootNames = [
    'package.json',
    'tsconfig.json',
    'pnpm-workspace.yaml',
    'turbo.json',
    'nx.json',
  ];
  for (const name of rootNames) {
    try {
      await readFile(join(workspaceRoot, name));
      pointers.add(name);
    } catch {
      // omit
    }
  }

  for (const project of projects.slice(0, 32)) {
    if (project.id === '.') continue;
    for (const name of ['package.json', 'tsconfig.json']) {
      const rel = `${project.id}/${name}`;
      try {
        await readFile(join(workspaceRoot, rel));
        pointers.add(rel);
      } catch {
        // omit
      }
    }
  }

  return [...pointers].slice(0, 64);
}

/**
 * Read a thin catalog slice from disk. Soft-fail → undefined.
 */
export async function readWorkspaceCatalogSlice(
  workspaceRoot: string,
): Promise<WorkspaceCatalogSlice | undefined> {
  const root = await readProjectAt(workspaceRoot, '.');
  if (!root) return undefined;

  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(
      await readFile(join(workspaceRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
  } catch {
    pkg = {};
  }

  const patterns = [
    ...workspacePatternsFromPkg(pkg),
    ...(await readPnpmWorkspacePatterns(workspaceRoot)),
  ];
  const uniquePatterns = [...new Set(patterns)].slice(0, 24);

  const discovered: DiscoveredProject[] = [root];
  const seenIds = new Set<string>(['.']);

  for (const pattern of uniquePatterns) {
    const members = await expandWorkspacePattern(
      workspaceRoot,
      pattern,
      root.packageManager,
    );
    for (const member of members) {
      if (seenIds.has(member.id)) continue;
      seenIds.add(member.id);
      discovered.push(member);
      if (discovered.length >= 48) break;
    }
    if (discovered.length >= 48) break;
  }

  const projects = discovered.map(toPublicProject);
  const relationships = extractCatalogRelationships(discovered);
  const configPointers = await collectConfigPointers(workspaceRoot, projects);

  return { projects, configPointers, relationships };
}
