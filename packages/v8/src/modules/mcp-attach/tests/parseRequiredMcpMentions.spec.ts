import { describe, expect, it } from "vitest";

import {
  mergeRequiredMcpServerIds,
  parseRequiredMcpMentions,
} from "../parseRequiredMcpMentions.js";

describe("parseRequiredMcpMentions", () => {
  it("extracts @mcp mentions and cleans the message", () => {
    const result = parseRequiredMcpMentions(
      "@mcp:excalidraw\nDraw the billing flow",
    );
    expect(result.requiredMcpServerIds).toEqual(["excalidraw"]);
    expect(result.cleanedMessage).toBe("Draw the billing flow");
  });

  it("merges pins with mentions and caps at five", () => {
    const merged = mergeRequiredMcpServerIds(
      ["memory", "excalidraw"],
      ["excalidraw", "filesystem", "a", "b", "c", "d"],
    );
    expect(merged).toEqual([
      "memory",
      "excalidraw",
      "filesystem",
      "a",
      "b",
    ]);
  });

  it("normalizes ids", () => {
    const result = parseRequiredMcpMentions("@mcp:Excalidraw_App");
    expect(result.requiredMcpServerIds).toEqual(["excalidraw_app"]);
  });
});
