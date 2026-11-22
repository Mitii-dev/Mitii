import { describe, expect, it, vi } from "vitest";

import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../../../engine/tool-runtime";
import type { DiscoveredCheckCandidate } from "../../internal/discovery";
import { createVerificationGrant } from "../../tests/fixtures/grants";
import { executeChecks } from "../ExecuteChecks";

const candidate: DiscoveredCheckCandidate = {
  checkId: "py:syntax:py_compile",
  kind: "syntax",
  projectId: "py",
  label: "python3 -m py_compile",
  evidenceSource: "changed-files:py_compile",
  languageId: "python",
  toolName: "run_readonly_command",
  toolArguments: { argv: ["python3", "-m", "py_compile", "app.py"] },
  argv: ["python3", "-m", "py_compile", "app.py"],
  mayBeUnavailable: true,
};

describe("executeChecks PATH preflight", () => {
  it("marks mayBeUnavailable checks unavailable when --version probe misses", async () => {
    const execute = vi.fn(async (input: { callId: string; arguments: { argv?: string[] } }) => {
      if (input.callId.startsWith("verify-probe-")) {
        return {
          schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
          callId: input.callId,
          toolName: "run_readonly_command",
          status: "failed" as const,
          output: {
            exitCode: 127,
            stdout: "",
            stderr: "python3: command not found",
          },
          durationMs: 1,
          warnings: [],
        };
      }
      throw new Error(`unexpected execute: ${input.callId}`);
    });

    const result = await executeChecks({
      candidates: [candidate],
      grant: createVerificationGrant(),
      workspaceRoot: "/repo",
      pinnedState: {
        workspaceId: "ws",
        stateToken: "tok",
      },
      tools: { execute },
    });

    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.outcome).toBe("unavailable");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]?.arguments?.argv).toEqual([
      "python3",
      "--version",
    ]);
  });

  it("runs the real check when the PATH probe finds the binary", async () => {
    const execute = vi.fn(async (input: { callId: string }) => {
      if (input.callId.startsWith("verify-probe-")) {
        return {
          schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
          callId: input.callId,
          toolName: "run_readonly_command",
          status: "succeeded" as const,
          output: { exitCode: 0, stdout: "Python 3.12.0", stderr: "" },
          durationMs: 1,
          warnings: [],
        };
      }
      return {
        schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
        callId: input.callId,
        toolName: "run_readonly_command",
        status: "succeeded" as const,
        output: { exitCode: 0, stdout: "", stderr: "" },
        durationMs: 2,
        warnings: [],
      };
    });

    const result = await executeChecks({
      candidates: [candidate],
      grant: createVerificationGrant(),
      workspaceRoot: "/repo",
      pinnedState: {
        workspaceId: "ws",
        stateToken: "tok",
      },
      tools: { execute },
    });

    expect(result.checks[0]?.outcome).toBe("passed");
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
