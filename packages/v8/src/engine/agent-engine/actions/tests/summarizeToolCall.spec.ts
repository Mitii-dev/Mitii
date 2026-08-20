import { describe, expect, it } from "vitest";

import { summarizeToolCall } from "../summarizeToolCall";

describe("summarizeToolCall", () => {
  it("summarizes apply_patch paths", () => {
    expect(
      summarizeToolCall("apply_patch", {
        patches: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
      }),
    ).toBe("patches=2 paths=src/a.ts,src/b.ts");
  });

  it("summarizes read_file line ranges", () => {
    expect(
      summarizeToolCall("read_file", { path: "src/a.ts", startLine: 4, endLine: 12 }),
    ).toBe("path=src/a.ts lines=4-12");
  });
});
