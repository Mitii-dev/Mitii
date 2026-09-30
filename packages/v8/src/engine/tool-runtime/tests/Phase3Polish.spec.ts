import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
  file,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

describe("Phase 3 polish", () => {
  it("soft-blocks mutating argv on run_readonly_command", async () => {
    const runtime = new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(
        WORKSPACE,
        directory({ "a.ts": file("const x = 1;\n") }),
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
      callId: "soft_rm",
      toolName: "run_readonly_command",
      arguments: { argv: ["rm", "-rf", "a.ts"] },
      grant: createReadOnlyGrant({
        commandRules: [
          { prefixes: ["rm", "git status"], allowShellMetacharacters: false },
        ],
      }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("command_not_allowed");
    expect(result.warnings.join(" ")).toMatch(/soft file-edit guard/i);
  });

  it("apply_patch dryRun validates without writing", async () => {
    const fs = new InMemoryFileSystemAdapter(
      WORKSPACE,
      directory({ "a.ts": file("const x = 1;\n") }),
    );
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

    const grant = {
      ...createReadOnlyGrant(),
      maximumWorkspaceEffect: "write" as const,
      allowedTools: ["apply_patch"],
      allowedEffects: ["workspace_write" as const],
      approvalMode: "never" as const,
    };

    const before = await fs.readFile(`${WORKSPACE}/a.ts`);
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "dry_1",
      toolName: "apply_patch",
      arguments: {
        dryRun: true,
        patches: [
          {
            path: "a.ts",
            oldText: "const x = 1;\n",
            newText: "const x = 2;\n",
          },
        ],
      },
      grant,
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("succeeded");
    expect(result.output).toMatchObject({
      checkpointId: "dry_run",
      dryRun: true,
      changedFiles: ["a.ts"],
    });
    const after = await fs.readFile(`${WORKSPACE}/a.ts`);
    expect(after.content).toBe(before.content);
  });
});
