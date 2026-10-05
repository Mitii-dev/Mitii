import { describe, expect, it } from "vitest";

import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";
import type { ToolResult } from "../../tool-runtime";
import type { AgentReasonCode } from "../contracts";
import { ReadLedger } from "../internal/ReadLedger";
import { ToolCallCache } from "../internal/ToolCallCache";

import type { EstablishedFact } from "./extractEstablishedFact";
import { applySucceededMutationSideEffects } from "./invalidateReadonlyCachesAfterMutation";

function toolResult(
  callId: string,
  toolName: string,
  output: unknown,
): ToolResult {
  return {
    schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
    callId,
    toolName,
    status: "succeeded",
    truncated: false,
    redacted: false,
    durationMs: 511,
    bytesProduced: 64,
    warnings: [],
    output,
    audit: {
      callId,
      toolName,
      startedAt: "2026-10-05T06:09:25.000Z",
      endedAt: "2026-10-05T06:09:25.511Z",
      status: "succeeded",
      inputPreview: toolName,
      outputPreview: "cached",
      bytesProduced: 64,
      durationMs: 511,
      truncated: false,
      redacted: false,
    },
  };
}

describe("applySucceededMutationSideEffects", () => {
  it("full-wipes readonly command cache and package.json ledger after run_command", () => {
    const toolCache = new ToolCallCache();
    const readLedger = new ReadLedger();
    const reasonCodes: AgentReasonCode[] = [];
    const changedFiles: string[] = [];
    const mutationCheckpointIds: string[] = [];
    const facts: EstablishedFact[] = [
      {
        id: "package.json",
        content: "package.json deps without antd",
      },
    ];

    const failedBuild = toolResult("c1", "run_readonly_command", {
      argv: ["npx", "vite", "build"],
      exitCode: 1,
      stderr: "Cannot find module 'antd'",
    });
    toolCache.setContent(
      "run_readonly_command",
      { argv: ["npx", "vite", "build"] },
      failedBuild,
    );
    readLedger.record({
      toolName: "read_file",
      argumentsValue: { path: "package.json" },
      preview: '{"dependencies":{}}',
    });

    applySucceededMutationSideEffects({
      toolName: "run_command",
      output: undefined,
      mutationCheckpointIds,
      changedFiles,
      toolCache,
      readLedger,
      establishedFacts: facts,
      reasonCodes,
    });

    expect(reasonCodes).toEqual([
      "mutation_applied",
      "shell_mutation_cache_invalidated",
    ]);
    expect(mutationCheckpointIds).toEqual([]);
    expect(changedFiles).toEqual([]);
    expect(
      toolCache.getByContent("run_readonly_command", {
        argv: ["npx", "vite", "build"],
      }),
    ).toBeUndefined();
    expect(
      readLedger.lookup({
        toolName: "read_file",
        argumentsValue: { path: "package.json" },
      }),
    ).toBeUndefined();
    expect(facts).toEqual([]);
  });

  it("keeps path-aware file-mutation invalidation for checkpoint tools", () => {
    const toolCache = new ToolCallCache();
    const readLedger = new ReadLedger();
    const reasonCodes: AgentReasonCode[] = [];
    const changedFiles: string[] = [];
    const mutationCheckpointIds: string[] = [];

    const srcA = toolResult("a", "read_file", "old a");
    const srcB = toolResult("b", "read_file", "old b");
    toolCache.setContent("read_file", { path: "src/a.ts" }, srcA);
    toolCache.setContent("read_file", { path: "src/b.ts" }, srcB);
    readLedger.record({
      toolName: "read_file",
      argumentsValue: { path: "src/a.ts" },
      preview: "old a",
    });
    readLedger.record({
      toolName: "read_file",
      argumentsValue: { path: "src/b.ts" },
      preview: "old b",
    });

    applySucceededMutationSideEffects({
      toolName: "apply_patch",
      output: {
        checkpointId: "cp_1",
        changedFiles: ["src/a.ts"],
      },
      mutationCheckpointIds,
      changedFiles,
      toolCache,
      readLedger,
      reasonCodes,
    });

    expect(reasonCodes).toEqual(["mutation_applied"]);
    expect(mutationCheckpointIds).toEqual(["cp_1"]);
    expect(changedFiles).toEqual(["src/a.ts"]);
    expect(
      toolCache.getByContent("read_file", { path: "src/a.ts" }),
    ).toBeUndefined();
    expect(
      toolCache.getByContent("read_file", { path: "src/b.ts" })?.output,
    ).toBe("old b");
    expect(
      readLedger.lookup({
        toolName: "read_file",
        argumentsValue: { path: "src/a.ts" },
      }),
    ).toBeUndefined();
    expect(
      readLedger.lookup({
        toolName: "read_file",
        argumentsValue: { path: "src/b.ts" },
      }),
    ).toBeDefined();
  });

  it("does not wipe caches for non-mutating successful tools", () => {
    const toolCache = new ToolCallCache();
    const reasonCodes: AgentReasonCode[] = [];
    const build = toolResult("c1", "run_readonly_command", { exitCode: 1 });
    toolCache.setContent(
      "run_readonly_command",
      { argv: ["npx", "vite", "build"] },
      build,
    );

    applySucceededMutationSideEffects({
      toolName: "run_readonly_command",
      output: undefined,
      mutationCheckpointIds: [],
      changedFiles: [],
      toolCache,
      reasonCodes,
    });

    expect(reasonCodes).toEqual([]);
    expect(
      toolCache.getByContent("run_readonly_command", {
        argv: ["npx", "vite", "build"],
      }),
    ).toBeDefined();
  });
});
