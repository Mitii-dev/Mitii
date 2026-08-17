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
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationInput,
  VerificationResult,
} from "../../../modules/verification";

import { AgentEnginePipeline, agentEngineStartInputSchema } from "..";
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
    approvalMode: "never",
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
    src: directory({
      "a.ts": file("const a = 1;\n"),
      "b.ts": file("const b = 1;\n"),
    }),
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

function wrapTools(realTools: ToolRuntimePipeline): AgentEngineToolRuntimePort {
  return {
    execute: (input: ToolInvocationInput, options?: ToolExecuteOptions): Promise<ToolResult> =>
      realTools.execute(input, options),
    rollbackMutation: (input) => realTools.rollbackMutation(input),
    commitMutation: (checkpointId) => realTools.commitMutation(checkpointId),
  };
}

function baseStartInput(overrides: Record<string, unknown> = {}) {
  return agentEngineStartInputSchema.parse({
    schemaVersion: 1,
    request: {
      sessionId: "sess_repair_queue",
      mode: "agent",
      userMessage: "Fix all the typecheck errors in src/",
      workspace: { workspaceId: "ws_1" },
    },
    workspaceRoot: WORKSPACE,
    ...overrides,
  });
}

function buildState(errorPaths: readonly string[]): RepoBuildState {
  return {
    schemaVersion: 1,
    capturedAt: "2026-07-25T12:00:00.000Z",
    phase: "before",
    scope: {
      workspaceRoot: WORKSPACE,
      folderPrefixes: [],
      projectIds: [],
      changeScope: "localized",
    },
    checks: [],
    diagnostics: errorPaths.map((path) => ({
      path,
      severity: "error" as const,
      message: `Type error in ${path}.`,
      startLine: 1,
    })),
    summary: {
      errorCount: errorPaths.length,
      warningCount: 0,
      failedCheckIds: errorPaths.length > 0 ? ["typecheck"] : [],
    },
    reasonCodes: [],
  };
}

/** Mirrors compareRepoBuildStates' key/severity diffing exactly. */
function compare(
  beforePaths: readonly string[],
  afterPaths: readonly string[],
): RepoBuildStateComparison {
  const before = new Set(beforePaths);
  const after = new Set(afterPaths);
  const newErrorCount = afterPaths.filter((path) => !before.has(path)).length;
  const clearedErrorCount = beforePaths.filter((path) => !after.has(path)).length;
  const remainingErrorCount = afterPaths.filter((path) => before.has(path)).length;
  const reasonCodes: RepoBuildStateComparison["reasonCodes"] = [];
  if (clearedErrorCount > 0) reasonCodes.push("errors_cleared");
  if (remainingErrorCount > 0 || afterPaths.length > 0) {
    reasonCodes.push("errors_remaining");
  }
  if (newErrorCount > 0) reasonCodes.push("new_errors_introduced");
  return {
    beforeErrorCount: beforePaths.length,
    afterErrorCount: afterPaths.length,
    clearedErrorCount,
    newErrorCount,
    remainingErrorCount,
    failedCheckIdsBefore: beforePaths.length > 0 ? ["typecheck"] : [],
    failedCheckIdsAfter: afterPaths.length > 0 ? ["typecheck"] : [],
    reasonCodes,
  };
}

function verificationResult(paths: readonly string[]): VerificationResult {
  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    status: paths.length > 0 ? "verification_failed" : "verified_success",
    stateToken: "tok_1",
    affectedProjectIds: [],
    checks: [
      {
        checkId: "root:typecheck",
        kind: "typecheck",
        label: "typecheck",
        evidenceSource: "test",
        outcome: paths.length > 0 ? "failed" : "passed",
        summary: paths.length > 0 ? `${paths.length} typecheck error(s).` : "Typecheck passed.",
      },
    ],
    diagnostics: paths.map((path) => ({
      path,
      severity: "error" as const,
      message: `Type error in ${path}.`,
      startLine: 1,
    })),
    diff: {
      reviewed: true,
      staleStateRisk: false,
      summary: "reviewed",
      changedPaths: [...paths],
    },
    warnings: [],
    reasonCodes: paths.length > 0 ? ["checks_failed"] : ["checks_passed"],
    durationMs: 5,
  };
}

const pinnedState = { workspaceId: "ws_1", stateToken: "tok_1" };

describe("AgentEnginePipeline repair remaining-error queue (Phase 4)", () => {
  it("continues fixing pre-existing baseline errors without rollback when nothing new was introduced", async () => {
    const { fs, realTools } = createWorkspace();
    const tools = wrapTools(realTools);
    const baseline = ["src/a.ts", "src/b.ts"];
    // Call 1 (after batch 1's a.ts patch): b.ts still errors, nothing new.
    // Call 2 (after batch 2's b.ts patch): clean.
    const verifyResults = [["src/b.ts"], []];
    let verifyCalls = 0;

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createWriteGrant(),
        pinnedState,
        verification: { required: true, minimumEvidence: [], allowUnavailable: false },
        reasonCodes: ["mutation_execute", "preflight_build_recommended"],
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [
              {
                id: "call_patch_a",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/a.ts", oldText: "const a = 1;\n", newText: "const a: number = 1;\n" }],
                }),
              },
            ],
          },
          { content: "Fixed src/a.ts." },
          {
            toolCalls: [
              {
                id: "call_patch_b",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/b.ts", oldText: "const b = 1;\n", newText: "const b: number = 1;\n" }],
                }),
              },
            ],
          },
          { content: "Fixed src/b.ts. All typecheck errors resolved." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    deps.tools = tools;
    deps.verification = {
      verify: async () => verificationResult(verifyResults[verifyCalls++] ?? []),
      captureBuildState: async () => buildState(baseline),
      buildStateFromResult: (_input, result) =>
        buildState(result.diagnostics.map((d) => d.path)),
      compareBuildStates: ({ after }) =>
        compare(baseline, after.diagnostics.map((d) => d.path)),
    };
    const engine = new AgentEnginePipeline(deps);

    const result = await engine.start(
      baseStartInput({
        repositoryState: { reference: pinnedState, readiness: "ready" },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("verification_repair_attempted");
    expect(result.reasonCodes).toContain("verification_repair_succeeded");
    expect(result.reasonCodes).not.toContain("mutation_rolled_back");
    expect(result.reasonCodes).not.toContain("repo_build_state_remaining_error_batch");
    expect(verifyCalls).toBe(2);

    const a = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    const b = await fs.readFile(`${WORKSPACE}/src/b.ts`);
    expect(a.content).toContain("number");
    expect(b.content).toContain("number");
  });

  it("treats a genuine regression (new errors) as repairable-once, distinct from baseline carryover", async () => {
    const { realTools } = createWorkspace();
    const tools = wrapTools(realTools);
    const baseline = ["src/a.ts"];
    // Call 1: a.ts cleared, but c.ts (untouched by baseline) now errors — a
    // regression, not baseline carryover. Call 2: repaired, clean.
    const verifyResults = [["src/c.ts"], []];
    let verifyCalls = 0;

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createWriteGrant(),
        pinnedState,
        verification: { required: true, minimumEvidence: [], allowUnavailable: false },
        reasonCodes: ["mutation_execute", "preflight_build_recommended"],
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [
              {
                id: "call_patch_a",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/a.ts", oldText: "const a = 1;\n", newText: "const a: number = 1;\n" }],
                }),
              },
            ],
          },
          { content: "Fixed src/a.ts." },
          {
            toolCalls: [
              {
                id: "call_patch_b",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/b.ts", oldText: "const b = 1;\n", newText: "const b: number = 1;\n" }],
                }),
              },
            ],
          },
          { content: "Repaired the regression." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    deps.tools = tools;
    deps.verification = {
      verify: async () => verificationResult(verifyResults[verifyCalls++] ?? []),
      captureBuildState: async () => buildState(baseline),
      buildStateFromResult: (_input, result) =>
        buildState(result.diagnostics.map((d) => d.path)),
      compareBuildStates: ({ after }) =>
        compare(baseline, after.diagnostics.map((d) => d.path)),
    };
    const engine = new AgentEnginePipeline(deps);

    const result = await engine.start(
      baseStartInput({
        repositoryState: { reference: pinnedState, readiness: "ready" },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("verification_repair_attempted");
    expect(result.reasonCodes).toContain("verification_repair_succeeded");
    expect(result.reasonCodes).not.toContain("repo_build_state_remaining_error_batch");
    expect(result.reasonCodes).not.toContain("mutation_rolled_back");
    expect(verifyCalls).toBe(2);
  });

  it("keeps repairing remaining baseline errors across multiple batches on auto depth", async () => {
    const tree = directory({
      src: directory({
        "a.ts": file("const a = 1;\n"),
        "b.ts": file("const b = 1;\n"),
        "c.ts": file("const c = 1;\n"),
      }),
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
    const tools = wrapTools(realTools);
    const baseline = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const verifyResults = [["src/b.ts", "src/c.ts"], ["src/c.ts"], []];
    let verifyCalls = 0;

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createWriteGrant(),
        pinnedState,
        verification: { required: true, minimumEvidence: [], allowUnavailable: false },
        reasonCodes: ["mutation_execute", "preflight_build_recommended"],
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [
              {
                id: "call_patch_a",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/a.ts", oldText: "const a = 1;\n", newText: "const a: number = 1;\n" }],
                }),
              },
            ],
          },
          { content: "Fixed src/a.ts." },
          {
            toolCalls: [
              {
                id: "call_patch_b",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/b.ts", oldText: "const b = 1;\n", newText: "const b: number = 1;\n" }],
                }),
              },
            ],
          },
          { content: "Fixed src/b.ts." },
          {
            toolCalls: [
              {
                id: "call_patch_c",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/c.ts", oldText: "const c = 1;\n", newText: "const c: number = 1;\n" }],
                }),
              },
            ],
          },
          { content: "Fixed src/c.ts. All typecheck errors resolved." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    deps.tools = tools;
    deps.verification = {
      verify: async () => verificationResult(verifyResults[verifyCalls++] ?? []),
      captureBuildState: async () => buildState(baseline),
      buildStateFromResult: (_input, result) =>
        buildState(result.diagnostics.map((d) => d.path)),
      compareBuildStates: ({ after }) =>
        compare(baseline, after.diagnostics.map((d) => d.path)),
    };
    const engine = new AgentEnginePipeline(deps);

    const result = await engine.start(
      baseStartInput({
        repositoryState: { reference: pinnedState, readiness: "ready" },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("verification_repair_attempted");
    expect(result.reasonCodes).toContain("verification_repair_succeeded");
    expect(result.reasonCodes).not.toContain("verification_kept_changes");
    expect(verifyCalls).toBe(3);
    expect((await fs.readFile(`${WORKSPACE}/src/c.ts`)).content).toContain("number");
  });

  it("Quick exploration depth stops after one remaining-error batch instead of looping to zero", async () => {
    const { realTools } = createWorkspace();
    const tools = wrapTools(realTools);
    const baseline = ["src/a.ts", "src/b.ts"];
    // Only one batch runs (Quick); b.ts is still broken afterward.
    const verifyResults = [["src/b.ts"]];
    let verifyCalls = 0;

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createWriteGrant(),
        pinnedState,
        verification: { required: true, minimumEvidence: [], allowUnavailable: false },
        reasonCodes: ["mutation_execute", "preflight_build_recommended"],
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [
              {
                id: "call_patch_a",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/a.ts", oldText: "const a = 1;\n", newText: "const a: number = 1;\n" }],
                }),
              },
            ],
          },
          { content: "Fixed src/a.ts; src/b.ts still has a type error." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    deps.tools = tools;
    deps.verification = {
      verify: async () => verificationResult(verifyResults[verifyCalls++] ?? verifyResults.at(-1)!),
      captureBuildState: async () => buildState(baseline),
      buildStateFromResult: (_input, result) =>
        buildState(result.diagnostics.map((d) => d.path)),
      compareBuildStates: ({ after }) =>
        compare(baseline, after.diagnostics.map((d) => d.path)),
    };
    const engine = new AgentEnginePipeline(deps);

    const result = await engine.start(
      baseStartInput({
        explorationDepth: "quick",
        repositoryState: { reference: pinnedState, readiness: "ready" },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("verification_repair_attempted");
    expect(result.reasonCodes).toContain("verification_kept_changes");
    expect(result.reasonCodes).toContain("verification_incomplete");
    expect(result.reasonCodes).not.toContain("verification_repair_succeeded");
    expect(result.reasonCodes).not.toContain("repo_build_state_remaining_error_batch");
    expect(result.reasonCodes).not.toContain("mutation_rolled_back");
    expect(verifyCalls).toBe(2);
  });

  it("only verifies changed files, so an unrelated pre-existing error never enters the repair queue", async () => {
    const { realTools } = createWorkspace();
    const tools = wrapTools(realTools);
    const unrelatedBaseline = ["src/unrelated.ts"];

    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createWriteGrant(),
        pinnedState,
        verification: { required: true, minimumEvidence: [], allowUnavailable: false },
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [
              {
                id: "call_patch_a",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/a.ts", oldText: "const a = 1;\n", newText: "const a: number = 1;\n" }],
                }),
              },
            ],
          },
          { content: "Added a type annotation to src/a.ts." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    deps.tools = tools;
    deps.verification = {
      // Only reports diagnostics for files actually in scope of this
      // verification call — an unrelated pre-existing error in a file the
      // model never touched is out of scope, matching real Verification's
      // changeScope: "localized" behavior.
      verify: async (input: VerificationInput) =>
        verificationResult(
          unrelatedBaseline.filter((path) => input.changedFiles.includes(path)),
        ),
      captureBuildState: async () => buildState(unrelatedBaseline),
      buildStateFromResult: (_input, result) =>
        buildState(result.diagnostics.map((d) => d.path)),
      compareBuildStates: ({ after }) =>
        compare(unrelatedBaseline, after.diagnostics.map((d) => d.path)),
    };
    const engine = new AgentEnginePipeline(deps);

    const result = await engine.start(
      baseStartInput({
        request: {
          sessionId: "sess_repair_queue_2",
          mode: "agent",
          userMessage: "Add a type annotation to src/a.ts",
          workspace: { workspaceId: "ws_1" },
        },
        repositoryState: { reference: pinnedState, readiness: "ready" },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).not.toContain("repo_build_state_remaining_error_batch");
    expect(result.reasonCodes).not.toContain("mutation_rolled_back");
  });
});
