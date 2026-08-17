import { describe, expect, it } from "vitest";

import { TOOL_RUNTIME_SCHEMA_VERSION, type ToolResult } from "../../../tool-runtime";
import { serializeToolResultForModel } from "../serializeToolResultForModel";

function toolResult(output: unknown): ToolResult {
  return {
    schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
    callId: "call_read",
    toolName: "read_file",
    status: "succeeded",
    truncated: false,
    redacted: false,
    durationMs: 1,
    bytesProduced: 1_000,
    warnings: [],
    output,
    audit: {
      callId: "call_read",
      toolName: "read_file",
      startedAt: "2026-08-16T00:00:00.000Z",
      endedAt: "2026-08-16T00:00:00.001Z",
      status: "succeeded",
      inputPreview: "{}",
      outputPreview: "",
      bytesProduced: 1_000,
      durationMs: 1,
      truncated: false,
      redacted: false,
    },
  };
}

describe("serializeToolResultForModel", () => {
  it("budgets output content instead of slicing the serialized envelope", () => {
    const serialized = serializeToolResultForModel(
      toolResult({
        path: "src/large.ts",
        content: "a".repeat(2_000),
        startLine: 10,
        endLine: 80,
        truncated: false,
      }),
      { maxContentChars: 120 },
    );

    const parsed = JSON.parse(serialized) as {
      output: { path: string; content: string; startLine: number; endLine: number; truncated: boolean };
      outputTruncatedForModel?: boolean;
    };

    expect(parsed.output.path).toBe("src/large.ts");
    expect(parsed.output.startLine).toBe(10);
    expect(parsed.output.endLine).toBe(80);
    expect(parsed.output.content.length).toBeLessThan(150);
    expect(parsed.output.content).toContain("[truncated]");
    expect(parsed.output.truncated).toBe(true);
    expect(parsed.outputTruncatedForModel).toBe(true);
  });

  it("replaces compiler stdout with a compact error queue", () => {
    const serialized = serializeToolResultForModel(
      {
        ...toolResult({
          argv: ["npx", "tsc", "--noEmit"],
          exitCode: 2,
          stdout: [
            "packages/mui-builder/src/a.tsx(13,17): error TS2339: Property 'type' does not exist on type 'string'.",
            "packages/mui-builder/src/b.tsx(14,10): error TS2693: 'InputTypes' only refers to a type, but is being used as a value here.",
          ].join("\n"),
        }),
        toolName: "run_readonly_command",
      },
      { maxContentChars: 400 },
    );

    const parsed = JSON.parse(serialized) as {
      output: { stdout: string; compilerErrorQueue?: boolean };
    };
    expect(parsed.output.compilerErrorQueue).toBe(true);
    expect(parsed.output.stdout).toContain("Remaining compiler errors (2)");
    expect(parsed.output.stdout).toContain("a.tsx:13 TS2339");
    expect(parsed.output.stdout).toContain("b.tsx:14 TS2693");
  });
});
