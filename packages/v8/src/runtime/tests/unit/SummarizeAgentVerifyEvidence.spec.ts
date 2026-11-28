import { describe, expect, it } from "vitest";

import {
  extractAgentVerifyEvidence,
  summarizeAgentVerifyEvidence,
} from "../../helpers/task/SummarizeAgentVerifyEvidence";

describe("summarizeAgentVerifyEvidence", () => {
  it("prefers the latest successful selective test command", () => {
    const note = summarizeAgentVerifyEvidence([
      {
        toolName: "run_readonly_command",
        status: "succeeded",
        outputPreview: JSON.stringify({
          argv: ["node", "--test", "packages/checks/test/http-desugar.test.js"],
          exitCode: 1,
          stderr: "fail",
        }),
      },
      {
        toolName: "run_readonly_command",
        status: "succeeded",
        outputPreview: JSON.stringify({
          argv: ["node", "--test", "packages/checks/test/http-desugar.test.js"],
          exitCode: 0,
          stdout: "ok",
        }),
      },
    ]);
    expect(note).toMatch(/Passed via/);
    expect(note).toContain("http-desugar.test.js");
  });

  it("reports failed exit codes", () => {
    const note = summarizeAgentVerifyEvidence([
      {
        toolName: "run_readonly_command",
        status: "succeeded",
        summary: 'argv="node --test packages/checks/test/http-desugar.test.js"',
        outputPreview: JSON.stringify({
          argv: ["node", "--test", "packages/checks/test/http-desugar.test.js"],
          exitCode: 1,
          stderr: "Could not find test file",
        }),
      },
    ]);
    expect(note).toMatch(/Failed via/);
    expect(note).toMatch(/exit 1/);
  });

  it("uses first-class exitCode when preview JSON is truncated", () => {
    const evidence = extractAgentVerifyEvidence([
      {
        toolId: "run_readonly_command",
        status: "succeeded",
        exitCode: 1,
        summary:
          'argv="node --test packages/checks/test/suite-lifecycle.test.js"',
        // Truncated mid-object the way 240-char previews used to drop exitCode.
        outputPreview:
          '{"argv":["node","--test","packages/checks/test/suite-lifecycle.test.js"],"stdout":"lots of noise that would push exitCode off the end",',
      },
    ]);
    expect(evidence?.outcome).toBe("failed");
    expect(evidence?.exitCode).toBe(1);
    expect(evidence?.note).toMatch(/Failed via/);
    expect(evidence?.note).toMatch(/exit 1/);
    expect(evidence?.note).not.toMatch(/exit code unknown/);
  });

  it("recovers exitCode from truncated compact preview", () => {
    const evidence = extractAgentVerifyEvidence([
      {
        toolId: "run_readonly_command",
        status: "succeeded",
        outputPreview:
          '{"exitCode":1,"argv":["node","--test","a.test.js"],"hint":"AssertionError: expected',
      },
    ]);
    expect(evidence?.outcome).toBe("failed");
    expect(evidence?.exitCode).toBe(1);
    expect(evidence?.command).toContain("a.test.js");
  });

  it("prefers selective pass over a later broad package-suite fail", () => {
    const evidence = extractAgentVerifyEvidence([
      {
        toolName: "run_readonly_command",
        status: "succeeded",
        outputPreview: JSON.stringify({
          argv: ["node", "--test", "packages/checks/test/http-check.test.js"],
          exitCode: 0,
          hint: "✔ desugars nested http.start",
        }),
      },
      {
        toolName: "run_readonly_command",
        status: "succeeded",
        outputPreview: JSON.stringify({
          argv: ["pnpm", "--filter", "@mitii-bench/checks", "test"],
          exitCode: 1,
          hint: "EPERM mkdtemp",
        }),
      },
    ]);
    expect(evidence?.outcome).toBe("passed");
    expect(evidence?.scope).toBe("selective");
    expect(evidence?.command).toContain("http-check.test.js");
  });

  it("maps env-shaped selective fails to could_not_run", () => {
    const evidence = extractAgentVerifyEvidence([
      {
        toolName: "run_readonly_command",
        status: "succeeded",
        outputPreview: JSON.stringify({
          argv: ["node", "--test", "packages/checks/test/suite-lifecycle.test.js"],
          exitCode: 1,
          hint: "listen EPERM: operation not permitted 127.0.0.1",
        }),
      },
    ]);
    expect(evidence?.outcome).toBe("could_not_run");
    expect(evidence?.scope).toBe("selective");
  });

  it("does not promote pass-line telemetry as a failure hint", () => {
    const evidence = extractAgentVerifyEvidence([
      {
        toolName: "run_readonly_command",
        status: "succeeded",
        outputPreview: JSON.stringify({
          argv: ["node", "--test", "packages/checks/test/suite-lifecycle.test.js"],
          exitCode: 1,
          hint: "✔ compiles start stop pretest posttest (0.5ms)",
        }),
      },
    ]);
    expect(evidence?.outcome).toBe("failed");
    expect(evidence?.hint).toBeUndefined();
    expect(evidence?.note).not.toMatch(/✔/);
  });
});
