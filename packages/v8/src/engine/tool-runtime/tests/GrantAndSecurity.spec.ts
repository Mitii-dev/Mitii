import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
  file,
  symlink,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

function createRuntimeWithSymlinkEscape() {
  const fs = new InMemoryFileSystemAdapter(
    WORKSPACE,
    directory({
      "safe.txt": file("safe\n"),
      "leak": symlink("/etc/passwd"),
    }),
  );
  fs.plantExternalFile("/etc/passwd", "root:x:0:0\n");
  return new ToolRuntimePipeline({
    fileSystem: fs,
    process: new InMemoryProcessAdapter(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: false,
      truncated: false,
    })),
  });
}

describe("Tool Runtime grant and security enforcement", () => {
  it("rejects path escape via ..", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(
        WORKSPACE,
        directory({ "a.txt": file("a") }),
      ),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "p1",
      toolName: "read_file",
      arguments: { path: "../outside.txt" },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("path_escape");
  });

  it("rejects path outside grant pathScopes", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(
        WORKSPACE,
        directory({
          src: directory({ "a.ts": file("a") }),
          secret: directory({ "b.ts": file("b") }),
        }),
      ),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "p2",
      toolName: "read_file",
      arguments: { path: "secret/b.ts" },
      grant: createReadOnlyGrant({ pathScopes: ["src"] }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("path_out_of_scope");
  });

  it("rejects symlink escape outside workspace", async () => {
    const runtime = createRuntimeWithSymlinkEscape();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "p3",
      toolName: "read_file",
      arguments: { path: "leak" },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("symlink_escape");
  });

  it("rejects command injection via shell metacharacters", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
      process: new InMemoryProcessAdapter(async () => {
        throw new Error("process must not run");
      }),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "c1",
      toolName: "run_readonly_command",
      arguments: { argv: ["git", "status", ";", "rm", "-rf", "/"] },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("command_injection");
  });

  it("rejects commands not covered by commandRules", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
      process: new InMemoryProcessAdapter(async () => {
        throw new Error("process must not run");
      }),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "c2",
      toolName: "run_readonly_command",
      arguments: { argv: ["rm", "-rf", "."] },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("command_not_allowed");
    expect(result.warnings.join(" ")).toContain("Allowed prefixes:");
    expect(result.warnings.join(" ")).toContain("git status");
  });

  it("runs authorized readonly argv commands without a shell", async () => {
    let seenShell: boolean | undefined;
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
      process: new InMemoryProcessAdapter(async (request) => {
        seenShell = false;
        expect(request.argv).toEqual(["git", "status", "--short"]);
        return {
          exitCode: 0,
          stdout: " M src/a.ts",
          stderr: "",
          timedOut: false,
          cancelled: false,
          truncated: false,
        };
      }),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "c3",
      toolName: "run_readonly_command",
      arguments: { argv: ["git", "status", "--short"] },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    expect(seenShell).toBe(false);
  });

  it("rejects unauthorized network access", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });

    const missingEffect = await runtime.execute({
      schemaVersion: 1,
      callId: "n1",
      toolName: "fetch_url",
      arguments: { url: "https://example.com" },
      grant: createReadOnlyGrant({
        allowedTools: ["fetch_url"],
        allowedEffects: ["network_access"],
        networkHosts: [],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(missingEffect.status).toBe("rejected");
    expect(missingEffect.reasonCode).toBe("network_not_allowed");

    const wrongHost = await runtime.execute({
      schemaVersion: 1,
      callId: "n2",
      toolName: "fetch_url",
      arguments: { url: "https://evil.example" },
      grant: createReadOnlyGrant({
        allowedTools: ["fetch_url"],
        allowedEffects: ["network_access"],
        networkHosts: ["api.example.com"],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(wrongHost.status).toBe("rejected");
    expect(wrongHost.reasonCode).toBe("network_not_allowed");
  });

  it("times out long-running commands", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: true,
        cancelled: false,
        truncated: false,
      })),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "t1",
      toolName: "run_readonly_command",
      arguments: { argv: ["git", "status"] },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("timed_out");
    expect(result.reasonCode).toBe("timeout");
  });

  it("truncates oversized output and reports it", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(
        WORKSPACE,
        directory({
          "big.txt": file("x".repeat(10_000)),
        }),
      ),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "o1",
      toolName: "read_file",
      arguments: { path: "big.txt" },
      grant: createReadOnlyGrant({
        limits: {
          maxToolCalls: 24,
          maxWallTimeMs: 90_000,
          maxOutputBytes: 100,
          maxConcurrentTools: 1,
        },
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    expect(result.truncated).toBe(true);
    expect(result.reasonCode).toBe("output_truncated");
  });

  it("rejects when maxToolCalls is exhausted", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(
        WORKSPACE,
        directory({ "a.txt": file("a") }),
      ),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });
    const grant = createReadOnlyGrant({
      limits: {
        maxToolCalls: 1,
        maxWallTimeMs: 90_000,
        maxOutputBytes: 256_000,
        maxConcurrentTools: 1,
      },
    });
    const budget = runtime.createBudget(grant);

    const first = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "b1",
        toolName: "read_file",
        arguments: { path: "a.txt" },
        grant,
        workspaceRoot: WORKSPACE,
      },
      { budget },
    );
    expect(first.status).toBe("succeeded");

    const second = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "b2",
        toolName: "read_file",
        arguments: { path: "a.txt" },
        grant,
        workspaceRoot: WORKSPACE,
      },
      { budget },
    );
    expect(second.status).toBe("rejected");
    expect(second.reasonCode).toBe("limit_exceeded");
  });
});
