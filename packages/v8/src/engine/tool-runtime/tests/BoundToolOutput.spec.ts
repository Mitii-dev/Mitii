import { describe, expect, it } from "vitest";

import { InMemoryToolOutputSpillAdapter } from "../adapters/InMemoryToolOutputSpillAdapter";
import {
  boundToolOutput,
  headTailPreview,
  isMitiiBoundedToolOutput,
} from "../internal/output/boundToolOutput";

describe("boundToolOutput", () => {
  it("passes through output under the byte budget", async () => {
    const result = await boundToolOutput({
      output: { ok: true, lines: ["a", "b"] },
      maxBytes: 10_000,
      callId: "c1",
      toolName: "run_readonly_command",
    });
    expect(result.truncated).toBe(false);
    expect(result.spilled).toBe(false);
    expect(result.output).toEqual({ ok: true, lines: ["a", "b"] });
  });

  it("bounds huge output and spills when a spill port is present", async () => {
    const spill = new InMemoryToolOutputSpillAdapter();
    const huge = "x".repeat(80_000);
    const result = await boundToolOutput({
      output: { stdout: huge },
      maxBytes: 4_000,
      callId: "c_huge",
      toolName: "run_command",
      spill,
    });

    expect(result.truncated).toBe(true);
    expect(result.spilled).toBe(true);
    expect(result.spillId).toBeTruthy();
    expect(isMitiiBoundedToolOutput(result.output)).toBe(true);
    if (isMitiiBoundedToolOutput(result.output)) {
      expect(result.output.originalBytes).toBeGreaterThan(4_000);
      expect(result.output.previewBytes).toBeLessThanOrEqual(4_000);
      expect(result.output.spillId).toBe(result.spillId);
      expect(result.output.preview).toContain("truncated by tool-runtime");
    }
    const stored = await spill.read(result.spillId!);
    expect(stored).toContain(huge.slice(0, 100));
    expect(result.warnings.some((w) => w.includes("spilled"))).toBe(true);
  });

  it("truncates without spill when no port is configured", async () => {
    const result = await boundToolOutput({
      output: "y".repeat(20_000),
      maxBytes: 1_000,
      callId: "c2",
      toolName: "fetch_url",
    });
    expect(result.truncated).toBe(true);
    expect(result.spilled).toBe(false);
    expect(isMitiiBoundedToolOutput(result.output)).toBe(true);
    expect(result.warnings.some((w) => w.includes("without spill"))).toBe(
      true,
    );
  });

  it("headTailPreview keeps head and tail within the budget", () => {
    const text = `${"A".repeat(5_000)}${"B".repeat(5_000)}`;
    const preview = headTailPreview(text, 500);
    expect(Buffer.byteLength(preview, "utf8")).toBeLessThanOrEqual(500);
    expect(preview.startsWith("A")).toBe(true);
    expect(preview.endsWith("B")).toBe(true);
    expect(preview).toContain("truncated by tool-runtime");
  });
});
