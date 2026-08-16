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

  it("uses resume approvalMode override for later mutations in the same run", async () => {
    const { fs, realTools } = createWorkspace();
    let applyPatchSucceeded = 0;
    const tools = wrapTools(realTools, (input, result) => {
      if (input.toolName === "apply_patch" && result.status === "succeeded") {
        applyPatchSucceeded += 1;
      }
    });
    const checkpointStore = new InMemoryRunCheckpointStore();
    const secondPatchArgs = {
      patches: [
        {
          path: "src/a.ts",
          oldText: "const x = 2;\n",
          newText: "const x = 3;\n",
        },
      ],
    };

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
                id: "call_patch_1",
                name: "apply_patch",
                arguments: JSON.stringify(APPLY_PATCH_ARGS),
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "call_patch_2",
                name: "apply_patch",
                arguments: JSON.stringify(secondPatchArgs),
              },
            ],
          },
          { content: "Updated src/a.ts twice." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
      checkpointStore,
    });
    deps.tools = tools;
    const engine = new AgentEnginePipeline(deps);

    const started = await engine.start(baseStartInput()).result;
    expect(started.status).toBe("suspended");

    const approvalId = started.suspension?.approval?.approvalId;
    const resumed = await engine.resume({
      schemaVersion: 1,
      runId: started.runId,
      approvalMode: "never",
      approval: { approvalId: approvalId!, decision: "approved" },
    }).result;

    expect(resumed.status).toBe("completed");
    expect(applyPatchSucceeded).toBe(2);

    const patched = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(patched.content).toBe("const x = 3;\n");
  });

  it("keeps the mutation and summarizes when verification fails after an approved resume", async () => {
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

    expect(resumed.status).toBe("completed");
    expect(resumed.answer).toContain("Updated src/a.ts");
    expect(resumed.answer).toMatch(/kept the edits|Verification did not/i);
    expect(resumed.reasonCodes).toContain("verification_kept_changes");
    expect(resumed.reasonCodes).toContain("verification_incomplete");
    expect(resumed.reasonCodes).toContain("verification_failed");
    expect(resumed.reasonCodes).toContain("answer_produced");
    expect(resumed.reasonCodes).not.toContain("mutation_rolled_back");

    const kept = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(kept.content).toBe("const x = 2;\n");
  });

  it("keeps mutations when verification returns implemented_unverified", async () => {
    const { fs, realTools } = createWorkspace();
    const tools = wrapTools(realTools);
    const pinnedState = { workspaceId: "ws_1", stateToken: "tok_1" };

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createWriteGrant({ approvalMode: "never" }),
        pinnedState,
        verification: {
          required: true,
          minimumEvidence: ["diagnostics", "diff_review", "tests"],
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
          { content: "Updated dependency in package.json." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    deps.tools = tools;
    deps.verification = {
      verify: async (): Promise<VerificationResult> => ({
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        status: "implemented_unverified",
        stateToken: pinnedState.stateToken,
        affectedProjectIds: [],
        checks: [
          {
            checkId: "diagnostics:workspace",
            kind: "diagnostics",
            label: "diagnostics",
            evidenceSource: "tool:read_diagnostics",
            outcome: "passed",
            summary: "Read workspace diagnostics completed.",
          },
          {
            checkId: "diff_review:workspace",
            kind: "diff_review",
            label: "diff review",
            evidenceSource: "tool:read_git_status",
            outcome: "passed",
            summary: "Inspect git status and diff completed.",
          },
        ],
        diagnostics: [],
        diff: {
          reviewed: true,
          staleStateRisk: false,
          summary: "reviewed",
          changedPaths: ["src/a.ts"],
        },
        warnings: [
          'package.json at "package.json" has no discoverable typecheck/lint/test/build scripts.',
        ],
        reasonCodes: ["narrow_scope_selected", "checks_unavailable"],
        durationMs: 5,
      }),
    };
    const engine = new AgentEnginePipeline(deps);

    const result = await engine.start(
      baseStartInput({
        repositoryState: { reference: pinnedState, readiness: "ready" },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("verification_skipped");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.reasonCodes).not.toContain("mutation_rolled_back");
    expect(result.reasonCodes).not.toContain("verification_failed");
    expect(result.warnings.some((warning) => warning.includes("unverified"))).toBe(
      true,
    );

    const kept = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(kept.content).toBe("const x = 2;\n");
  });

  it("reports verification unavailability instead of the stale model answer", async () => {
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
    deps.verification = undefined;
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

    expect(resumed.status).toBe("completed");
    expect(resumed.answer).toContain("Updated src/a.ts");
    expect(resumed.answer).toContain("Verification is required but unavailable");
    expect(resumed.answer).not.toContain("rolled back");
    expect(resumed.reasonCodes).toContain("verification_kept_changes");
    expect(resumed.reasonCodes).toContain("verification_incomplete");
    expect(resumed.reasonCodes).toContain("answer_produced");
    expect(resumed.reasonCodes).not.toContain("mutation_rolled_back");

    const kept = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(kept.content).toBe("const x = 2;\n");
  });

  it("keeps the first edit and ends with a verification summary instead of repairing in-loop", async () => {
    const { fs, realTools } = createWorkspace();
    const tools = wrapTools(realTools);
    const pinnedState = { workspaceId: "ws_1", stateToken: "tok_1" };
    let verificationCalls = 0;

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createWriteGrant({ approvalMode: "never" }),
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
                id: "call_patch_initial",
                name: "apply_patch",
                arguments: JSON.stringify(APPLY_PATCH_ARGS),
              },
            ],
          },
          { content: "Updated src/a.ts to set x = 2." },
          {
            toolCalls: [
              {
                id: "call_patch_repair",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "src/a.ts",
                      oldText: "const x = 2;\n",
                      newText: "const x = 3;\n",
                    },
                  ],
                }),
              },
            ],
          },
          { content: "Repaired src/a.ts after verification failure." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    deps.tools = tools;
    deps.verification = {
      verify: async (): Promise<VerificationResult> => {
        verificationCalls += 1;
        return {
          schemaVersion: VERIFICATION_SCHEMA_VERSION,
          status:
            verificationCalls === 1
              ? "verification_failed"
              : "verified_success",
          stateToken: pinnedState.stateToken,
          affectedProjectIds: [],
          checks: [
            {
              checkId: "root:typecheck",
              kind: "typecheck",
              label: "typecheck",
              evidenceSource: "test",
              outcome: verificationCalls === 1 ? "failed" : "passed",
              summary:
                verificationCalls === 1
                  ? "Typecheck failed: expected x to be 3."
                  : "Typecheck passed.",
            },
          ],
          diagnostics:
            verificationCalls === 1
              ? [
                  {
                    path: "src/a.ts",
                    severity: "error",
                    message: "Expected x to be 3.",
                    startLine: 1,
                  },
                ]
              : [],
          diff: {
            reviewed: true,
            staleStateRisk: false,
            summary: "reviewed",
            changedPaths: ["src/a.ts"],
          },
          warnings: [],
          reasonCodes:
            verificationCalls === 1 ? ["checks_failed"] : ["checks_passed"],
          durationMs: 5,
        };
      },
    };
    const engine = new AgentEnginePipeline(deps);

    const events: unknown[] = [];
    const handle = engine.start(
      baseStartInput({
        repositoryState: { reference: pinnedState, readiness: "ready" },
      }),
    );
    for await (const event of handle.events) {
      events.push(event);
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("verification_kept_changes");
    expect(result.reasonCodes).toContain("verification_incomplete");
    expect(result.reasonCodes).not.toContain("verification_repair_attempted");
    expect(result.reasonCodes).not.toContain("mutation_rolled_back");
    expect(verificationCalls).toBe(1);
    const kept = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(kept.content).toBe("const x = 2;\n");
    const verificationEvents = events.filter(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "verification_completed",
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0]).toMatchObject({
      status: "verification_failed",
      checks: [{ kind: "typecheck", outcome: "failed" }],
      diagnostics: [{ path: "src/a.ts", severity: "error" }],
    });
  });

  it("does not count approval wait time against wall_time budget", async () => {
    const { fs, realTools } = createWorkspace();
    const tools = wrapTools(realTools);
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
          { content: "Patched after a long approval wait." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
      checkpointStore,
    });
    deps.tools = tools;
    const engine = new AgentEnginePipeline(deps);

    const started = await engine.start(
      baseStartInput({
        budget: {
          maxModelCalls: 8,
          maxToolCalls: 16,
          maxLoopIterations: 16,
          // Short active budget — would fail if approval wait counted.
          maxWallTimeMs: 1_500,
        },
      }),
    ).result;
    expect(started.status).toBe("suspended");
    expect(started.suspension?.kind).toBe("approval_required");

    const checkpoint = await checkpointStore.load(started.runId);
    expect(checkpoint).toBeTruthy();
    const now = Date.now();
    // Simulate ~10s user wait after only ~200ms of active work.
    await checkpointStore.save({
      ...checkpoint!,
      startedAtMs: now - 10_000,
      suspendedAtMs: now - 9_800,
      excludedWaitMs: 0,
    });

    const approvalId = started.suspension?.approval?.approvalId;
    const resumed = await engine.resume({
      schemaVersion: 1,
      runId: started.runId,
      approval: { approvalId: approvalId!, decision: "approved" },
    }).result;

    expect(resumed.status).toBe("completed");
    expect(resumed.answer).toContain("Patched");
    expect(resumed.reasonCodes).not.toContain("budget_exhausted");

    const patched = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(patched.content).toBe("const x = 2;\n");
  });
});
