import { describe, expect, it } from "vitest";

import { buildOrientSurroundings } from "../../helpers/orient/BuildOrientSurroundings";
import { resolveConfigNearFocus } from "../../helpers/orient/ResolveConfigNearFocus";
import { resolveRelatedProjects } from "../../helpers/orient/ResolveRelatedProjects";

describe("resolveRelatedProjects", () => {
  it("returns dependents and dependencies for workRoot", () => {
    expect(
      resolveRelatedProjects({
        workRoot: "packages/v8",
        relationships: [
          {
            fromProjectId: ".",
            toProjectId: "packages/v8",
            type: "workspace_member",
          },
          {
            fromProjectId: "packages/v8",
            toProjectId: "packages/sdk",
            type: "depends_on",
          },
          {
            fromProjectId: "apps/cli",
            toProjectId: "packages/v8",
            type: "depends_on",
          },
        ],
      }),
    ).toEqual(["apps/cli", "packages/sdk"]);
  });
});

describe("buildOrientSurroundings", () => {
  it("boosts workRoot, focus parents, and related projects", () => {
    expect(
      buildOrientSurroundings({
        focusPaths: ["packages/v8/src/runtime/index.ts"],
        workRoot: "packages/v8",
        relatedProjects: ["packages/sdk"],
        limit: 8,
      }),
    ).toEqual(
      expect.arrayContaining([
        "packages/v8",
        "packages/v8/src/runtime",
        "packages/v8/src",
        "packages/sdk",
      ]),
    );
  });
});

describe("resolveConfigNearFocus", () => {
  it("orders near-focus pointers first", () => {
    const ordered = resolveConfigNearFocus({
      configPointers: [
        "package.json",
        "packages/v8/tsconfig.json",
        "apps/cli/package.json",
        "turbo.json",
      ],
      focusPaths: ["packages/v8/src/a.ts"],
      workRoot: "packages/v8",
    });
    expect(ordered[0]).toBe("packages/v8/tsconfig.json");
    expect(ordered.indexOf("packages/v8/tsconfig.json")).toBeLessThan(
      ordered.indexOf("apps/cli/package.json"),
    );
    expect(ordered).toContain("turbo.json");
  });
});
