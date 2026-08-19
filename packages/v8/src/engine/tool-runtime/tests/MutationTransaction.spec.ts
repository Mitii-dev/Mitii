import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  MUTATION_TOOL_IDS,
  ToolRuntimePipeline,
  directory,
  file,
  fingerprintToolCall,
  isPatchCurrentContentReason,
  isPatchTargetedDiscoveryReason,
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

  it("rejects with old_text_not_found and attaches currentContent", async () => {
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
    expect(result.reasonCode).toBe("old_text_not_found");
    expect(result.output).toEqual(
      expect.objectContaining({
        path: "src/a.ts",
        currentContent: "const x = 1;\n",
      }),
    );
  });

  it("rejects with old_text_ambiguous and attaches currentContent", async () => {
    const { runtime } = createRuntime(
      directory({ src: directory({ "a.ts": file("foo\nfoo\n") }) }),
    );
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m4b",
      toolName: "apply_patch",
      arguments: {
        patches: [{ path: "src/a.ts", oldText: "foo", newText: "bar" }],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("old_text_ambiguous");
    expect(result.output).toEqual(
      expect.objectContaining({
        path: "src/a.ts",
        currentContent: "foo\nfoo\n",
      }),
    );
  });

  it("rejects with patch_target_missing when the file does not exist", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m4c",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/missing.ts",
            oldText: "const x = 1;\n",
            newText: "const x = 2;\n",
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("patch_target_missing");
    expect(result.output?.currentContent).toBeUndefined();
  });

  it("rejects with patch_hash_mismatch and attaches currentContent", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m4d",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "const x = 1;\n",
            newText: "const x = 2;\n",
            expectedHash: "stale-hash",
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("patch_hash_mismatch");
    expect(result.output).toEqual(
      expect.objectContaining({
        path: "src/a.ts",
        currentContent: "const x = 1;\n",
      }),
    );
  });

  it("rejects identical oldText and newText without attaching currentContent", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m4e",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "const x = 1;\n",
            newText: "const x = 1;\n",
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("identical_old_and_new");
    expect(result.output?.currentContent).toBeUndefined();
  });

  it("rejects with patch_syntax_invalid and attaches currentContent", async () => {
    const { runtime } = createRuntime(
      directory({ src: directory({ "data.json": file('{"ok":true}') }) }),
    );
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m4f",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/data.json",
            oldText: '{"ok":true}',
            newText: "{not-json",
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("patch_syntax_invalid");
    expect(result.output).toEqual(
      expect.objectContaining({
        path: "src/data.json",
        currentContent: '{"ok":true}',
      }),
    );
  });

  it("classifies which patch reason codes attach content vs targeted discovery", () => {
    expect(isPatchCurrentContentReason("old_text_not_found")).toBe(true);
    expect(isPatchCurrentContentReason("old_text_ambiguous")).toBe(true);
    expect(isPatchCurrentContentReason("patch_target_missing")).toBe(false);
    expect(isPatchCurrentContentReason("identical_old_and_new")).toBe(false);
    expect(isPatchTargetedDiscoveryReason("old_text_not_found")).toBe(true);
    expect(isPatchTargetedDiscoveryReason("patch_target_missing")).toBe(true);
    expect(isPatchTargetedDiscoveryReason("old_text_ambiguous")).toBe(false);
    expect(isPatchTargetedDiscoveryReason("identical_old_and_new")).toBe(false);
    expect(isPatchTargetedDiscoveryReason("patch_syntax_invalid")).toBe(false);
    expect(isPatchTargetedDiscoveryReason("patch_conflict")).toBe(true);
  });

  it("replaces every exact occurrence when replaceAll is true", async () => {
    const { runtime, fs } = createRuntime(
      directory({ src: directory({ "a.ts": file("foo\nfoo\n") }) }),
    );
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m6",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "foo",
            newText: "bar",
            replaceAll: true,
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("succeeded");
    const patched = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(patched.content).toBe("bar\nbar\n");
  });

  it("still treats regex-looking oldText as a literal under replaceAll", async () => {
    const { runtime, fs } = createRuntime(
      directory({ src: directory({ "a.ts": file("a.*\na.*\n") }) }),
    );
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m6b",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "a.*",
            newText: "b",
            replaceAll: true,
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("succeeded");
    const patched = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(patched.content).toBe("b\nb\n");
  });

  it("coerces string replaceAll and keeps unique-match as the default", async () => {
    const { runtime } = createRuntime(
      directory({ src: directory({ "a.ts": file("foo\nfoo\n") }) }),
    );
    const coerced = await runtime.execute({
      schemaVersion: 1,
      callId: "m6c",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "foo",
            newText: "bar",
            replaceAll: "true",
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });
    expect(coerced.status).toBe("succeeded");

    const unique = await runtime.execute({
      schemaVersion: 1,
      callId: "m6d",
      toolName: "apply_patch",
      arguments: {
        patches: [{ path: "src/a.ts", oldText: "bar", newText: "baz" }],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });
    expect(unique.status).toBe("rejected");
    expect(unique.reasonCode).toBe("old_text_ambiguous");
  });

  it("rejects replaceAll with empty oldText", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m6e",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "",
            newText: "const y = 1;\n",
            replaceAll: true,
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("invalid_arguments");
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
