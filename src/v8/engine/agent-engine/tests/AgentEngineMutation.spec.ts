import { describe, expect, it } from "vitest";

import type { ToolGrant } from "../../../modules/decision-policy";
import { MUTATION_TOOL_IDS, READ_ONLY_TOOL_IDS } from "../../../modules/decision-policy";
import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
  file,
} from "../../tool-runtime";
import type { ToolExecuteOptions, ToolInvocationInput, ToolResult } from "../../tool-runtime";
import { VERIFICATION_SCHEMA_VERSION } from "../../../modules/verification";
import type { VerificationResult } from "../../../modules/verification";

import {
  AgentEnginePipeline,
  InMemoryRunCheckpointStore,
  agentEngineStartInputSchema,
} from "..";
import type { AgentEngineToolRuntimePort } from "../contracts";
import {
  createDecision,
  createStubDependencies,
  createCapabilities,
  ScriptedLlmPort,
} from "./fixtures/stubs";

const WORKSPACE = "/workspace";

function createWriteGrant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return {
    maximumWorkspaceEffect: "write",
    allowedTools: [...READ_ONLY_TOOL_IDS, ...MUTATION_TOOL_IDS],
    allowedEffects: ["workspace_read", "workspace_write", "process_execute"],
    pathScopes: ["."],
    approvalMode: "when_required",
    limits: {
      maxToolCalls: 24,
      maxWallTimeMs: 90_000,
      maxOutputBytes: 256_000,
      maxConcurrentTools: 1,
    },
    ...overrides,
  };
}

function createWorkspace() {
  const tree = directory({
    src: directory({ "a.ts": file("const x = 1;\n") }),
  });
  const fs = new InMemoryFileSystemAdapter(WORKSPACE, tree);
  const realTools = new ToolRuntimePipeline({
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
  return { fs, realTools };
}

function wrapTools(
  realTools: ToolRuntimePipeline,
  onExecute?: (input: ToolInvocationInput, result: ToolResult) => void,
): AgentEngineToolRuntimePort {
  return {
    execute: async (
      input: ToolInvocationInput,
      options?: ToolExecuteOptions,
    ): Promise<ToolResult> => {
      const result = await realTools.execute(input, options);
      onExecute?.(input, result);
      return result;
    },
    rollbackMutation: (input) => realTools.rollbackMutation(input),
    commitMutation: (checkpointId) => realTools.commitMutation(checkpointId),
  };
}

const APPLY_PATCH_ARGS = {
  patches: [
    {
      path: "src/a.ts",
      oldText: "const x = 1;\n",
      newText: "const x = 2;\n",
    },
  ],
};

function baseStartInput(overrides: Record<string, unknown> = {}) {
  return agentEngineStartInputSchema.parse({
    schemaVersion: 1,
    request: {
      sessionId: "sess_mut",
      mode: "agent",
      userMessage: "Change x to 2 in src/a.ts",
      workspace: { workspaceId: "ws_1" },
    },
    workspaceRoot: WORKSPACE,
    ...overrides,
  });
}

describe("AgentEnginePipeline mutation approvals (Phase 8)", () => {
  it("denies approval: status approval_denied, file left unchanged, nothing cached as succeeded", async () => {
    const { fs, realTools } = createWorkspace();
    let applyPatchSucceeded = 0;
    const tools = wrapTools(realTools, (input, result) => {
      if (input.toolName === "apply_patch" && result.status === "succeeded") {
        applyPatchSucceeded += 1;
      }
    });
    const checkpointStore = new InMemoryRunCheckpointStore();

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createWriteGrant(),
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [
              {
                id: "call_patch",
                name: "apply_patch",
                arguments: JSON.stringify(APPLY_PATCH_ARGS),
              },
            ],
          },
        ],
        createCapabilities({ supportsTools: true }),
      ),
      checkpointStore,
    });
    deps.tools = tools;
    const engine = new AgentEnginePipeline(deps);

    const started = await engine.start(baseStartInput()).result;
    expect(started.status).toBe("suspended");
    expect(started.suspension?.kind).toBe("approval_required");
    const approvalId = started.suspension?.approval?.approvalId;
    expect(approvalId).toBeTruthy();

    const resumed = await engine.resume({
      schemaVersion: 1,
      runId: started.runId,
      approval: { approvalId: approvalId!, decision: "denied" },
    }).result;

    expect(resumed.status).toBe("approval_denied");
    expect(resumed.reasonCodes).toContain("approval_denied");
    expect(applyPatchSucceeded).toBe(0);

    const untouched = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(untouched.content).toBe("const x = 1;\n");
  });

  it("approves resume: applies the patch once and does not replay the already-completed read_file call", async () => {
    const { fs, realTools } = createWorkspace();
    let readFileExecutions = 0;
    let applyPatchSucceeded = 0;
    const tools = wrapTools(realTools, (input, result) => {
      if (input.toolName === "read_file") readFileExecutions += 1;
      if (input.toolName === "apply_patch" && result.status === "succeeded") {
        applyPatchSucceeded += 1;
      }
    });
    const checkpointStore = new InMemoryRunCheckpointStore();

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createWriteGrant(),
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [
              {
                id: "call_read",
                name: "read_file",
                arguments: JSON.stringify({ path: "src/a.ts" }),
              },
              {
                id: "call_patch",
                name: "apply_patch",
                arguments: JSON.stringify(APPLY_PATCH_ARGS),
              },
            ],
          },
          { content: "Updated src/a.ts to set x = 2." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
      checkpointStore,
    });
    deps.tools = tools;
    const engine = new AgentEnginePipeline(deps);

    const started = await engine.start(baseStartInput()).result;
    expect(started.status).toBe("suspended");
    expect(started.suspension?.approval?.toolName).toBe("apply_patch");
    expect(readFileExecutions).toBe(1);
    expect(applyPatchSucceeded).toBe(0);

    const approvalId = started.suspension?.approval?.approvalId;
    const resumed = await engine.resume({
      schemaVersion: 1,
      runId: started.runId,
      approval: { approvalId: approvalId!, decision: "approved" },
    }).result;

    expect(resumed.status).toBe("completed");
    expect(resumed.answer).toContain("Updated");
    expect(resumed.reasonCodes).toContain("mutation_applied");
    expect(resumed.reasonCodes).toContain("resume_complete");
    // The read_file call from before suspension must not be replayed.
    expect(readFileExecutions).toBe(1);
    expect(applyPatchSucceeded).toBe(1);

    const patched = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(patched.content).toBe("const x = 2;\n");
  });

  it("rolls back the mutation when verification fails after an approved resume", async () => {
    const { fs, realTools } = createWorkspace();
    const tools = wrapTools(realTools);
    const checkpointStore = new InMemoryRunCheckpointStore();
    const pinnedState = { workspaceId: "ws_1", stateToken: "tok_1" };

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createWriteGrant(),
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
                arguments: JSON.stringify(APPLY_PATCH_ARGS),
              },
            ],
          },
          { content: "Updated src/a.ts to set x = 2." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
      checkpointStore,
    });
    deps.tools = tools;
    deps.verification = {
      verify: async (): Promise<VerificationResult> => ({
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        status: "verification_failed",
        stateToken: pinnedState.stateToken,
        affectedProjectIds: [],
        checks: [],
        diagnostics: [],
        diff: {
          reviewed: false,
          staleStateRisk: false,
          summary: "not reviewed",
          changedPaths: [],
        },
        warnings: [],
        reasonCodes: ["checks_failed"],
        durationMs: 5,
      }),
    };
    const engine = new AgentEnginePipeline(deps);

    const started = await engine.start(
      baseStartInput({
        repositoryState: { reference: pinnedState, readiness: "ready" },
      }),
    ).result;
    expect(started.status).toBe("suspended");

    const approvalId = started.suspension?.approval?.approvalId;
    const resumed = await engine.resume({
      schemaVersion: 1,
      runId: started.runId,
      approval: { approvalId: approvalId!, decision: "approved" },
    }).result;

    expect(resumed.status).toBe("failed");
    expect(resumed.error?.code).toBe("verification_failed");
    expect(resumed.reasonCodes).toContain("mutation_rolled_back");
    expect(resumed.reasonCodes).toContain("verification_failed");

    const rolledBack = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(rolledBack.content).toBe("const x = 1;\n");
  });
});
