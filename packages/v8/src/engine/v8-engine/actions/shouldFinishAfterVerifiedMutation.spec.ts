import { describe, expect, it } from "vitest";

import type { ToolResult } from "../../tool-runtime";
import { shouldFinishAfterVerifiedMutation } from "./shouldFinishAfterVerifiedMutation";

const verifyResult = (exitCode: number, status = "succeeded"): ToolResult =>
  ({
    status,
    output: { argv: ["pnpm", "test"], exitCode },
  }) as unknown as ToolResult;

const base = {
  mutationApplied: true,
  batchHadSuccessfulMutation: false,
  batchHadRejectedMutation: false,
  openTaskCount: 0,
  batch: [{ toolName: "run_readonly_command", result: verifyResult(0) }],
};

describe("shouldFinishAfterVerifiedMutation", () => {
  it("finishes when a passing verification ran after the mutation", () => {
    expect(shouldFinishAfterVerifiedMutation(base)).toBe(true);
  });

  it("does not finish without a prior mutation", () => {
    expect(
      shouldFinishAfterVerifiedMutation({ ...base, mutationApplied: false }),
    ).toBe(false);
  });

  it("does not finish when verification failed", () => {
    expect(
      shouldFinishAfterVerifiedMutation({
        ...base,
        batch: [{ toolName: "run_readonly_command", result: verifyResult(1) }],
      }),
    ).toBe(false);
  });

  it("does not finish when the batch also mutated (verification may be stale)", () => {
    expect(
      shouldFinishAfterVerifiedMutation({
        ...base,
        batchHadSuccessfulMutation: true,
      }),
    ).toBe(false);
  });

  it("does not finish while task-list work is still open", () => {
    expect(
      shouldFinishAfterVerifiedMutation({ ...base, openTaskCount: 2 }),
    ).toBe(false);
  });

  it("ignores non-verification read-only commands", () => {
    expect(
      shouldFinishAfterVerifiedMutation({
        ...base,
        batch: [
          {
            toolName: "run_readonly_command",
            result: {
              status: "succeeded",
              output: { argv: ["ls", "-la"], exitCode: 0 },
            } as unknown as ToolResult,
          },
          { toolName: "read_file", result: undefined },
        ],
      }),
    ).toBe(false);
  });
});
