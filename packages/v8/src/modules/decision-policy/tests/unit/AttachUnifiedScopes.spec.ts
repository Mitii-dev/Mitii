import { describe, expect, it } from "vitest";

import {
  attachUnifiedScopes,
  compileGrantFromPlate,
  expandToolFamilies,
  TOOL_FAMILIES,
  toModelToolSurface,
} from "../../index";
import { FLOW_ORDER } from "../../flow/order";

describe("S2C scopes + families + surface", () => {
  it("attaches unified scopes from legacy path fields", () => {
    const { toolGrant } = compileGrantFromPlate({
      grantProfile: "agent_execute",
      pathScopes: ["."],
      mutationPathScopes: ["packages/demo"],
    });
    expect(toolGrant.scopes?.readPaths).toEqual(["."]);
    expect(toolGrant.scopes?.writePaths).toEqual(["packages/demo"]);
    expect(attachUnifiedScopes(toolGrant).scopes?.writePaths).toEqual([
      "packages/demo",
    ]);
  });

  it("expands tool families from TOOL_FAMILIES registry", () => {
    expect(TOOL_FAMILIES.discovery).toContain("read_file");
    const ids = expandToolFamilies(["meta", "discovery"]);
    expect(ids).toContain("describe_tool");
    expect(ids).toContain("read_file");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toModelToolSurface is grant.allowedTools only", () => {
    expect(
      toModelToolSurface({ allowedTools: ["read_file", "apply_patch"] }),
    ).toEqual(["read_file", "apply_patch"]);
  });

  it("FLOW_ORDER is the 4-stage S2C reshape", () => {
    expect(FLOW_ORDER).toEqual([
      "1-normalize-and-guard",
      "2-resolve-route-and-gate",
      "3-compile-grant-and-fences",
      "4-emit-decision-and-trace",
    ]);
  });
});
