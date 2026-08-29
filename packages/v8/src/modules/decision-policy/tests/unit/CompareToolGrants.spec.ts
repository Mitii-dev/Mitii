import { describe, expect, it } from "vitest";

import { toolGrantsEquivalent } from "../../actions/CompareToolGrants";
import type { ToolGrant } from "../../contracts";

function grant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return {
    maximumWorkspaceEffect: "write",
    allowedTools: ["read_file", "apply_patch"],
    allowedEffects: ["workspace_read", "workspace_write"],
    pathScopes: ["packages/mui-builder"],
    approvalMode: "when_required",
    limits: {
      maxToolCalls: 20,
      maxWallTimeMs: 60_000,
      maxOutputBytes: 256_000,
    },
    ...overrides,
  };
}

describe("toolGrantsEquivalent", () => {
  it("treats allow-list and path-scope order as insignificant", () => {
    expect(
      toolGrantsEquivalent(
        grant({
          allowedTools: ["apply_patch", "read_file"],
          pathScopes: ["packages/b", "packages/a"],
        }),
        grant({
          allowedTools: ["read_file", "apply_patch"],
          pathScopes: ["packages/a", "packages/b"],
        }),
      ),
    ).toBe(true);
  });

  it("detects a narrowed path scope", () => {
    expect(
      toolGrantsEquivalent(grant({ pathScopes: ["."] }), grant()),
    ).toBe(false);
  });

  it("detects distinct mutation path scopes", () => {
    expect(
      toolGrantsEquivalent(
        grant({ mutationPathScopes: ["packages/a"] }),
        grant({ mutationPathScopes: ["packages/b"] }),
      ),
    ).toBe(false);
    expect(
      toolGrantsEquivalent(
        grant({ mutationPathScopes: ["packages/b", "packages/a"] }),
        grant({ mutationPathScopes: ["packages/a", "packages/b"] }),
      ),
    ).toBe(true);
  });
});
