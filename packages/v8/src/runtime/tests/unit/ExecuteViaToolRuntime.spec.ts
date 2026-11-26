import { describe, expect, it, vi } from "vitest";

import { grantSurfaceToToolGrant } from "../../adapters/tools/GrantSurfaceToToolGrant";
import { executeViaToolRuntime } from "../../adapters/tools/ExecuteViaToolRuntime";
import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { scriptedModelPort } from "../../adapters/model/ScriptedModelPort";

describe("grantSurfaceToToolGrant", () => {
  it("lifts surface into a valid ToolGrant", () => {
    const grant = grantSurfaceToToolGrant({
      allowedTools: ["read_file"],
      maximumWorkspaceEffect: "read",
      allowedEffects: ["workspace_read"],
    });
    expect(grant.allowedTools).toEqual(["read_file"]);
    expect(grant.pathScopes).toEqual(["."]);
    expect(grant.approvalMode).toBe("never");
  });

  it("preserves every_mutation approvalMode", () => {
    const grant = grantSurfaceToToolGrant({
      allowedTools: ["apply_patch"],
      maximumWorkspaceEffect: "write",
      allowedEffects: ["workspace_write"],
      approvalMode: "every_mutation",
    });
    expect(grant.approvalMode).toBe("every_mutation");
  });
});

describe("executeViaToolRuntime", () => {
  it("denies before calling pipeline when tool not on grant", async () => {
    const execute = vi.fn();
    const port = executeViaToolRuntime({
      pipeline: { execute } as never,
      workspaceRoot: "/tmp/ws",
    });
    const result = await port.execute({
      toolId: "apply_patch",
      args: {},
      invocationId: "1",
      grant: {
        allowedTools: ["read_file"],
        maximumWorkspaceEffect: "read",
      },
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("tool_not_allowed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("delegates to pipeline when granted", async () => {
    const execute = vi.fn().mockResolvedValue({
      status: "succeeded",
      output: { ok: true },
      reasonCode: undefined,
    });
    const port = executeViaToolRuntime({
      pipeline: { execute } as never,
      workspaceRoot: "/tmp/ws",
    });
    const result = await port.execute({
      toolId: "read_file",
      args: { path: "a.ts" },
      invocationId: "inv_1",
      grant: {
        allowedTools: ["read_file"],
        maximumWorkspaceEffect: "read",
        allowedEffects: ["workspace_read"],
      },
    });
    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0].toolName).toBe("read_file");
    expect(execute.mock.calls[0][0].workspaceRoot).toBe("/tmp/ws");
  });

  it("returns approval_required for mutate under every_mutation", async () => {
    const execute = vi.fn();
    const port = executeViaToolRuntime({
      pipeline: { execute } as never,
      workspaceRoot: "/tmp/ws",
    });
    const result = await port.execute({
      toolId: "apply_patch",
      args: {},
      invocationId: "inv_m",
      grant: {
        allowedTools: ["apply_patch"],
        maximumWorkspaceEffect: "write",
        allowedEffects: ["workspace_write"],
        approvalMode: "every_mutation",
      },
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("approval_required");
    expect(execute).not.toHaveBeenCalled();
  });

  it("composeRuntime wires toolRuntime + workspaceRoot", async () => {
    const execute = vi.fn().mockResolvedValue({
      status: "succeeded",
      output: {},
    });
    const runtime = composeRuntime({
      model: scriptedModelPort([
        {
          text: "",
          toolCalls: [
            { callId: "c1", toolId: "read_file", args: { path: "x.ts" } },
          ],
          reasonCodes: ["scripted"],
        },
        { text: "done", toolCalls: [], reasonCodes: ["done"] },
      ]),
      toolRuntime: { execute } as never,
      workspaceRoot: "/tmp/ws",
    });
    const result = await runtime.start({
      start: {
        message: "how does packages/v8/src/runtime StoreManager work?",
      },
      mode: "ask",
      runId: "tr-1",
    });
    expect(result.status).toBe("completed");
    expect(execute).toHaveBeenCalled();
  });
});
