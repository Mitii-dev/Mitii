import { describe, expect, it } from "vitest";

import {
  MAX_REQUIRED_MCP_SERVERS,
  mcpAttachInstructionSchema,
  formatMcpAttachInstruction,
  mergeRequiredMcpServerIds,
  parseRequiredMcpMentions,
} from "../../index";

describe("MCP Attach contract", () => {
  it("keeps the max attach cap at 5", () => {
    expect(MAX_REQUIRED_MCP_SERVERS).toBe(5);
    const merged = mergeRequiredMcpServerIds(
      ["a", "b", "c"],
      ["d", "e", "f"],
    );
    expect(merged).toHaveLength(5);
  });

  it("returns a schema-valid instruction when attach ids are present", () => {
    const block = formatMcpAttachInstruction(["memory"]);
    expect(block).toBeDefined();
    expect(mcpAttachInstructionSchema.parse(block).id).toBe("mcp-attach");
  });

  it("strips mentions at the public parse boundary", () => {
    const parsed = parseRequiredMcpMentions("@mcp:memory do it");
    expect(parsed.requiredMcpServerIds).toEqual(["memory"]);
    expect(parsed.cleanedMessage).toBe("do it");
  });
});
