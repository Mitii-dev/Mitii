import { describe, expect, it } from "vitest";

import {
  compactProcessOutputPreview,
  extractProcessExitCode,
  previewToolOutput,
} from "../../helpers/turn/TurnLoopToolEventHelpers";

describe("previewToolOutput process evidence", () => {
  it("puts exitCode first so truncation cannot drop the verdict", () => {
    const preview = compactProcessOutputPreview({
      argv: ["node", "--test", "packages/checks/test/suite-lifecycle.test.js"],
      exitCode: 1,
      stdout: "x".repeat(500),
      stderr: "AssertionError: expected true to equal false",
    });
    expect(preview).toBeTruthy();
    expect(preview!.startsWith('{"exitCode":1')).toBe(true);
    expect(preview!.length).toBeLessThanOrEqual(240);
    const parsed = JSON.parse(preview!) as { exitCode: number; argv: string[] };
    expect(parsed.exitCode).toBe(1);
    expect(parsed.argv[0]).toBe("node");
  });

  it("extractProcessExitCode reads the authoritative field", () => {
    expect(
      extractProcessExitCode({
        argv: ["pnpm", "test"],
        exitCode: 1,
      }),
    ).toBe(1);
    expect(extractProcessExitCode({ ok: true })).toBeUndefined();
  });

  it("previewToolOutput prefers compact process envelope", () => {
    const preview = previewToolOutput(
      {
        argv: ["node", "--test", "a.test.js"],
        exitCode: 1,
        stderr: "boom",
      },
      undefined,
      true,
    );
    expect(preview).toContain('"exitCode":1');
    expect(preview).toContain("a.test.js");
  });
});
