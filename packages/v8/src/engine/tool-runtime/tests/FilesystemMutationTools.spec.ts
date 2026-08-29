import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  MUTATION_TOOL_IDS,
  ToolRuntimePipeline,
  directory,
  file,
  fingerprintToolCall,
  listBuiltinMutationModelToolDefinitions,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";
import type { ToolGrant } from "../../../modules/decision-policy";

const WORKSPACE = "/workspace";

function createWriteGrant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return {
    maximumWorkspaceEffect: "write",
    allowedTools: [
      ...createReadOnlyGrant().allowedTools,
      ...MUTATION_TOOL_IDS,
    ],
    allowedEffects: [
      "workspace_read",
      "workspace_write",
      "process_execute",
    ],
    pathScopes: ["."],
    approvalMode: "never",
    limits: {
      maxToolCalls: 24,
      maxWallTimeMs: 90_000,
      maxOutputBytes: 256_000,
      maxConcurrentTools: 1,
    },
    ...overrides,
  };
}

function createRuntime(
  root = directory({
    src: directory({
      "a.ts": file("const x = 1;\n"),
      nested: directory({
        "b.ts": file("export const b = 1;\n"),
      }),
    }),
    empty: directory({}),
  }),
) {
  const fs = new InMemoryFileSystemAdapter(WORKSPACE, root);
  return {
    fs,
    runtime: new ToolRuntimePipeline({
      fileSystem: fs,
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    }),
  };
}

describe("filesystem mutation tools", () => {
  it("exposes delete/move tools in mutation model definitions and grants", () => {
    const names = listBuiltinMutationModelToolDefinitions().map((t) => t.name);
    expect(names).toContain("delete_file");
    expect(names).toContain("delete_directory");
    expect(names).toContain("move_file");
    expect(MUTATION_TOOL_IDS).toEqual(
      expect.arrayContaining([
        "apply_patch",
        "delete_file",
        "delete_directory",
        "move_file",
      ]),
    );
  });

  it("names missing apply_patch fields instead of a bare Required", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "p-missing",
      toolName: "apply_patch",
      arguments: { patches: [{ path: "src/a.ts" }] },
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("invalid_arguments");
    expect(result.warnings.join(" ")).toContain("patches.0.oldText");
    expect(result.warnings.join(" ")).toContain("patches.0.newText");
  });

  it("accepts flat path/oldText/newText by wrapping into patches[]", async () => {
    const { fs, runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "p-flat",
      toolName: "apply_patch",
      arguments: {
        path: "src/a.ts",
        oldText: "const x = 1;\n",
        newText: "const x = 2;\n",
      },
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    expect((await fs.readFile(`${WORKSPACE}/src/a.ts`)).content).toBe(
      "const x = 2;\n",
    );
  });

  it("accepts stringified patches arrays from mis-encoded model calls", async () => {
    const { fs, runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "p-string-patches",
      toolName: "apply_patch",
      arguments: {
        patches: JSON.stringify([
          {
            path: "src/a.ts",
            oldText: "const x = 1;\n",
            newText: "const x = 3;\n",
          },
        ]),
      },
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    expect((await fs.readFile(`${WORKSPACE}/src/a.ts`)).content).toBe(
      "const x = 3;\n",
    );
  });

  it("deletes a file and rolls it back", async () => {
    const { fs, runtime } = createRuntime();

    const deleted = await runtime.execute({
      schemaVersion: 1,
      callId: "d1",
      toolName: "delete_file",
      arguments: { path: "src/a.ts" },
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });

    expect(deleted.status).toBe("succeeded");
    const output = deleted.output as {
      checkpointId: string;
      changedFiles: string[];
    };
    expect(output.changedFiles).toEqual(["src/a.ts"]);

    await expect(fs.readFile(`${WORKSPACE}/src/a.ts`)).rejects.toThrow();

    const rolled = await runtime.rollbackMutation({
      checkpointId: output.checkpointId,
    });
    expect(rolled.status).toBe("succeeded");
    const restored = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(restored.content).toBe("const x = 1;\n");
  });

  it("rejects delete_file on a directory", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "d2",
      toolName: "delete_file",
      arguments: { path: "src" },
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("invalid_arguments");
  });

  it("deletes a directory recursively and rolls it back", async () => {
    const { fs, runtime } = createRuntime();

    const deleted = await runtime.execute({
      schemaVersion: 1,
      callId: "d3",
      toolName: "delete_directory",
      arguments: { path: "src/nested" },
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });

    expect(deleted.status).toBe("succeeded");
    const output = deleted.output as { checkpointId: string };
    await expect(
      fs.readFile(`${WORKSPACE}/src/nested/b.ts`),
    ).rejects.toThrow();

    const rolled = await runtime.rollbackMutation({
      checkpointId: output.checkpointId,
    });
    expect(rolled.status).toBe("succeeded");
    const restored = await fs.readFile(`${WORKSPACE}/src/nested/b.ts`);
    expect(restored.content).toBe("export const b = 1;\n");
  });

  it("deletes an empty directory and restores it", async () => {
    const { fs, runtime } = createRuntime();

    const deleted = await runtime.execute({
      schemaVersion: 1,
      callId: "d4",
      toolName: "delete_directory",
      arguments: { path: "empty" },
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(deleted.status).toBe("succeeded");
    await expect(fs.lstat(`${WORKSPACE}/empty`)).rejects.toThrow();

    const output = deleted.output as { checkpointId: string };
    const rolled = await runtime.rollbackMutation({
      checkpointId: output.checkpointId,
    });
    expect(rolled.status).toBe("succeeded");
    const stat = await fs.lstat(`${WORKSPACE}/empty`);
    expect(stat.kind).toBe("directory");
  });

  it("moves a file and rolls it back", async () => {
    const { fs, runtime } = createRuntime();

    const moved = await runtime.execute({
      schemaVersion: 1,
      callId: "m1",
      toolName: "move_file",
      arguments: { from: "src/a.ts", to: "src/renamed.ts" },
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });

    expect(moved.status).toBe("succeeded");
    await expect(fs.readFile(`${WORKSPACE}/src/a.ts`)).rejects.toThrow();
    const atDest = await fs.readFile(`${WORKSPACE}/src/renamed.ts`);
    expect(atDest.content).toBe("const x = 1;\n");

    const output = moved.output as { checkpointId: string };
    const rolled = await runtime.rollbackMutation({
      checkpointId: output.checkpointId,
    });
    expect(rolled.status).toBe("succeeded");
    const restored = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(restored.content).toBe("const x = 1;\n");
    await expect(fs.readFile(`${WORKSPACE}/src/renamed.ts`)).rejects.toThrow();
  });

  it("moves a directory and rolls it back", async () => {
    const { fs, runtime } = createRuntime();

    const moved = await runtime.execute({
      schemaVersion: 1,
      callId: "m2",
      toolName: "move_file",
      arguments: { from: "src/nested", to: "src/moved" },
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(moved.status).toBe("succeeded");
    const atDest = await fs.readFile(`${WORKSPACE}/src/moved/b.ts`);
    expect(atDest.content).toBe("export const b = 1;\n");

    const output = moved.output as { checkpointId: string };
    await runtime.rollbackMutation({ checkpointId: output.checkpointId });
    const restored = await fs.readFile(`${WORKSPACE}/src/nested/b.ts`);
    expect(restored.content).toBe("export const b = 1;\n");
  });

  it("rejects move when destination already exists", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m3",
      toolName: "move_file",
      arguments: { from: "src/a.ts", to: "src/nested/b.ts" },
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("invalid_arguments");
  });

  it("requires approval for delete_file when approvalMode is when_required", async () => {
    const { runtime } = createRuntime();
    const args = { path: "src/a.ts" };
    const denied = await runtime.execute({
      schemaVersion: 1,
      callId: "a1",
      toolName: "delete_file",
      arguments: args,
      grant: createWriteGrant({ approvalMode: "when_required" }),
      workspaceRoot: WORKSPACE,
    });
    expect(denied.status).toBe("rejected");
    expect(denied.reasonCode).toBe("approval_required");
    expect(
      (denied.output as { fingerprint?: string; paths?: string[] } | undefined)
        ?.fingerprint,
    ).toBe(fingerprintToolCall("delete_file", args));
    expect(
      (denied.output as { paths?: string[] } | undefined)?.paths,
    ).toEqual(["src/a.ts"]);
  });

  it("rejects dirty-overlap for move_file", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "m4",
        toolName: "move_file",
        arguments: { from: "src/a.ts", to: "src/z.ts" },
        grant: createWriteGrant(),
        workspaceRoot: WORKSPACE,
      },
      { dirtyPaths: ["src/a.ts"] },
    );
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("dirty_overlap");
  });
});
