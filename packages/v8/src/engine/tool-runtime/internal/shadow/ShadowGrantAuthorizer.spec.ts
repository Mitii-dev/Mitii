import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  StructuralShadowGrantAuthorizer,
  compileToolGrantToCedar,
} from "./ShadowGrantAuthorizer";
import type { ToolGrant } from "../../../../modules/decision-policy";
import type { ToolDefinition } from "../../ToolCatalog";

function grant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return {
    maximumWorkspaceEffect: "write",
    allowedTools: ["apply_patch", "read_file"],
    allowedEffects: ["workspace_read", "workspace_write"],
    pathScopes: ["src"],
    approvalMode: "when_required",
    limits: {
      maxToolCalls: 20,
      maxWallTimeMs: 60_000,
      maxOutputBytes: 1_000_000,
    },
    ...overrides,
  };
}

function tool(name: string, effects: ToolDefinition["effects"]): ToolDefinition {
  return {
    name,
    description: name,
    effects,
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.unknown(),
    maxOutputBytes: 10_000,
    timeoutMs: 5_000,
    backend: "local",
    status: "available",
    executeSupported: true,
  };
}

describe("StructuralShadowGrantAuthorizer", () => {
  const authorizer = new StructuralShadowGrantAuthorizer();

  it("allows in-scope apply_patch and denies out-of-scope paths", () => {
    const allowed = authorizer.authorize({
      tool: tool("apply_patch", ["workspace_write"]),
      grant: grant(),
      arguments: {
        patches: [{ path: "src/parse.ts", oldText: "a", newText: "b" }],
      },
    });
    expect(allowed.decision).toBe("Allow");

    const denied = authorizer.authorize({
      tool: tool("apply_patch", ["workspace_write"]),
      grant: grant(),
      arguments: {
        patches: [{ path: "apps/other.ts", oldText: "a", newText: "b" }],
      },
    });
    expect(denied.decision).toBe("Deny");
    expect(denied.reason).toContain("path_out_of_scope");
  });

  it("compiles a Cedar-shaped audit policy from the grant", () => {
    const cedar = compileToolGrantToCedar(grant());
    expect(cedar).toContain("forbid (principal, action, resource);");
    expect(cedar).toContain("apply_patch");
    expect(cedar).toContain("src");
  });
});
