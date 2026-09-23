import { describe, expect, it } from "vitest";

import { formatMcpAttachInstruction } from "../formatMcpAttachInstruction.js";

describe("formatMcpAttachInstruction", () => {
  it("returns undefined for empty attach list", () => {
    expect(formatMcpAttachInstruction([])).toBeUndefined();
  });

  it("steers toward Excalidraw create_view when attached", () => {
    const block = formatMcpAttachInstruction(["excalidraw"]);
    expect(block?.id).toBe("mcp-attach");
    expect(block?.content).toContain("excalidraw");
    expect(block?.content).toContain("mcp__excalidraw__create_view");
  });
});
