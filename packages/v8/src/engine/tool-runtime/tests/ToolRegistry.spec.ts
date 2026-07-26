import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRegistry,
  ToolRuntimePipeline,
  createBuiltinToolRegistry,
  defineTool,
  directory,
  file,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

describe("ToolRegistry", () => {
  it("runs a custom tool without modifying the pipeline", async () => {
    const registry = createBuiltinToolRegistry().register({
      definition: defineTool({
        name: "echo_meta",
        effects: ["workspace_read"],
        description: "Test-only custom tool",
        inputSchema: z.object({ label: z.string().min(1) }).strict(),
        outputSchema: z.object({ label: z.string(), ok: z.literal(true) }).strict(),
        executeSupported: true,
      }),
      async execute(ctx) {
        const input = z
          .object({ label: z.string().min(1) })
          .strict()
          .parse(ctx.arguments);
        return {
          output: { label: input.label, ok: true as const },
          truncated: false,
          redacted: false,
        };
      },
    });

    const runtime = new ToolRuntimePipeline(
      {
        fileSystem: new InMemoryFileSystemAdapter(
          WORKSPACE,
          directory({ "a.txt": file("a") }),
        ),
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

    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "custom_1",
      toolName: "echo_meta",
      arguments: { label: "hello" },
      grant: createReadOnlyGrant({
        allowedTools: ["echo_meta"],
        allowedEffects: ["workspace_read"],
      }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ label: "hello", ok: true });
    expect(runtime.listCapabilities().some((c) => c.name === "echo_meta")).toBe(
      true,
    );
  });

  it("rejects duplicate registrations", () => {
    const registry = new ToolRegistry();
    const tool = {
      definition: defineTool({
        name: "dup",
        effects: ["workspace_read"] as const,
        description: "dup",
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({}).strict(),
        executeSupported: true,
      }),
      async execute() {
        return { output: {}, truncated: false, redacted: false };
      },
    };
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/);
  });
});
