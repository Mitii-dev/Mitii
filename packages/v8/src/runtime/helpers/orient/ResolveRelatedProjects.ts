/**
 * Related packages from catalog relationships for the owning workRoot.
 * Awareness only — never a mutation fence.
 */

export interface CatalogRelationshipRef {
  fromProjectId: string;
  toProjectId: string;
  type: string;
}

export function resolveRelatedProjects(input: {
  workRoot?: string;
  relationships?: readonly CatalogRelationshipRef[];
  limit?: number;
}): string[] {
  const workRoot = input.workRoot?.trim();
  if (!workRoot || workRoot === ".") return [];
  const limit = input.limit ?? 16;
  const related = new Set<string>();

  for (const rel of input.relationships ?? []) {
    if (rel.fromProjectId === workRoot && rel.toProjectId !== workRoot) {
      related.add(rel.toProjectId);
    } else if (rel.toProjectId === workRoot && rel.fromProjectId !== workRoot) {
      // Dependents / workspace parent (skip bare root ".")
      if (rel.fromProjectId !== ".") {
        related.add(rel.fromProjectId);
      }
    }
    if (related.size >= limit) break;
  }

  return [...related].sort((a, b) => a.localeCompare(b)).slice(0, limit);
}
