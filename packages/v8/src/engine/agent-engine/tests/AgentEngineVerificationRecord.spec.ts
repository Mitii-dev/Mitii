import { describe, expect, it } from "vitest";

import { MUTATION_TOOL_IDS, READ_ONLY_TOOL_IDS } from "../../../modules/decision-policy";
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import {
  InMemoryVerificationRecordStore,
  VERIFICATION_SCHEMA_VERSION,
} from "../../../modules/verification";
import type { VerificationRecord, VerificationResult } from "../../../modules/verification";
import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
  file,
} from "../../tool-runtime";

import { AgentEnginePipeline, agentEngineStartInputSchema } from "..";
import {
  createCapabilities,
  createDecision,
  createStubDependencies,
  ScriptedLlmPort,
} from "./fixtures/stubs";

const WORKSPACE = "/workspace";

function failedVerification(): VerificationResult {
  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    status: "verification_failed",
    stateToken: "tok_1",
    affectedProjectIds: ["web"],
    checks: [
      {
        checkId: "web:typecheck",
        kind: "typecheck",
        label: "typecheck",
        evidenceSource: "test",
        outcome: "failed",
        summary: "Typecheck failed.",
      },
    ],
    diagnostics: [
      {
        path: "src/a.ts",
        severity: "error",
        message: "Expected x to be 3.",
        startLine: 1,
      },
    ],
    diff: {
      reviewed: true,
      staleStateRisk: false,
      summary: "reviewed",
      changedPaths: ["src/a.ts"],
    },
    warnings: [],
    reasonCodes: ["checks_failed"],
    durationMs: 5,
  };
}

describe("AgentEnginePipeline verification records", () => {
  it("persists a retry record, commits memory, and reloads it on a fix-those ask", async () => {
    const fs = new InMemoryFileSystemAdapter(
      WORKSPACE,
      directory({ src: directory({ "a.ts": file("const x = 1;\n") }) }),
    );
    const tools = new ToolRuntimePipeline({
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
    const store = new InMemoryVerificationRecordStore();
    const committed: string[] = [];
    const saved: VerificationRecord[] = [];
    const pinnedState = { workspaceId: "ws_1", stateToken: "tok_1" };

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: {
          maximumWorkspaceEffect: "write",
          allowedTools: [...READ_ONLY_TOOL_IDS, ...MUTATION_TOOL_IDS],
          allowedEffects: ["workspace_read", "workspace_write", "process_execute"],
          pathScopes: ["."],
          approvalMode: "never",
          limits: {
            maxToolCalls: 24,
            maxWallTimeMs: 90_000,
            maxOutputBytes: 256_000,
            maxConcurrentTools: 1,
          },
        },
        pinnedState,
        verification: {
          required: true,
          minimumEvidence: [],
          allowUnavailable: false,
        },
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [
              {
                id: "call_patch",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "src/a.ts",
                      oldText: "const x = 1;\n",
                      newText: "const x = 2;\n",
                    },
                  ],
                }),
              },
            ],
          },
          { content: "Updated src/a.ts to set x = 2." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    deps.tools = {
      execute: (input, options) => tools.execute(input, options),
      rollbackMutation: (input) => tools.rollbackMutation(input),
      commitMutation: (checkpointId) => tools.commitMutation(checkpointId),
    };
    deps.verification = {
      verify: async () => failedVerification(),
      persistRecord: async (record) => {
        saved.push(record);
        await store.save(record);
      },
      loadLatestRecord: (workspaceId) => store.loadLatest(workspaceId),
    };
    deps.memory = {
      retrieve: async () => ({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        status: "empty",
        instructions: [],
        omissions: [],
        usedTokens: 0,
        budgetTokens: 800,
        warnings: [],
        reasonCodes: ["store_empty"],
        durationMs: 1,
      }),
      commit: async (input) => {
        committed.push(input.content);
        return {
          schemaVersion: MEMORY_SCHEMA_VERSION,
          status: "committed",
          memoryId: "mem_verify",
          warnings: [],
          reasonCodes: ["memory_committed"],
          durationMs: 1,
        };
      },
    };

    const engine = new AgentEnginePipeline(deps);
    const first = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_verify_record",
          mode: "agent",
          userMessage: "Change x to 2 in src/a.ts",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: WORKSPACE,
        repositoryState: { reference: pinnedState, readiness: "ready" },
      }),
    ).result;

    expect(first.status).toBe("completed");
    expect(first.reasonCodes).toContain("verification_record_saved");
    expect(first.reasonCodes).toContain("verification_retry_available");
    expect(first.reasonCodes).toContain("memory_committed");
    expect(first.verificationRecord?.retry?.kind).toBe("fix_remaining");
    expect(committed[0]).toContain("Retry handle: verification/");
    expect(saved.some((record) => record.status === "incomplete")).toBe(true);

    const retry = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_verify_record",
          mode: "agent",
          userMessage: "fix the remaining verification errors",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: WORKSPACE,
        repositoryState: { reference: pinnedState, readiness: "ready" },
      }),
    ).result;

    expect(retry.reasonCodes).toContain("verification_retry_loaded");
  });
});
