/**
 * Factual workspace relationships for Orient — never invents links.
 */

import type { DiscoveredProject } from './discoverWorkspaceProjects.js';

export interface CatalogRelationship {
  fromProjectId: string;
  toProjectId: string;
  type: 'workspace_member' | 'depends_on' | 'development_depends_on';
}

export function extractCatalogRelationships(
  projects: readonly DiscoveredProject[],
): CatalogRelationship[] {
  const relationships: CatalogRelationship[] = [];
  const seen = new Set<string>();
  const byName = new Map<string, DiscoveredProject[]>();

  for (const project of projects) {
    if (!project.name) continue;
    const list = byName.get(project.name) ?? [];
    list.push(project);
    byName.set(project.name, list);
  }

  const root = projects.find((p) => p.id === '.');
  if (root) {
    for (const member of projects) {
      if (member.id === '.') continue;
      push(relationships, seen, {
        fromProjectId: '.',
        toProjectId: member.id,
        type: 'workspace_member',
      });
    }
  }

  for (const project of projects) {
    addDeps(
      project,
      project.dependencies ?? [],
      'depends_on',
      byName,
      relationships,
      seen,
    );
    addDeps(
      project,
      project.developmentDependencies ?? [],
      'development_depends_on',
      byName,
      relationships,
      seen,
    );
  }

  return relationships.sort((a, b) =>
    `${a.fromProjectId}\0${a.toProjectId}\0${a.type}`.localeCompare(
      `${b.fromProjectId}\0${b.toProjectId}\0${b.type}`,
    ),
  );
}

function addDeps(
  project: DiscoveredProject,
  names: readonly string[],
  type: 'depends_on' | 'development_depends_on',
  byName: ReadonlyMap<string, readonly DiscoveredProject[]>,
  relationships: CatalogRelationship[],
  seen: Set<string>,
): void {
  for (const name of names) {
    const matches = (byName.get(name) ?? []).filter(
      (p) => p.id !== project.id,
    );
    if (matches.length !== 1) continue;
    const target = matches[0]!;
    push(relationships, seen, {
      fromProjectId: project.id,
      toProjectId: target.id,
      type,
    });
  }
}

function push(
  relationships: CatalogRelationship[],
  seen: Set<string>,
  rel: CatalogRelationship,
): void {
  const key = `${rel.fromProjectId}\0${rel.toProjectId}\0${rel.type}`;
  if (seen.has(key)) return;
  seen.add(key);
  relationships.push(rel);
}
