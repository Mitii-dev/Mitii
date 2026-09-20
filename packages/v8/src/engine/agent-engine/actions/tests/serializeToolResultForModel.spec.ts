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
  it("budgets read_file content on line boundaries and rewrites the cursor", () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`);
    const serialized = serializeToolResultForModel(
      toolResult({
        path: "src/large.ts",
        content: lines.join("\n"),
        startLine: 10,
        endLine: 49,
        eof: true,
        truncated: false,
      }),
      { maxContentChars: 40 },
    );

    const parsed = JSON.parse(serialized) as {
      output: {
        path: string;
        content: string;
        startLine: number;
        endLine: number;
        nextStartLine?: number;
        truncated: boolean;
        truncationReason?: string;
        eof?: boolean;
      };
      outputTruncatedForModel?: boolean;
    };

    expect(parsed.output.path).toBe("src/large.ts");
    expect(parsed.output.startLine).toBe(10);
    expect(parsed.output.endLine).toBeLessThan(49);
    expect(parsed.output.nextStartLine).toBe(parsed.output.endLine + 1);
    expect(parsed.output.content).not.toContain("…[truncated]");
    expect(parsed.output.content.split("\n").every((line) => line.startsWith("line-"))).toBe(
      true,
    );
    expect(parsed.output.truncated).toBe(true);
    expect(parsed.output.truncationReason).toBe("model_budget");
    expect(parsed.output.eof).toBe(false);
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
      output: {
        stdout: string;
        compilerErrorQueue?: boolean;
      };
    };
    expect(parsed.output.compilerErrorQueue).toBe(true);
    expect(parsed.output.stdout).toContain("Remaining compiler errors (2)");
    expect(parsed.output.stdout).toContain("TS2339");
    expect(parsed.output.stdout).toContain("a.tsx:13");
    expect(parsed.output.stdout).toContain("b.tsx:14");
    expect(parsed.output).not.toHaveProperty("repairHint");
  });

  it("keeps change-impact files-first under a tight model budget", () => {
    const affected = Array.from({ length: 40 }, (_, index) => ({
      path: `src/n${index}.ts`,
      hop: 1,
      viaEdgeType: "imports",
      score: 1,
      evidence: ["edge-a", "edge-b", "edge-c"],
    }));
    const affectedFiles = Array.from({ length: 25 }, (_, index) => ({
      path: `src/f${index}.ts`,
      hop: 1,
      score: 1,
      affectedNodeCount: 2,
      reason: "imports seed",
    }));

    const serialized = serializeToolResultForModel(
      {
        ...toolResult({
          path: "src/seed.ts",
          provider: "repo_graph",
          status: "partial",
          resolvedSeeds: [{ kind: "file", path: "src/seed.ts" }],
          affected,
          affectedFiles,
          packagesAffected: [],
          truncated: false,
          warnings: [],
          reasonCodes: ["impact_resolved"],
        }),
        toolName: "analyze_change_impact",
      },
      { maxContentChars: 1_200 },
    );

    const parsed = JSON.parse(serialized) as {
      output: {
        affected: unknown[];
        affectedFiles: unknown[];
        truncated?: boolean;
      };
      outputTruncatedForModel?: boolean;
    };

    expect(parsed.output.affectedFiles.length).toBeGreaterThan(0);
    expect(parsed.output.affected.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(parsed.output).length).toBeLessThanOrEqual(1_400);
  });
});
