import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  createBuiltinToolRegistry,
  directory,
  type ToolAdversaryPort,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

describe("ToolAdversaryPort preflight", () => {
  const runtime = new ToolRuntimePipeline(
    {
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    },
    { registry: createBuiltinToolRegistry() },
  );

  const writeGrant = createReadOnlyGrant({
    maximumWorkspaceEffect: "write",
    allowedTools: ["run_command", "delete_file", "describe_tool", "read_file"],
    allowedEffects: ["workspace_read", "workspace_write", "process_execute"],
    approvalMode: "never",
    commandRules: [
      {
        prefixes: ["echo", "git", "sudo", "rm"],
        allowShellMetacharacters: false,
      },
    ],
  });

  it("blocks when adversary returns BLOCK", async () => {
    const adversary: ToolAdversaryPort = {
      evaluate: () => ({
        decision: "BLOCK",
        reason: "test block sudo",
      }),
    };
    const result = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "adv_1",
        toolName: "run_command",
        arguments: { argv: ["sudo", "true"] },
        grant: writeGrant,
        workspaceRoot: WORKSPACE,
      },
      { adversary },
    );
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("tool_not_allowed");
    expect(result.warnings?.some((w) => w.includes("test block"))).toBe(true);
  });

  it("maps ASK to approval_required", async () => {
    const adversary: ToolAdversaryPort = {
      evaluate: () => ({
        decision: "ASK",
        reason: "need approval",
      }),
    };
    const result = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "adv_2",
        toolName: "run_command",
        arguments: { argv: ["git", "push"] },
        grant: writeGrant,
        workspaceRoot: WORKSPACE,
      },
      { adversary },
    );
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("approval_required");
  });

  it("no-ops when adversary unset", async () => {
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "adv_3",
      toolName: "read_file",
      arguments: { path: "missing.txt" },
      grant: createReadOnlyGrant({
        allowedTools: ["read_file", "describe_tool"],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.reasonCode).not.toBe("tool_not_allowed");
  });

  it("fail_closed treats adversary throw as BLOCK", async () => {
    const adversary: ToolAdversaryPort = {
      evaluate: () => {
        throw new Error("adversary down");
      },
    };
    const result = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "adv_4",
        toolName: "run_command",
        arguments: { argv: ["echo", "hi"] },
        grant: writeGrant,
        workspaceRoot: WORKSPACE,
      },
      { adversary, adversaryFailMode: "fail_closed" },
    );
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("tool_not_allowed");
  });
});
