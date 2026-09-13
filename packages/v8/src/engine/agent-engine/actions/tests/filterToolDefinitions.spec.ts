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
      requiresWorkspaceWrite: true,
    },
  ];

  it("hides mcp__* tools on read grants (ask/plan)", () => {
    const tools = filterToolDefinitions({
      grant: grant({ maximumWorkspaceEffect: "read" }),
      definitions: catalog,
      supportsTools: true,
      mode: "ask",
    });
    expect(tools.map((t) => t.name)).toEqual(["read_file"]);
    // Core discovery keeps full schema (not INDEX stub).
    expect(tools[0]?.inputSchema).toEqual({ type: "object" });
  });

  it("exposes read-safe mcp__* tools on agent read grants", () => {
    const tools = filterToolDefinitions({
      grant: grant({ maximumWorkspaceEffect: "read" }),
      definitions: [
        {
          name: "read_file",
          description: "read",
          inputSchema: { type: "object" },
        },
        {
          name: "mcp__excalidraw__create_view",
          description: "draw",
          inputSchema: { type: "object" },
        },
      ],
      supportsTools: true,
      mode: "agent",
    });
    expect(tools.map((t) => t.name)).toEqual([
      "read_file",
      "mcp__excalidraw__create_view",
    ]);
  });

  it("hides write-requiring mcp__* tools on agent read grants", () => {
    const tools = filterToolDefinitions({
      grant: grant({ maximumWorkspaceEffect: "read" }),
      definitions: catalog,
      supportsTools: true,
      mode: "agent",
    });
    expect(tools.map((t) => t.name)).toEqual(["read_file"]);
  });

  it("injects describe_tool and keeps full schemas for core tools", () => {
    const tools = filterToolDefinitions({
      grant: grant({
        allowedTools: ["read_file", "describe_tool", "get_current_time"],
      }),
      definitions: [
        ...catalog,
        {
          name: "describe_tool",
          description: "Load full schema",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
        {
          name: "get_current_time",
          description: "Current time in a timezone (long description that should be truncated when stubbed because this is a long-tail tool not in the full-schema allowlist for progressive disclosure).",
          inputSchema: {
            type: "object",
            properties: { timezone: { type: "string" } },
            required: ["timezone"],
          },
        },
      ],
      supportsTools: true,
    });
    expect(tools.map((t) => t.name)).toEqual([
      "read_file",
      "describe_tool",
      "get_current_time",
    ]);
    const describe = tools.find((t) => t.name === "describe_tool");
    const read = tools.find((t) => t.name === "read_file");
    const time = tools.find((t) => t.name === "get_current_time");
    expect(describe?.inputSchema).toMatchObject({
      required: ["name"],
    });
    expect(read?.inputSchema).toEqual({ type: "object" });
    expect(time?.inputSchema).toMatchObject({
      description: expect.stringContaining("Index stub"),
    });
  });

  it("exposes mcp__* tools when write is granted (INDEX stubbed)", () => {
    const tools = filterToolDefinitions({
      grant: grant({
        maximumWorkspaceEffect: "write",
        allowedTools: ["read_file", "apply_patch"],
        allowedEffects: ["workspace_read", "workspace_write"],
      }),
      definitions: catalog,
      supportsTools: true,
      mode: "agent",
    });
    expect(tools.map((t) => t.name)).toEqual([
      "read_file",
      "mcp__memory__store",
    ]);
    expect(tools[1]?.inputSchema).toMatchObject({
      description: expect.stringContaining("Index stub"),
    });
  });

  it("scopes mcp__* tools to requiredMcpServerIds", () => {
    const tools = filterToolDefinitions({
      grant: grant({
        maximumWorkspaceEffect: "write",
        allowedTools: ["read_file", "apply_patch"],
        allowedEffects: ["workspace_read", "workspace_write"],
      }),
      definitions: [
        ...catalog,
        {
          name: "mcp__excalidraw__create_view",
          description: "draw",
          inputSchema: { type: "object" },
        },
      ],
      supportsTools: true,
      mode: "agent",
      requiredMcpServerIds: ["excalidraw"],
    });
    expect(tools.map((t) => t.name)).toEqual([
      "read_file",
      "mcp__excalidraw__create_view",
    ]);
  });
});
