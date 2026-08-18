import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  MUTATION_TOOL_IDS,
  ToolRuntimePipeline,
  directory,
  file,
  fingerprintToolCall,
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
    approvalMode: "when_required",
    limits: {
      maxToolCalls: 24,
      maxWallTimeMs: 90_000,
      maxOutputBytes: 256_000,
      maxConcurrentTools: 1,
    },
    ...overrides,
  };
}

function createRuntime(root = directory({ "src": directory({ "a.ts": file("const x = 1;\n") }) })) {
  return {
    fs: new InMemoryFileSystemAdapter(WORKSPACE, root),
    runtime: new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, root),
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

describe("Tool Runtime Phase 8 mutations", () => {
  it("requires approval before apply_patch when approvalMode is when_required", async () => {
    const { runtime } = createRuntime();
    const args = {
      patches: [
        {
          path: "src/a.ts",
          oldText: "const x = 1;\n",
          newText: "const x = 2;\n",
        },
      ],
    };

    const denied = await runtime.execute({
      schemaVersion: 1,
      callId: "m1",
      toolName: "apply_patch",
      arguments: args,
      grant: createWriteGrant(),
      workspaceRoot: WORKSPACE,
    });

    expect(denied.status).toBe("rejected");
    expect(denied.reasonCode).toBe("approval_required");
    expect(
      (denied.output as { fingerprint?: string } | undefined)?.fingerprint,
    ).toBe(fingerprintToolCall("apply_patch", args));

    const afterDeny = await runtime.execute({
      schemaVersion: 1,
      callId: "m1b",
      toolName: "read_file",
      arguments: { path: "src/a.ts" },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });
    expect(afterDeny.status).toBe("succeeded");
    expect((afterDeny.output as { content: string }).content).toBe(
      "const x = 1;\n",
    );
  });

  it("applies a patch after matching approval and can roll back", async () => {
    const tree = directory({
      src: directory({ "a.ts": file("const x = 1;\n") }),
      "user.txt": file("keep-me\n"),
    });
    const fs = new InMemoryFileSystemAdapter(WORKSPACE, tree);
    const runtime = new ToolRuntimePipeline({
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

    const args = {
      patches: [
        {
          path: "src/a.ts",
          oldText: "const x = 1;\n",
          newText: "const x = 2;\n",
        },
      ],
    };
    const fingerprint = fingerprintToolCall("apply_patch", args);

    const applied = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "m2",
        toolName: "apply_patch",
        arguments: args,
        grant: createWriteGrant(),
        workspaceRoot: WORKSPACE,
      },
      {
        approval: {
          approvalId: "appr_1",
          fingerprint,
          decision: "approved",
        },
      },
    );

    expect(applied.status).toBe("succeeded");
    const output = applied.output as {
      checkpointId: string;
      changedFiles: string[];
    };
    expect(output.changedFiles).toEqual(["src/a.ts"]);

    const readPatched = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(readPatched.content).toBe("const x = 2;\n");

    // User file outside the transaction remains untouched across rollback.
    await fs.writeFile(`${WORKSPACE}/user.txt`, "user-edited\n");

    const rolled = await runtime.rollbackMutation({
      checkpointId: output.checkpointId,
    });
    expect(rolled.status).toBe("succeeded");

    const restored = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(restored.content).toBe("const x = 1;\n");
    const user = await fs.readFile(`${WORKSPACE}/user.txt`);
    expect(user.content).toBe("user-edited\n");
  });

  it("rejects dirty-overlap mutations", async () => {
    const { runtime } = createRuntime();
    const args = {
      patches: [
        {
          path: "src/a.ts",
          oldText: "const x = 1;\n",
          newText: "const x = 3;\n",
        },
      ],
    };
    const fingerprint = fingerprintToolCall("apply_patch", args);

    const result = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "m3",
        toolName: "apply_patch",
        arguments: args,
        grant: createWriteGrant({ approvalMode: "never" }),
        workspaceRoot: WORKSPACE,
      },
      {
        dirtyPaths: ["src/a.ts"],
      },
    );

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("dirty_overlap");
    void fingerprint;
  });

  it("rejects patch conflicts when oldText is missing", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "m4",
        toolName: "apply_patch",
        arguments: {
          patches: [
            {
              path: "src/a.ts",
              oldText: "does-not-exist",
              newText: "nope",
            },
          ],
        },
        grant: createWriteGrant({ approvalMode: "never" }),
        workspaceRoot: WORKSPACE,
      },
    );

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("patch_conflict");
    expect(result.output).toEqual(
      expect.objectContaining({
        path: "src/a.ts",
        currentContent: "const x = 1;\n",
      }),
    );
  });

  it("rejects write grant without write effect", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m5",
      toolName: "apply_patch",
      arguments: {
        patches: [
          { path: "src/a.ts", oldText: "const x = 1;\n", newText: "x" },
        ],
      },
      grant: createReadOnlyGrant({
        allowedTools: ["apply_patch", ...createReadOnlyGrant().allowedTools],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("effect_not_granted");
  });
});
