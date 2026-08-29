import { describe, expect, it } from "vitest";

import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../../tool-runtime";
import type { ToolResult } from "../../../tool-runtime";

import { ToolCallCache, rebaseToolResult } from "../ToolCallCache";

function result(callId: string, output: string): ToolResult {
  return {
    schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
    callId,
    toolName: "read_file",
    status: "succeeded",
    truncated: false,
    redacted: false,
    durationMs: 1,
    bytesProduced: output.length,
    warnings: [],
    output,
    audit: {
      callId,
      toolName: "read_file",
      startedAt: "2026-08-16T00:00:00.000Z",
      endedAt: "2026-08-16T00:00:00.001Z",
      status: "succeeded",
      inputPreview: "read_file",
      outputPreview: output,
      bytesProduced: output.length,
      durationMs: 1,
      truncated: false,
      redacted: false,
    },
  };
}

describe("ToolCallCache", () => {
  it("dedups identical read-only tool+args under a new callId", () => {
    const cache = new ToolCallCache();
    const first = result("call_1", "export const n = 1;");
    cache.set("call_1", first);
    cache.setContent("read_file", { path: "src/a.ts" }, first);

    const hit = cache.getByContent("read_file", { path: "src/a.ts" });
    expect(hit?.output).toBe("export const n = 1;");

    const rebased = rebaseToolResult(hit!, "call_2");
    expect(rebased.callId).toBe("call_2");
    expect(rebased.output).toBe("export const n = 1;");
  });

  it("invalidates content keys after a mutation without dropping callId entries", () => {
    const cache = new ToolCallCache();
    const first = result("call_1", "old");
    cache.set("call_1", first);
    cache.setContent("read_file", { path: "src/a.ts" }, first);

    cache.invalidateContent();

    expect(cache.get("call_1")?.output).toBe("old");
    expect(cache.getByContent("read_file", { path: "src/a.ts" })).toBeUndefined();
  });
});
