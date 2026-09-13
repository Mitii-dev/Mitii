import { describe, expect, it } from "vitest";

import {
  filterToolsByMcpAttach,
  isMcpToolAttached,
  mcpServerIdFromToolName,
} from "../mcpToolAttachFilter.js";

describe("mcpToolAttachFilter", () => {
  it("parses server id from tool names", () => {
    expect(mcpServerIdFromToolName("mcp__excalidraw__create_view")).toBe(
      "excalidraw",
    );
    expect(mcpServerIdFromToolName("read_file")).toBeUndefined();
  });

  it("allows all MCP tools when attach list is empty", () => {
    expect(isMcpToolAttached("mcp__memory__store", [])).toBe(true);
    expect(isMcpToolAttached("mcp__memory__store", undefined)).toBe(true);
  });

  it("filters catalog to attached servers only", () => {
    const tools = [
      { name: "read_file" },
      { name: "mcp__excalidraw__create_view" },
      { name: "mcp__memory__store" },
    ];
    expect(filterToolsByMcpAttach(tools, ["excalidraw"]).map((t) => t.name)).toEqual([
      "read_file",
      "mcp__excalidraw__create_view",
    ]);
  });
});
