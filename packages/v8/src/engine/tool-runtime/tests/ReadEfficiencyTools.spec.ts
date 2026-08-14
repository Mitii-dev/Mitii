import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  InMemoryDiagnosticsAdapter,
  InMemoryFileSystemAdapter,
  InMemoryGitAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
  file,
  listBuiltinModelToolDefinitions,
  listBuiltinMutationModelToolDefinitions,
  listBuiltinReadOnlyModelToolDefinitions,
  READ_ONLY_TOOL_IDS,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

function createRuntime() {
  const fs = new InMemoryFileSystemAdapter(
    WORKSPACE,
    directory({
      src: directory({
        "util.ts": file("export const n = 1;\n"),
        "util.spec.ts": file("describe('util', () => {});\n"),
        nested: directory({
          "deep.ts": file("export const deep = true;\n"),
        }),
      }),
      "package.json": file('{"name":"demo"}\n'),
    }),
  );

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
    diagnostics: new InMemoryDiagnosticsAdapter([]),
    git: new InMemoryGitAdapter({
      branch: "main",
      staged: [],
      unstaged: [],
      untracked: [],
      raw: "",
    }),
  });
}

describe("read efficiency tools", () => {
  it("glob_files finds paths by pattern with caps", async () => {
    const runtime = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "g1",
      toolName: "glob_files",
      arguments: { pattern: "**/*.spec.ts", path: "." },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    const output = result.output as {
      matches: Array<{ path: string }>;
      truncated: boolean;
    };
    expect(output.matches.map((m) => m.path)).toEqual(["src/util.spec.ts"]);
    expect(output.truncated).toBe(false);
  });

  it("rejects unsafe glob patterns", async () => {
    const runtime = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "g2",
      toolName: "glob_files",
      arguments: { pattern: "../secret/**" },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("invalid_arguments");
  });

  it("read_many_files returns per-file results and containment errors", async () => {
    const runtime = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "r1",
      toolName: "read_many_files",
      arguments: {
        paths: ["src/util.ts", "missing.ts", "../escape.ts"],
      },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    const output = result.output as {
      files: Array<{ path: string; content?: string; error?: string }>;
    };
    expect(output.files).toHaveLength(3);
    expect(output.files[0]?.content).toContain("export const n");
    expect(output.files[1]?.error).toBeTruthy();
    expect(output.files[2]?.error).toBeTruthy();
  });

  it("file_metadata returns size and sha256", async () => {
    const runtime = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m1",
      toolName: "file_metadata",
      arguments: { path: "src/util.ts" },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    const output = result.output as {
      sizeBytes: number;
      kind: string;
      hash?: { algorithm: string; hex: string; truncated: boolean };
    };
    expect(output.kind).toBe("file");
    expect(output.sizeBytes).toBeGreaterThan(0);
    expect(output.hash?.algorithm).toBe("sha256");
    expect(output.hash?.hex).toBe(
      createHash("sha256").update("export const n = 1;\n", "utf8").digest("hex"),
    );
  });

  it("grants include the new read tools", () => {
    expect(READ_ONLY_TOOL_IDS).toContain("glob_files");
    expect(READ_ONLY_TOOL_IDS).toContain("read_many_files");
    expect(READ_ONLY_TOOL_IDS).toContain("file_metadata");
    expect(READ_ONLY_TOOL_IDS).toContain("analyze_change_impact");
  });
});

describe("model tool definition single source", () => {
  it("exposes available tools with model schemas and omits stubs", () => {
    const all = listBuiltinModelToolDefinitions().map((t) => t.name);
    expect(all).toContain("glob_files");
    expect(all).toContain("read_many_files");
    expect(all).toContain("file_metadata");
    expect(all).toContain("apply_patch");
    expect(all).toContain("delete_file");
    expect(all).toContain("delete_directory");
    expect(all).toContain("move_file");
    expect(all).toContain("fetch_url");
    expect(all).toContain("web_search");
    expect(all).toContain("run_command");

    const readOnly = listBuiltinReadOnlyModelToolDefinitions().map((t) => t.name);
    expect(readOnly).toContain("glob_files");
    expect(readOnly).toContain("goto_definition");
    expect(readOnly).toContain("find_references");
    expect(readOnly).toContain("analyze_change_impact");
    expect(readOnly).not.toContain("apply_patch");
    expect(readOnly).not.toContain("delete_file");
    expect(readOnly).not.toContain("move_file");

    const mutation = listBuiltinMutationModelToolDefinitions().map((t) => t.name);
    expect(mutation).toContain("apply_patch");
    expect(mutation).toContain("delete_file");
    expect(mutation).toContain("delete_directory");
    expect(mutation).toContain("move_file");
    expect(mutation).toContain("run_command");

    const diagnostics = listBuiltinModelToolDefinitions().find(
      (t) => t.name === "read_diagnostics",
    );
    expect(diagnostics?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        paths: { type: "array" },
      },
    });

    const readonlyCmd = listBuiltinModelToolDefinitions().find(
      (t) => t.name === "run_readonly_command",
    );
    expect(
      (readonlyCmd?.inputSchema as { properties?: Record<string, unknown> })
        .properties,
    ).not.toHaveProperty("cwd");
  });
});
