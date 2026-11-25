import { describe, expect, it } from "vitest";

import {
  extractProjectRelationships,
  matchesWorkspacePattern,
} from "./extractProjectRelationships";
import type {
  ProjectCatalogWarning,
  ProjectDefinition,
} from "./types";

describe("extractProjectRelationships", () => {
  it("emits workspace_member edges for declared patterns", () => {
    const warnings: ProjectCatalogWarning[] = [];
    const relationships = extractProjectRelationships({
      projects: [
        project({
          id: "root",
          name: "root",
          relativeRoot: "",
          workspaceMemberPatterns: ["packages/*"],
        }),
        project({
          id: "sdk",
          name: "@mitii/sdk",
          relativeRoot: "packages/sdk",
        }),
        project({
          id: "v8",
          name: "@mitii/v8",
          relativeRoot: "packages/v8",
        }),
      ],
      warnings,
    });

    expect(relationships).toEqual(
      expect.arrayContaining([
        {
          fromProjectId: "root",
          toProjectId: "sdk",
          type: "workspace_member",
        },
        {
          fromProjectId: "root",
          toProjectId: "v8",
          type: "workspace_member",
        },
      ]),
    );
    expect(warnings).toEqual([]);
  });

  it("emits depends_on only for uniquely named workspace packages", () => {
    const warnings: ProjectCatalogWarning[] = [];
    const relationships = extractProjectRelationships({
      projects: [
        project({
          id: "app",
          name: "app",
          relativeRoot: "apps/app",
          dependencies: ["@mitii/sdk", "lodash"],
        }),
        project({
          id: "sdk",
          name: "@mitii/sdk",
          relativeRoot: "packages/sdk",
        }),
      ],
      warnings,
    });

    expect(relationships).toEqual([
      {
        fromProjectId: "app",
        toProjectId: "sdk",
        type: "depends_on",
      },
    ]);
    expect(warnings).toEqual([]);
  });

  it("omits ambiguous dependency targets with a warning", () => {
    const warnings: ProjectCatalogWarning[] = [];
    const relationships = extractProjectRelationships({
      projects: [
        project({
          id: "app",
          name: "app",
          relativeRoot: "apps/app",
          dependencies: ["shared"],
        }),
        project({
          id: "shared-a",
          name: "shared",
          relativeRoot: "packages/shared-a",
        }),
        project({
          id: "shared-b",
          name: "shared",
          relativeRoot: "packages/shared-b",
        }),
      ],
      warnings,
    });

    expect(relationships).toEqual([]);
    expect(warnings[0]?.code).toBe("relationship_target_ambiguous");
  });
});

describe("matchesWorkspacePattern", () => {
  it("matches single-segment globs and exact roots", () => {
    expect(matchesWorkspacePattern("packages/sdk", "packages/*")).toBe(true);
    expect(matchesWorkspacePattern("packages/sdk/nested", "packages/*")).toBe(
      false,
    );
    expect(matchesWorkspacePattern("packages/sdk", "packages/sdk")).toBe(true);
    expect(matchesWorkspacePattern("packages/sdk/util", "packages/**")).toBe(
      true,
    );
  });
});

function project(input: {
  id: string;
  name: string;
  relativeRoot: string;
  dependencies?: string[];
  developmentDependencies?: string[];
  workspaceMemberPatterns?: string[];
}): ProjectDefinition {
  return {
    id: input.id,
    rootId: "workspace",
    relativeRoot: input.relativeRoot,
    name: input.name,
    ecosystems: ["node"],
    manifests: [],
    entryFiles: [],
    sourceRoots: [],
    testRoots: [],
    scripts: {},
    dependencies: input.dependencies ?? [],
    developmentDependencies: input.developmentDependencies ?? [],
    ...(input.workspaceMemberPatterns
      ? { workspaceMemberPatterns: input.workspaceMemberPatterns }
      : {}),
  };
}
