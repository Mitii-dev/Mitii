import { describe, expect, it } from "vitest";

import { PathContainmentError } from "../internal/PathContainment";
import {
  assertHardDeniedMutationPath,
  isHardDeniedMutationPath,
} from "./AssertHardDeniedMutationPath";

describe("assertHardDeniedMutationPath", () => {
  it("allows normal source paths", () => {
    expect(() =>
      assertHardDeniedMutationPath("apps/desktop/src/renderer/App.tsx"),
    ).not.toThrow();
    expect(isHardDeniedMutationPath("packages/v8/src/index.ts")).toBe(false);
  });

  it("denies node_modules, .git, and build outs", () => {
    for (const path of [
      "apps/desktop/node_modules/vitest/dist/index.js",
      "node_modules/foo/bar.ts",
      ".git/config",
      "apps/desktop/dist/main.js",
      "packages/sdk/build/out.js",
      "apps/web/out/index.html",
      "coverage/lcov.info",
      "src/__pycache__/mod.pyc",
      ".venv/lib/site.py",
      "vendor/lib/x.go",
    ]) {
      expect(() => assertHardDeniedMutationPath(path)).toThrow(
        PathContainmentError,
      );
      try {
        assertHardDeniedMutationPath(path);
      } catch (error) {
        expect(error).toBeInstanceOf(PathContainmentError);
        expect((error as PathContainmentError).reasonCode).toBe(
          "path_hard_denied",
        );
      }
    }
  });

  it("canonicalizes @-mentions and case before deny", () => {
    expect(() =>
      assertHardDeniedMutationPath("@node_modules/vitest/index.js"),
    ).toThrow(PathContainmentError);
    expect(() =>
      assertHardDeniedMutationPath("apps/Desktop/Node_Modules/pkg/x.js"),
    ).toThrow(PathContainmentError);
    expect(isHardDeniedMutationPath("@dist/bundle.js")).toBe(true);
  });

  it("allows .github after github/ rewrite (not hard-denied)", () => {
    expect(() =>
      assertHardDeniedMutationPath("github/workflows/ci.yml"),
    ).not.toThrow();
    expect(isHardDeniedMutationPath(".github/workflows/ci.yml")).toBe(false);
  });
});
