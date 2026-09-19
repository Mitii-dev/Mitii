import { describe, expect, it } from "vitest";

import type { ToolGrant } from "../../../modules/decision-policy";
import { PathContainmentError } from "../internal/PathContainment";
import { assertMutationPathMatchesGrant } from "./AssertMutationPathMatchesGrant";

function grant(regex?: string): ToolGrant {
  return {
    maximumWorkspaceEffect: "write",
    allowedTools: ["apply_patch"],
    allowedEffects: ["workspace_write"],
    pathScopes: ["."],
    approvalMode: "never",
    limits: {
      maxToolCalls: 4,
      maxWallTimeMs: 10_000,
      maxOutputBytes: 8_000,
    },
    ...(regex ? { mutationRelativePathRegex: regex } : {}),
  };
}

describe("assertMutationPathMatchesGrant", () => {
  it("no-ops when regex is unset", () => {
    expect(() =>
      assertMutationPathMatchesGrant({
        relativePath: "src/a.ts",
        grant: grant(),
      }),
    ).not.toThrow();
  });

  it("allows matching markdown paths for architect-style regex", () => {
    expect(() =>
      assertMutationPathMatchesGrant({
        relativePath: "plans/plan.md",
        grant: grant("\\.md$"),
      }),
    ).not.toThrow();
  });

  it("rejects non-matching paths", () => {
    expect(() =>
      assertMutationPathMatchesGrant({
        relativePath: "src/a.ts",
        grant: grant("\\.md$"),
      }),
    ).toThrow(PathContainmentError);
  });
});
