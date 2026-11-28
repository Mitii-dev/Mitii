import { describe, expect, it } from "vitest";

import { compileGrantFromPlate } from "../../helpers/CompileGrantFromPlate";

describe("compileGrantFromPlate", () => {
  it("builds none grant for clarify profile", () => {
    const result = compileGrantFromPlate({
      grantProfile: "none",
      pathScopes: ["."],
    });
    expect(result.toolGrant.maximumWorkspaceEffect).toBe("none");
    expect(result.toolGrant.allowedTools).toEqual([]);
    expect(result.reasonCodes).toContain("grant_from_plate");
  });

  it("applies mutation fence on agent_execute", () => {
    const result = compileGrantFromPlate({
      grantProfile: "agent_execute",
      pathScopes: ["."],
      mutationPathScopes: ["packages/demo"],
    });
    expect(result.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(result.toolGrant.mutationPathScopes).toEqual(["packages/demo"]);
    expect(result.toolGrant.allowedTools.length).toBeGreaterThan(0);
    expect(result.reasonCodes).toContain("grant_mutation_fence_applied");
  });

  it("research stays read-only", () => {
    const result = compileGrantFromPlate({
      grantProfile: "research",
      pathScopes: ["."],
    });
    expect(result.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(result.toolGrant.mutationPathScopes).toBeUndefined();
  });
});
