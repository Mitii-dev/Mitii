import { describe, expect, it, vi } from "vitest";

import type { ToolGrant } from "../../../modules/decision-policy";
import { executeGitSignoffRange } from "./ExecuteGitSignoffRange";

function writeGrant(overrides?: Partial<ToolGrant>): ToolGrant {
  return {
    maximumWorkspaceEffect: "write",
    allowedTools: ["git_signoff_range"],
    allowedEffects: ["workspace_read", "process_execute", "git_write"],
    pathScopes: ["."],
    approvalMode: "never",
    limits: {
      maxToolCalls: 32,
      maxWallTimeMs: 120_000,
      maxOutputBytes: 256_000,
    },
    ...overrides,
  };
}

describe("executeGitSignoffRange", () => {
  it("refuses protected branch", async () => {
    const process = {
      execFile: vi.fn(async ({ argv }: { argv: string[] }) => {
        if (argv.join(" ") === "git rev-parse --abbrev-ref HEAD") {
          return {
            exitCode: 0,
            stdout: "main\n",
            stderr: "",
            truncated: false,
            timedOut: false,
            cancelled: false,
          };
        }
        throw new Error(`unexpected argv: ${argv.join(" ")}`);
      }),
    };

    await expect(
      executeGitSignoffRange({
        arguments: { base: "9ee7a42" },
        grant: writeGrant(),
        workspaceRoot: "/tmp/repo",
        process: process as never,
        timeoutMs: 10_000,
        maxOutputBytes: 64_000,
      }),
    ).rejects.toMatchObject({
      reasonCode: "command_not_allowed",
    });
  });

  it("stashes, rebases with --signoff exec, and optionally pushes", async () => {
    const calls: string[][] = [];
    const process = {
      execFile: vi.fn(async ({ argv }: { argv: string[] }) => {
        calls.push(argv);
        const key = argv.join(" ");
        if (key === "git rev-parse --abbrev-ref HEAD") {
          return {
            exitCode: 0,
            stdout: "feat/v8-engine-rewrite\n",
            stderr: "",
            truncated: false,
            timedOut: false,
            cancelled: false,
          };
        }
        if (key === "git status --porcelain") {
          return {
            exitCode: 0,
            stdout: " M packages/v8/src/x.ts\n",
            stderr: "",
            truncated: false,
            timedOut: false,
            cancelled: false,
          };
        }
        if (argv[0] === "git" && argv[1] === "stash" && argv[2] === "push") {
          return {
            exitCode: 0,
            stdout: "Saved working directory\n",
            stderr: "",
            truncated: false,
            timedOut: false,
            cancelled: false,
          };
        }
        if (argv[0] === "git" && argv[1] === "rebase") {
          return {
            exitCode: 0,
            stdout: "Successfully rebased\n",
            stderr: "",
            truncated: false,
            timedOut: false,
            cancelled: false,
          };
        }
        if (argv[0] === "git" && argv[1] === "stash" && argv[2] === "pop") {
          return {
            exitCode: 0,
            stdout: "Dropped refs/stash\n",
            stderr: "",
            truncated: false,
            timedOut: false,
            cancelled: false,
          };
        }
        if (argv[0] === "git" && argv[1] === "push") {
          return {
            exitCode: 0,
            stdout: "ok\n",
            stderr: "",
            truncated: false,
            timedOut: false,
            cancelled: false,
          };
        }
        if (argv[0] === "git" && argv[1] === "log") {
          return {
            exitCode: 0,
            stdout: "Signed-off-by: Test <t@example.com>\nSigned-off-by: Test <t@example.com>\n",
            stderr: "",
            truncated: false,
            timedOut: false,
            cancelled: false,
          };
        }
        throw new Error(`unexpected argv: ${key}`);
      }),
    };

    const result = await executeGitSignoffRange({
      arguments: { base: "9ee7a42", push: true },
      grant: writeGrant(),
      workspaceRoot: "/tmp/repo",
      process: process as never,
      timeoutMs: 10_000,
      maxOutputBytes: 64_000,
    });

    const output = result.output as {
      stashed?: boolean;
      pushed?: boolean;
      branch?: string;
      signedOffCount?: number;
      argv: string[];
    };
    expect(output.stashed).toBe(true);
    expect(output.pushed).toBe(true);
    expect(output.branch).toBe("feat/v8-engine-rewrite");
    expect(output.signedOffCount).toBe(2);
    expect(output.argv).toEqual([
      "git",
      "rebase",
      "--exec",
      "git commit --amend --no-edit --signoff",
      "9ee7a42",
    ]);
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(true);
  });
});
