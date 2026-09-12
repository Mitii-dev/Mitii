import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  createBuiltinToolRegistry,
  defineTool,
  directory,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

describe("describe_tool progressive disclosure", () => {
  const runtime = new ToolRuntimePipeline(
    {
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    },
    { registry: createBuiltinToolRegistry() },
  );

  it("returns full schema for a granted tool", async () => {
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "describe_1",
      toolName: "describe_tool",
      arguments: { name: "read_file" },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("succeeded");
    expect(result.output).toMatchObject({
      name: "read_file",
      found: true,
    });
    const output = result.output as {
      inputSchema: Record<string, unknown>;
      description: string;
    };
    expect(output.description.length).toBeGreaterThan(10);
    expect(output.inputSchema).not.toMatchObject({
      description: expect.stringContaining("Index stub"),
    });
    expect(Object.keys(output.inputSchema).length).toBeGreaterThan(0);
  });

  it("denies schema for tools outside the grant", async () => {
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "describe_2",
      toolName: "describe_tool",
      arguments: { name: "apply_patch" },
      grant: createReadOnlyGrant({
        allowedTools: ["describe_tool", "read_file"],
      }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("succeeded");
    expect(result.output).toMatchObject({
      name: "apply_patch",
      found: false,
    });
  });

  it("registers describe_tool as a builtin", () => {
    expect(
      createBuiltinToolRegistry()
        .list()
        .some((t) => t.definition.name === "describe_tool"),
    ).toBe(true);
  });

  it("hydrates mcp__ tools when grant has write effect", async () => {
    const registry = createBuiltinToolRegistry().register({
      definition: defineTool({
        name: "mcp__memory__store",
        effects: ["workspace_read", "workspace_write"],
        backend: "mcp",
        description: "[MCP:memory] store",
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
        modelInputSchema: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"],
        },
        executeSupported: true,
      }),
      async execute() {
        return { output: {}, truncated: false, redacted: false };
      },
    });
    const mcpRuntime = new ToolRuntimePipeline(
      {
        fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, directory({})),
        process: new InMemoryProcessAdapter(async () => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          cancelled: false,
          truncated: false,
        })),
      },
      { registry },
    );

    const result = await mcpRuntime.execute({
      schemaVersion: 1,
      callId: "describe_mcp",
      toolName: "describe_tool",
      arguments: { name: "mcp__memory__store" },
      grant: createReadOnlyGrant({
        maximumWorkspaceEffect: "write",
        allowedTools: ["describe_tool", "read_file"],
        allowedEffects: ["workspace_read", "workspace_write"],
      }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("succeeded");
    expect(result.output).toMatchObject({
      name: "mcp__memory__store",
      found: true,
    });
  });
});
