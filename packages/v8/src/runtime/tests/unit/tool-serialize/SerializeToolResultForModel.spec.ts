import { describe, expect, it } from "vitest";

import { serializeToolResultForModel } from "../../../helpers/tool-serialize";
import type { ToolResult } from "../../../../engine/tool-runtime";

function baseResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    status: "succeeded",
    toolName: "read_file",
    callId: "c1",
    warnings: [],
    truncated: false,
    redacted: false,
    audit: { outputPreview: undefined },
    ...overrides,
  } as ToolResult;
}

describe("serializeToolResultForModel", () => {
  it("clips long file content on a budget", () => {
    const content = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const json = serializeToolResultForModel(
      baseResult({
        output: { path: "src/a.ts", content, startLine: 1 },
      }),
      400,
    );
    const parsed = JSON.parse(json) as {
      output: { content: string; truncated?: boolean };
      outputTruncatedForModel?: boolean;
    };
    expect(parsed.output.content.length).toBeLessThan(content.length);
    expect(
      parsed.outputTruncatedForModel === true || parsed.output.truncated === true,
    ).toBe(true);
  });

  it("includes status and toolName", () => {
    const json = serializeToolResultForModel(
      baseResult({ output: { ok: true } }),
    );
    const parsed = JSON.parse(json) as { status: string; toolName: string };
    expect(parsed.status).toBe("succeeded");
    expect(parsed.toolName).toBe("read_file");
  });
});
