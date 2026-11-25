import { describe, expect, it } from "vitest";

import {
  MCP_ATTACH_STAGES,
  McpAttachPipeline,
  type ModuleLoggerPort,
} from "../../index";

describe("McpAttachPipeline", () => {
  it("resolves attach list from pins + mentions", () => {
    const result = new McpAttachPipeline().resolveAttachList({
      message: "@mcp:memory Draw the flow",
      explicitIds: ["filesystem"],
    });
    expect(result.cleanedMessage).toBe("Draw the flow");
    expect(result.requiredMcpServerIds).toEqual(["filesystem", "memory"]);
  });

  it("emits logger stage events for resolveAttachList", () => {
    const stages: string[] = [];
    const log: ModuleLoggerPort = {
      stage(event) {
        stages.push(event.stage);
      },
    };
    new McpAttachPipeline({ log }).resolveAttachList({
      message: "@mcp:memory hi",
    });
    expect(stages).toEqual([
      MCP_ATTACH_STAGES.parseMentions,
      MCP_ATTACH_STAGES.mergeServerIds,
    ]);
  });

  it("filters tools and formats instruction via facade", () => {
    const pipeline = new McpAttachPipeline();
    const ids = ["memory"];
    expect(
      pipeline
        .filterTools(
          [{ name: "read_file" }, { name: "mcp__memory__x" }, { name: "mcp__other__y" }],
          ids,
        )
        .map((t) => t.name),
    ).toEqual(["read_file", "mcp__memory__x"]);
    expect(pipeline.formatInstruction(ids)?.id).toBe("mcp-attach");
  });
});
