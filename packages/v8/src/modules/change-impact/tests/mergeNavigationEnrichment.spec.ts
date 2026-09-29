import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  mergeNavigationEnrichment,
  type ChangeImpactResult,
} from "../index";

describe("mergeNavigationEnrichment", () => {
  it("merges unique code-nav paths and marks lsp_enriched", () => {
    const base = emptyResult({
      affectedFiles: [
        {
          relativePath: "src/existing.ts",
          hop: 1,
          score: 0.8,
          affectedNodeIds: ["file:existing"],
          reason: "imports",
          bucket: "prod",
        },
      ],
      reasonCodes: ["no_dependents"],
    });

    const merged = mergeNavigationEnrichment({
      result: base,
      locations: [
        { relativePath: "src/existing.ts" },
        { relativePath: "src/from-lsp.ts", line: 4, symbolName: "useIt" },
        { relativePath: "src/also.ts" },
      ],
    });

    expect(merged.reasonCodes).toContain("lsp_enriched");
    expect(merged.reasonCodes).toContain("impact_resolved");
    expect(merged.reasonCodes).not.toContain("no_dependents");
    expect(merged.affectedFiles.map((f) => f.relativePath)).toEqual([
      "src/existing.ts",
      "src/also.ts",
      "src/from-lsp.ts",
    ]);
    expect(merged.warnings.some((w) => w.code === "lsp_enriched")).toBe(true);
    expect(
      merged.affected.some((n) => n.relativePath === "src/from-lsp.ts"),
    ).toBe(true);
  });

  it("is a no-op when all locations already present", () => {
    const base = emptyResult({
      affectedFiles: [
        {
          relativePath: "src/a.ts",
          hop: 1,
          score: 0.5,
          affectedNodeIds: ["file:a"],
          reason: "imports",
          bucket: "prod",
        },
      ],
      reasonCodes: ["impact_resolved"],
    });

    const merged = mergeNavigationEnrichment({
      result: base,
      locations: [{ relativePath: "src/a.ts" }],
    });

    expect(merged).toBe(base);
  });
});

function emptyResult(
  overrides: Partial<ChangeImpactResult> &
    Pick<ChangeImpactResult, "affectedFiles" | "reasonCodes">,
): ChangeImpactResult {
  return {
    schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
    status: "empty",
    direction: "dependents",
    seed: { kind: "file", relativePath: "src/core.ts" },
    resolvedSeeds: [
      {
        nodeId: "file:core",
        kind: "file",
        relativePath: "src/core.ts",
      },
    ],
    affected: [],
    packagesAffected: [],
    chains: [],
    directNeighborCounts: { nodes: 0, files: 0 },
    truncated: false,
    warnings: [],
    ...overrides,
  };
}
