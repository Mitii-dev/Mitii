import { describe, expect, it } from "vitest";

import { recoverLeakedToolCallsFromMarkup } from "../../../helpers/tool-recovery";

describe("recoverLeakedToolCallsFromMarkup", () => {
  it("recovers read_file calls from leaked markup when allowed", () => {
    const { toolCalls, warnings } = recoverLeakedToolCallsFromMarkup({
      content: `<read_file path="src/util.ts" startLine="1" endLine="20">`,
      allowedToolNames: new Set(["read_file"]),
    });
    expect(warnings).toEqual([]);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.name).toBe("read_file");
    expect(JSON.parse(toolCalls[0]?.arguments ?? "{}")).toEqual({
      path: "src/util.ts",
      startLine: 1,
      endLine: 20,
    });
  });

  it("ignores tags outside the grant", () => {
    const { toolCalls } = recoverLeakedToolCallsFromMarkup({
      content: `<search_files query="foo" path="src" />`,
      allowedToolNames: new Set(["read_file"]),
    });
    expect(toolCalls).toEqual([]);
  });

  it("warns when leaked markup is detected but not in the grant", () => {
    const { toolCalls, warnings } = recoverLeakedToolCallsFromMarkup({
      content: `<read_file path="src/a.ts">`,
      allowedToolNames: new Set(),
    });
    expect(toolCalls).toEqual([]);
    expect(warnings.some((w) => w.includes("Leaked tool-call markup"))).toBe(
      true,
    );
  });

  it("parses boolean and unquoted attributes", () => {
    const { toolCalls } = recoverLeakedToolCallsFromMarkup({
      content: `<search_files query=foo path=src maxMatches=10 caseSensitive=false />`,
      allowedToolNames: new Set(["search_files"]),
    });
    expect(toolCalls).toHaveLength(1);
    expect(JSON.parse(toolCalls[0]?.arguments ?? "{}")).toEqual({
      query: "foo",
      path: "src",
      maxMatches: 10,
      caseSensitive: false,
    });
  });

  it("recovers JSON tool leaks from gpt-oss style text", () => {
    const { toolCalls, warnings } = recoverLeakedToolCallsFromMarkup({
      content: '{"tool":"list_directory","arguments":{"path":"."}}',
      allowedToolNames: new Set(["list_directory", "read_file"]),
    });
    expect(warnings).toEqual([]);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.name).toBe("list_directory");
    expect(JSON.parse(toolCalls[0]?.arguments ?? "{}")).toEqual({ path: "." });
  });

  it("recovers nested JSON tool leaks embedded in prose", () => {
    const { toolCalls } = recoverLeakedToolCallsFromMarkup({
      content: `Tool calling failed. Try format:

{
  "name": "glob_files",
  "arguments": {"pattern":"**/*"}
}

But we need to include path?`,
      allowedToolNames: new Set(["glob_files", "list_directory"]),
    });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.name).toBe("glob_files");
    expect(JSON.parse(toolCalls[0]?.arguments ?? "{}")).toEqual({
      pattern: "**/*",
    });
  });

  it("ignores JSON tool leaks outside the grant", () => {
    const { toolCalls } = recoverLeakedToolCallsFromMarkup({
      content: '{"tool":"list_directory","arguments":{"path":"."}}',
      allowedToolNames: new Set(["read_file"]),
    });
    expect(toolCalls).toEqual([]);
  });
});
