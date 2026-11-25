import { describe, expect, it } from "vitest";

import {
  MCP_ATTACH_INSTRUCTION,
  formatMcpAttachInstruction,
} from "../../index";

describe("formatMcpAttachInstruction", () => {
  it("returns undefined for empty attach list", () => {
    expect(formatMcpAttachInstruction([])).toBeUndefined();
  });

  it("builds a generic project-rule block for attached servers", () => {
    const block = formatMcpAttachInstruction(["memory", "filesystem"]);
    expect(block?.id).toBe(MCP_ATTACH_INSTRUCTION.id);
    expect(block?.title).toBe(MCP_ATTACH_INSTRUCTION.title);
    expect(block?.content).toContain("memory");
    expect(block?.content).toContain("filesystem");
    expect(block?.content).toContain("mcp__{serverId}__*");
    expect(block?.content).not.toContain("excalidraw");
    expect(block?.content).not.toContain("create_view");
  });
});
