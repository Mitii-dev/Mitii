import { normalizeRelativePath, normalizeRelativeRoot } from "./ProjectCatalogHelpers";

import type {
  ProjectCatalogWarning,
  ProjectDefinition,
  ProjectRelationship,
  ProjectRelationshipType,
} from "./types";

/**
 * Build factual project relationships from declared workspace patterns and
 * uniquely resolved dependency names. Never invents links when the target is
 * missing or ambiguous.
 */
export function extractProjectRelationships(params: {
  projects: readonly ProjectDefinition[];
  warnings: ProjectCatalogWarning[];
}): ProjectRelationship[] {
  const relationships: ProjectRelationship[] = [];
  const seen = new Set<string>();

  const projectsByName = indexProjectsByName(params.projects);

  for (const project of params.projects) {
    for (const pattern of project.workspaceMemberPatterns ?? []) {
      const members = matchWorkspaceMembers(project, pattern, params.projects);
      if (members.length === 0) {
        params.warnings.push({
          code: "relationship_target_unresolved",
          path: project.relativeRoot || ".",
          message:
            `Workspace pattern "${pattern}" did not match any detected project.`,
        });
        continue;
      }
      for (const member of members) {
        pushRelationship(relationships, seen, {
          fromProjectId: project.id,
          toProjectId: member.id,
          type: "workspace_member",
        });
      }
    }

    addDependencyRelationships({
      project,
      dependencyNames: project.dependencies,
      type: "depends_on",
      projectsByName,
      relationships,
      seen,
      warnings: params.warnings,
    });
    addDependencyRelationships({
      project,
      dependencyNames: project.developmentDependencies,
      type: "development_depends_on",
      projectsByName,
      relationships,
      seen,
      warnings: params.warnings,
    });
  }

  return relationships.sort((left, right) =>
    [left.fromProjectId, left.toProjectId, left.type]
      .join("\u0000")
      .localeCompare(
        [right.fromProjectId, right.toProjectId, right.type].join("\u0000"),
      ),
  );
}

function addDependencyRelationships(params: {
  project: ProjectDefinition;
  dependencyNames: readonly string[];
  type: Extract<
    ProjectRelationshipType,
    "depends_on" | "development_depends_on"
  >;
  projectsByName: ReadonlyMap<string, readonly ProjectDefinition[]>;
  relationships: ProjectRelationship[];
  seen: Set<string>;
  warnings: ProjectCatalogWarning[];
}): void {
  for (const dependencyName of params.dependencyNames) {
    const matches = params.projectsByName.get(dependencyName) ?? [];
    const others = matches.filter((candidate) => candidate.id !== params.project.id);
    if (others.length === 0) {
      continue;
    }
    if (others.length > 1) {
      params.warnings.push({
        code: "relationship_target_ambiguous",
        path: params.project.relativeRoot || ".",
        message:
          `Dependency "${dependencyName}" matched multiple projects; ` +
          "relationship omitted.",
      });
      continue;
    }
    const target = others[0]!;
    pushRelationship(params.relationships, params.seen, {
      fromProjectId: params.project.id,
      toProjectId: target.id,
      type: params.type,
    });
  }
}

function indexProjectsByName(
  projects: readonly ProjectDefinition[],
): Map<string, ProjectDefinition[]> {
  const byName = new Map<string, ProjectDefinition[]>();
  for (const project of projects) {
    const key = project.name.trim();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(project);
    byName.set(key, list);
  }
  return byName;
}

function matchWorkspaceMembers(
  owner: ProjectDefinition,
  pattern: string,
  projects: readonly ProjectDefinition[],
): ProjectDefinition[] {
  const normalizedPattern = normalizeRelativePath(pattern);
  if (!normalizedPattern) return [];

  const absolutePattern = joinProjectRelative(
    owner.relativeRoot,
    normalizedPattern,
  );

  return projects.filter((candidate) => {
    if (candidate.id === owner.id) return false;
    return matchesWorkspacePattern(
      normalizeRelativeRoot(candidate.relativeRoot),
      absolutePattern,
    );
  });
}

function joinProjectRelative(projectRoot: string, relativePattern: string): string {
  const root = normalizeRelativeRoot(projectRoot);
  if (!root) return relativePattern;
  if (!relativePattern) return root;
  return normalizeRelativePath(`${root}/${relativePattern}`);
}

/**
 * Supports exact roots and a single trailing `*` segment (for example
 * `packages/*`). Broader `**` globs are treated as prefix matches only when
 * they end with `/**`.
 */
export function matchesWorkspacePattern(
  relativeRoot: string,
  pattern: string,
): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    if (!prefix) return relativeRoot.length > 0;
    return (
      relativeRoot === prefix || relativeRoot.startsWith(`${prefix}/`)
    );
  }

  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    if (!prefix) {
      return relativeRoot.length > 0 && !relativeRoot.includes("/");
    }
    if (!relativeRoot.startsWith(`${prefix}/`)) return false;
    const remainder = relativeRoot.slice(prefix.length + 1);
    return remainder.length > 0 && !remainder.includes("/");
  }

  return relativeRoot === pattern;
}

function pushRelationship(
  relationships: ProjectRelationship[],
  seen: Set<string>,
  relationship: ProjectRelationship,
): void {
  const key = [
    relationship.fromProjectId,
    relationship.toProjectId,
    relationship.type,
  ].join("\u0000");
  if (seen.has(key)) return;
  seen.add(key);
  relationships.push(relationship);
}
