import { describe, expect, it } from "vitest";

import { InMemoryManifestReader } from "../adapters/InMemoryManifestReader";
import { discoverApplicableChecks } from "../actions/DiscoverApplicableChecks";

const PACKAGE_JSON = JSON.stringify({
  name: "mui-builder",
  scripts: {
    typecheck: "tsc --noEmit",
    build: "tsc -p tsconfig.json",
  },
});

describe("discoverApplicableChecks — nearby-manifest project expansion", () => {
  it("discovers a project rooted at a folder-shaped changed path with no file component", async () => {
    const manifests = new InMemoryManifestReader({
      "packages/mui-builder/package.json": PACKAGE_JSON,
    });

    const result = await discoverApplicableChecks({
      projects: [],
      changeScope: "module",
      changedFiles: ["packages/mui-builder"],
      manifests,
    });

    const typecheckCandidate = result.candidates.find(
      (candidate) => candidate.kind === "typecheck",
    );
    expect(typecheckCandidate).toBeDefined();
    expect(typecheckCandidate?.projectId).toBe("inferred:packages/mui-builder");
  });

  it("still discovers a project from a real file path (regression guard)", async () => {
    const manifests = new InMemoryManifestReader({
      "packages/mui-builder/package.json": PACKAGE_JSON,
    });

    const result = await discoverApplicableChecks({
      projects: [],
      changeScope: "module",
      changedFiles: ["packages/mui-builder/src/Button.tsx"],
      manifests,
    });

    const typecheckCandidate = result.candidates.find(
      (candidate) => candidate.kind === "typecheck",
    );
    expect(typecheckCandidate).toBeDefined();
    expect(typecheckCandidate?.projectId).toBe("inferred:packages/mui-builder");
  });

  it("finds nothing project-specific when no manifest exists anywhere on the path", async () => {
    const manifests = new InMemoryManifestReader({});

    const result = await discoverApplicableChecks({
      projects: [],
      changeScope: "module",
      changedFiles: ["packages/unknown-package"],
      manifests,
    });

    expect(
      result.candidates.some((candidate) => candidate.kind === "typecheck"),
    ).toBe(false);
  });
});
