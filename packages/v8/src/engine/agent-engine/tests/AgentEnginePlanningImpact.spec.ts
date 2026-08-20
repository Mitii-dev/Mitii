import { describe, expect, it } from "vitest";

import { AgentEnginePipeline } from "..";
import type { AgentEngineDependencies } from "../contracts";
import {
  PLANNING_SCHEMA_VERSION,
  type PlanArtifact,
  type PlanningInput,
} from "../../../modules/planning";
import type {
  RepoGraph,
  RepoGraphEdge,
  RepoGraphFileNode,
} from "../../../modules/repository-state";
import type { RepoBuildState } from "../../../modules/verification";
import {
  createCapabilities,
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  createUnderstanding,
  ScriptedLlmPort,
} from "./fixtures/stubs";

function planStartInput(userMessage: string) {
  return {
    schemaVersion: 1 as const,
    request: {
      sessionId: "sess_1",
      mode: "plan" as const,
      userMessage,
      workspace: { workspaceId: "ws_1" },
    },
    workspaceRoot: "/repo",
  };
}

function executionPlan(file: string): PlanArtifact {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective: "Fix session type error",
    assumptions: [],
    openQuestions: [],
    contextReviewed: [{ kind: "file", ref: file }],
    constraints: [],
    dimensions: {
      scope: "module",
      risk: "low",
      clarity: "clear",
      complexity: "simple",
      changeImpact: ["code"],
    },
    phases: [
      {
        id: "phase-change",
        name: "Change",
        purpose: "Apply the change",
        steps: [
          {
            id: "step-1",
            intent: `Fix TS2322 in ${file}`,
            targetRefs: [file],
            actionSummary: `Edit ${file}`,
            expectedOutcome: "Requested behavior is implemented.",
            riskLevel: "low",
          },
        ],
        dependencies: [],
        successCriteria: ["File change is applied"],
      },
    ],
    risks: [],
    alternatives: [],
    verification: { checks: [], manualQa: [], commands: [] },
    approvalRequired: false,
    processHintsApplied: [],
  };
}

function repoBuildState(path: string): RepoBuildState {
  return {
    schemaVersion: 1,
    capturedAt: "2026-07-25T12:00:00.000Z",
    phase: "before",
    scope: {
      workspaceRoot: "/repo",
      folderPrefixes: [],
      projectIds: [],
      changeScope: "localized",
    },
    checks: [],
    diagnostics: [
      {
        path,
        severity: "error",
        message: "Type 'string' is not assignable to type 'Session'.",
        startLine: 12,
        source: "tsc",
        code: "TS2322",
      },
    ],
    summary: {
      errorCount: 1,
      warningCount: 0,
      failedCheckIds: [],
    },
    reasonCodes: [],
  };
}

function followEvidenceDeps(params: {
  captured: { current?: PlanningInput };
  repoGraphs?: AgentEngineDependencies["repoGraphs"];
}) {
  const plan = executionPlan("src/auth/session.ts");
  return createStubDependencies({
    decision: createDecision({
      route: "plan",
      planningDepth: "visible",
      planGate: "none",
      repositoryContextRequired: false,
      toolGrant: createReadOnlyGrant(),
      reasonCodes: ["mode_plan_only", "preflight_build_recommended"],
      pinnedState: { workspaceId: "ws_1", stateToken: "state_1" },
    }),
    understanding: createUnderstanding({
      intent: {
        ...createUnderstanding().intent,
        classification: {
          ...createUnderstanding().intent.classification,
          primaryTaskIntent: "bugfix",
        },
      },
      taskAnalysis: {
        ...createUnderstanding().taskAnalysis,
        scope: "module",
        complexity: "moderate",
        targets: [
          { kind: "file", value: "src/auth/session.ts", explicit: true },
        ],
      },
    }),
    verification: {
      verify: async () => {
        throw new Error("verify() should not run for Plan mode.");
      },
      captureBuildState: async () => repoBuildState("src/auth/session.ts"),
    },
    planning: {
      plan: async (input) => {
        params.captured.current = input;
        return {
          schemaVersion: PLANNING_SCHEMA_VERSION,
          status: "validated",
          plan,
          warnings: [],
          reasonCodes: ["plan_drafted"],
          usedTokens: 10,
          budgetTokens: 1_200,
          durationMs: 1,
          strategy: {
            schemaVersion: 1,
            strategy: "follow_evidence",
            rationale: "follow_evidence selected for the test.",
            skipDiscover: true,
            useBuildEvidence: true,
          },
        };
      },
    },
    ...(params.repoGraphs ? { repoGraphs: params.repoGraphs } : {}),
  });
}

describe("AgentEngine follow_evidence impact reports", () => {
  it("omits impact reports when repoGraphs is not injected", async () => {
    const captured: { current?: PlanningInput } = {};
    const engine = new AgentEnginePipeline(followEvidenceDeps({ captured }));
    const handle = engine.start({
      ...planStartInput("Fix the type error in src/auth/session.ts"),
      repositoryState: {
        reference: { workspaceId: "ws_1", stateToken: "state_1" },
        readiness: "ready",
      },
    });
    for await (const _event of handle.events) {
      // drain
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(captured.current?.strategyOverride?.strategy).toBe("follow_evidence");
    expect(captured.current?.impactReports).toBeUndefined();
  });

  it("passes hop-1 mustRead and affected paths into planning", async () => {
    const captured: { current?: PlanningInput } = {};
    const engine = new AgentEnginePipeline(
      followEvidenceDeps({
        captured,
        repoGraphs: {
          loadGraphs: async () => [createSessionGraph()],
        },
      }),
    );
    const handle = engine.start({
      ...planStartInput("Fix the type error in src/auth/session.ts"),
      repositoryState: {
        reference: { workspaceId: "ws_1", stateToken: "state_1" },
        readiness: "ready",
      },
    });
    for await (const _event of handle.events) {
      // drain
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(captured.current?.impactReports).toEqual([
      {
        seedPath: "src/auth/session.ts",
        mustRead: ["src/auth/types.ts"],
        affected: ["src/auth/Login.ts"],
      },
    ]);
  });

  it("skips reports when the published graph is stale", async () => {
    const captured: { current?: PlanningInput } = {};
    const engine = new AgentEnginePipeline(
      followEvidenceDeps({
        captured,
        repoGraphs: {
          loadGraphs: async () => [createSessionGraph()],
          expectedCodeIndexChangeToken: async () => "newer-token",
        },
      }),
    );
    const handle = engine.start({
      ...planStartInput("Fix the type error in src/auth/session.ts"),
      repositoryState: {
        reference: { workspaceId: "ws_1", stateToken: "state_1" },
        readiness: "ready",
      },
    });
    for await (const _event of handle.events) {
      // drain
    }
    await handle.result;

    expect(captured.current?.impactReports).toBeUndefined();
  });
});

describe("AgentEngine discover_and_plan impact reports", () => {
  it("passes hop-1 reports seeded from discovery surfaces", async () => {
    const captured: { current?: PlanningInput } = {};
    const llm = new ScriptedLlmPort(
      [
        {
          content: "",
          toolCalls: [
            {
              id: "read_1",
              name: "read_file",
              arguments: JSON.stringify({ path: "src/auth/session.ts" }),
            },
          ],
        },
        { content: "Found the session type error surface." },
      ],
      createCapabilities({ supportsTools: true }),
    );
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "plan",
          planningDepth: "visible",
          planGate: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mode_plan_only"],
        }),
        understanding: createUnderstanding({
          taskAnalysis: {
            ...createUnderstanding().taskAnalysis,
            scope: "multi_file",
            complexity: "complex",
            recommendsPlanning: true,
            targets: [
              { kind: "folder", value: "src/auth", explicit: true },
            ],
          },
        }),
        llm,
        planning: {
          plan: async (input) => {
            captured.current = input;
            return {
              schemaVersion: PLANNING_SCHEMA_VERSION,
              status: "validated",
              plan: executionPlan("src/auth/session.ts"),
              warnings: [],
              reasonCodes: ["plan_drafted", "plan_discovery_applied"],
              usedTokens: 20,
              budgetTokens: 1_200,
              durationMs: 1,
              strategy: {
                schemaVersion: 1,
                strategy: "discover_and_plan",
                rationale: "discover_and_plan selected for the test.",
                skipDiscover: true,
                useBuildEvidence: false,
              },
            };
          },
        },
        repoGraphs: {
          loadGraphs: async () => [createSessionGraph()],
        },
      }),
    );

    const handle = engine.start({
      ...planStartInput(
        "Add retries around the session helper without changing the public API.",
      ),
    });
    for await (const _event of handle.events) {
      // drain
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(captured.current?.strategyOverride?.strategy).toBe("discover_and_plan");
    expect(captured.current?.impactReports).toEqual([
      {
        seedPath: "src/auth/session.ts",
        mustRead: ["src/auth/types.ts"],
        affected: ["src/auth/Login.ts"],
      },
    ]);
  });
});

function createSessionGraph(): RepoGraph {
  const files: RepoGraphFileNode[] = [
    fileNode("file:types", "src/auth/types.ts"),
    fileNode("file:session", "src/auth/session.ts"),
    fileNode("file:login", "src/auth/Login.ts"),
  ];
  const edges: RepoGraphEdge[] = [
    edge("e1", "imports", "file:session", "file:types", 4, 2),
    edge("e2", "imports", "file:login", "file:session", 3, 1),
  ];
  return {
    schemaVersion: 1,
    workspaceSnapshotId: "snapshot-1",
    codeIndexChangeToken: "token-1",
    nodes: files,
    edges,
    warnings: [],
    statistics: {
      availableFiles: files.length,
      indexedFiles: files.length,
      projectNodes: 0,
      fileNodes: files.length,
      symbolNodes: 0,
      containsEdges: 0,
      declaresEdges: 0,
      importEdges: 2,
      callEdges: 0,
      referenceEdges: 0,
      projectRelationshipEdges: 0,
      unresolvedImports: 0,
      omittedImportTargets: 0,
      ambiguousReferences: 0,
      unresolvedReferences: 0,
      omittedReferenceTargets: 0,
      omittedParentSymbolTargets: 0,
      truncatedSymbolFiles: 0,
      droppedSymbolNodes: 0,
      droppedEdges: 0,
      consistencyRetries: 0,
      durationMs: 1,
    },
    status: "complete",
    generatedAt: "2026-07-25T12:00:00.000Z",
  };
}

function fileNode(id: string, relativePath: string): RepoGraphFileNode {
  return {
    id,
    kind: "file",
    fileId: id,
    rootId: "workspace",
    relativePath,
  };
}

function edge(
  id: string,
  type: RepoGraphEdge["type"],
  fromNodeId: string,
  toNodeId: string,
  weight: number,
  line: number,
): RepoGraphEdge {
  return {
    id,
    type,
    fromNodeId,
    toNodeId,
    weight,
    evidenceCount: 1,
    evidence: [
      {
        source: "code_index_reference",
        detail: `${fromNodeId} ${type} ${toNodeId}`,
        line,
      },
    ],
    evidenceTruncated: false,
  };
}
