import { describe, expect, it } from "vitest";

import { summarizeToolCall } from "../../../helpers/tool-recovery";

describe("summarizeToolCall", () => {
  it("summarizes read_file with path and line range", () => {
    expect(
      summarizeToolCall("read_file", {
        path: "src/a.ts",
        startLine: 10,
        endLine: 20,
      }),
    ).toMatch(/src\/a\.ts/);
  });

  it("summarizes search_files with query", () => {
    expect(
      summarizeToolCall("search_files", { query: "buildClarification" }),
    ).toMatch(/buildClarification/);
  });

  it("returns empty summary for empty read_file args", () => {
    expect(summarizeToolCall("read_file", {})).toBe("");
  });
});
