import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  createBuiltinToolRegistry,
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
});
