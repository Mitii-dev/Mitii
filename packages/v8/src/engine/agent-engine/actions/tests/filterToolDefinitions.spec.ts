import { describe, expect, it } from "vitest";

import type { ToolGrant } from "../../../../modules/decision-policy";
import { filterToolDefinitions } from "../filterToolDefinitions";

function grant(partial: Partial<ToolGrant>): ToolGrant {
  return {
    maximumWorkspaceEffect: "read",
    allowedTools: ["read_file"],
    allowedEffects: ["workspace_read"],
    pathScopes: ["."],
    approvalMode: "never",
    limits: {
      maxToolCalls: 20,
      maxConcurrentToolCalls: 1,
      maxWallTimeMs: 60_000,
      maxOutputBytesPerCall: 64_000,
    },
    ...partial,
  };
}

describe("filterToolDefinitions MCP gating", () => {
  const catalog = [
    {
      name: "read_file",
      description: "read",
      inputSchema: { type: "object" },
    },
    {
      name: "mcp__memory__store",
      description: "mcp",
      inputSchema: { type: "object" },
    },
  ];

  it("hides mcp__* tools on read grants (ask/plan)", () => {
    const tools = filterToolDefinitions({
      grant: grant({ maximumWorkspaceEffect: "read" }),
      definitions: catalog,
      supportsTools: true,
    });
    expect(tools.map((t) => t.name)).toEqual(["read_file"]);
  });

  it("exposes mcp__* tools only when write is granted", () => {
    const tools = filterToolDefinitions({
      grant: grant({
        maximumWorkspaceEffect: "write",
        allowedTools: ["read_file", "apply_patch"],
        allowedEffects: ["workspace_read", "workspace_write"],
      }),
      definitions: catalog,
      supportsTools: true,
    });
    expect(tools.map((t) => t.name)).toEqual([
      "read_file",
      "mcp__memory__store",
    ]);
  });
});
