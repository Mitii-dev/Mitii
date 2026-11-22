import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  assertApprovalSatisfied,
  resolveApprovalCategories,
} from "./assertApprovalSatisfied";
import type { ToolDefinition } from "../ToolCatalog";
import type { ToolGrant } from "../../../../modules/decision-policy";
import { GrantValidationError } from "../../actions/ValidateGrant";

function writeTool(): ToolDefinition {
  return {
    name: "apply_patch",
    description: "Apply patches",
    effects: ["workspace_write"],
    backend: "local",
    status: "available",
    timeoutMs: 30_000,
    maxOutputBytes: 64_000,
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.unknown(),
    executeSupported: true,
  };
}

function commandTool(): ToolDefinition {
  return {
    name: "run_command",
    description: "Run command",
    effects: ["process_execute", "workspace_write"],
    backend: "local",
    status: "available",
    timeoutMs: 30_000,
    maxOutputBytes: 64_000,
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.unknown(),
    executeSupported: true,
  };
}

function baseGrant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return {
    maximumWorkspaceEffect: "write",
    allowedTools: ["apply_patch", "run_command"],
    allowedEffects: ["workspace_write", "process_execute"],
    pathScopes: ["."],
    approvalMode: "when_required",
    limits: {
      maxToolCalls: 8,
      maxWallTimeMs: 30_000,
      maxOutputBytes: 64_000,
    },
    ...overrides,
  };
}

describe("assertApprovalSatisfied auto-approve", () => {
  it("maps apply_patch to write and run_command to execute", () => {
    expect(resolveApprovalCategories(writeTool())).toEqual(["write"]);
    expect(resolveApprovalCategories(commandTool())).toEqual(["execute"]);
  });

  it("skips approval when write is in approvalSkipCategories", () => {
    expect(() =>
      assertApprovalSatisfied({
        tool: writeTool(),
        grant: baseGrant({ approvalSkipCategories: ["write"] }),
        arguments: {
          patches: [{ path: "src/a.ts", oldText: "a", newText: "b" }],
        },
      }),
    ).not.toThrow();
  });

  it("still requires approval for protected paths under write skip", () => {
    expect(() =>
      assertApprovalSatisfied({
        tool: writeTool(),
        grant: baseGrant({
          approvalSkipCategories: ["write"],
          protectedPathGlobs: [".mitii/**", "AGENTS.md"],
        }),
        arguments: {
          patches: [
            { path: ".mitii/safety.json", oldText: "{}", newText: "{}" },
          ],
        },
      }),
    ).toThrow(GrantValidationError);
  });

  it("skips execute approval for run_command when execute is skipped", () => {
    expect(() =>
      assertApprovalSatisfied({
        tool: commandTool(),
        grant: baseGrant({ approvalSkipCategories: ["execute"] }),
        arguments: { argv: ["pnpm", "test"] },
      }),
    ).not.toThrow();
  });

  it("requires approval when skip categories do not cover the tool", () => {
    expect(() =>
      assertApprovalSatisfied({
        tool: writeTool(),
        grant: baseGrant({ approvalSkipCategories: ["execute"] }),
        arguments: {
          patches: [{ path: "src/a.ts", oldText: "a", newText: "b" }],
        },
      }),
    ).toThrow(GrantValidationError);
  });
});
