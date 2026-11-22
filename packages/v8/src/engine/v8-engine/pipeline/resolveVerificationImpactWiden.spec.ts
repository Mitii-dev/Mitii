import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_SCHEMA_VERSION,
} from "../../../modules/change-impact";
import type { RepositoryGraphPort } from "../../../modules/change-impact";
import {
  createGraph,
  edge,
  fileNode,
} from "../../../modules/change-impact/tests/fixtures/changeImpactGraphFixtures";
import { resolveVerificationImpactWiden } from "./resolveVerificationImpactWiden";

describe("resolveVerificationImpactWiden", () => {
  it("prefers explicit impact files from a prior tool result", async () => {
    const result = await resolveVerificationImpactWiden({
      changedFiles: ["src/a.ts"],
      explicitAffectedFiles: ["src/b.ts", "packages/x/src/c.ts"],
      explicitWiden: true,
    });
    expect(result.widenScope).toBe(true);
    expect(result.impactAffectedFiles).toEqual([
      "src/b.ts",
      "packages/x/src/c.ts",
    ]);
  });

  it("walks changed files through the published graph when no explicit hints", async () => {
    const graph = createGraph({
      nodes: [
        fileNode("file:a", "src/a.ts"),
        fileNode("file:b", "src/b.ts"),
      ],
      edges: [edge("e1", "imports", "file:b", "file:a", 2, 1)],
    });
    const repoGraphs: RepositoryGraphPort = {
      loadGraphs: () => [graph],
    };

    const result = await resolveVerificationImpactWiden({
      repoGraphs,
      changedFiles: ["src/a.ts"],
    });

    expect(result.impactAffectedFiles).toEqual(
      expect.arrayContaining(["src/b.ts"]),
    );
    void CHANGE_IMPACT_SCHEMA_VERSION;
  });
});
