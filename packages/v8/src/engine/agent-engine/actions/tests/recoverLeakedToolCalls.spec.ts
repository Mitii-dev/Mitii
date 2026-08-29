import { describe, expect, it } from "vitest";

import { recoverLeakedToolCallsFromMarkup } from "../recoverLeakedToolCalls";

describe("recoverLeakedToolCallsFromMarkup", () => {
  it("recovers a single read_file tag into a tool call", () => {
    const content = `<read_file path="src/util.ts" startLine="1" endLine="3">`;
    const { toolCalls, warnings } = recoverLeakedToolCallsFromMarkup({
      content,
      allowedToolNames: new Set(["read_file"]),
    });

    expect(warnings).toEqual([]);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.name).toBe("read_file");
    expect(toolCalls[0]?.arguments).toBe(
      JSON.stringify({ path: "src/util.ts", startLine: 1, endLine: 3 }),
    );
  });

  it("recovers multiple tags in one content string", () => {
    const content = `
      <search_files query="export const n" path="src" maxMatches="10" />
      <read_file path="src/util.ts" />
    `;

    const { toolCalls } = recoverLeakedToolCallsFromMarkup({
      content,
      allowedToolNames: new Set(["search_files", "read_file"]),
    });

    expect(toolCalls.map((c) => c.name)).toEqual(["search_files", "read_file"]);
  });

  it("does not recover unsupported tool tags", () => {
    const content = `<run_command command="echo hi" />`;
    const { toolCalls } = recoverLeakedToolCallsFromMarkup({
      content,
      allowedToolNames: new Set(["run_command"]),
    });
    expect(toolCalls).toHaveLength(0);
  });

  it("ignores tags not present in the current grant", () => {
    const content = `<read_file path="src/util.ts" />`;
    const { toolCalls } = recoverLeakedToolCallsFromMarkup({
      content,
      allowedToolNames: new Set([]),
    });
    expect(toolCalls).toHaveLength(0);
  });
});

