import { describe, expect, it } from "vitest";

import {
  InMemoryDiagnosticsAdapter,
  InMemoryFileSystemAdapter,
  InMemoryGitAdapter,
  InMemoryProcessAdapter,
  ToolRuntimeError,
  ToolRuntimePipeline,
  directory,
  file,
  toolInvocationInputSchema,
  toolResultSchema,
} from "../index";
import type { ProcessHandler } from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

function createRuntime(options?: { processHandler?: ProcessHandler }) {
  const fs = new InMemoryFileSystemAdapter(
    WORKSPACE,
    directory({
      src: directory({
        "util.ts": file("export const n = 1;\nsecret sk-abcdefghijklmnopqrstuvwxyz\n"),
        "other.ts": file("const x = 2;\n"),
      }),
      README: file("hello world\n"),
    }),
  );

  return new ToolRuntimePipeline({
    fileSystem: fs,
    process: new InMemoryProcessAdapter(
      options?.processHandler ??
        (async () => ({
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          timedOut: false,
          cancelled: false,
          truncated: false,
        })),
    ),
    diagnostics: new InMemoryDiagnosticsAdapter([
      {
        path: "src/util.ts",
        severity: "error",
        message: "boom",
        startLine: 1,
      },
    ]),
    git: new InMemoryGitAdapter({
      branch: "main",
      staged: [],
      unstaged: ["src/util.ts"],
      untracked: [],
      raw: "",
    }),
  });
}

describe("ToolRuntimePipeline", () => {
  it("validates input/output contracts for a successful read", async () => {
    const runtime = createRuntime();
    const input = {
      schemaVersion: 1 as const,
      callId: "c1",
      toolName: "read_file",
      arguments: { path: "src/util.ts" },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    };

    expect(() => toolInvocationInputSchema.parse(input)).not.toThrow();
    const result = await runtime.execute(input);
    expect(() => toolResultSchema.parse(result)).not.toThrow();
    expect(result.status).toBe("succeeded");
    expect(result.redacted).toBe(true);
    expect(String((result.output as { content: string }).content)).toContain(
      "[REDACTED]",
    );
  });

  it("lists capabilities including local and unavailable network tools", () => {
    const runtime = createRuntime();
    const caps = runtime.listCapabilities();
    expect(caps.some((c) => c.name === "read_file" && c.status === "available")).toBe(
      true,
    );
    expect(
      caps.some((c) => c.name === "fetch_url" && c.status === "unavailable"),
    ).toBe(true);
  });

  it("rejects tools not present in the grant", async () => {
    const runtime = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "c2",
      toolName: "read_file",
      arguments: { path: "src/util.ts" },
      grant: createReadOnlyGrant({ allowedTools: ["list_directory"] }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("tool_not_allowed");
  });

  it("rejects invalid arguments", async () => {
    const runtime = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "c3",
      toolName: "read_file",
      arguments: { path: "" },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("invalid_arguments");
  });

  it("throws ToolRuntimeError on invalid invocation envelope", async () => {
    const runtime = createRuntime();
    await expect(
      runtime.execute({
        schemaVersion: 1,
        callId: "",
        toolName: "read_file",
        arguments: {},
        grant: createReadOnlyGrant(),
        workspaceRoot: WORKSPACE,
      } as never),
    ).rejects.toBeInstanceOf(ToolRuntimeError);
  });

  it("completes read-only list/search/diagnostics/git without bypass", async () => {
    const runtime = createRuntime();
    const grant = createReadOnlyGrant();

    const listed = await runtime.execute({
      schemaVersion: 1,
      callId: "l1",
      toolName: "list_directory",
      arguments: { path: "src" },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(listed.status).toBe("succeeded");

    const searched = await runtime.execute({
      schemaVersion: 1,
      callId: "s1",
      toolName: "search_files",
      arguments: { query: "export", path: "src" },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(searched.status).toBe("succeeded");
    expect(
      (searched.output as { matches: unknown[] }).matches.length,
    ).toBeGreaterThan(0);

    const diags = await runtime.execute({
      schemaVersion: 1,
      callId: "d1",
      toolName: "read_diagnostics",
      arguments: { paths: ["src/util.ts"] },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(diags.status).toBe("succeeded");

    const git = await runtime.execute({
      schemaVersion: 1,
      callId: "g1",
      toolName: "read_git_status",
      arguments: {},
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(git.status).toBe("succeeded");
  });
});
