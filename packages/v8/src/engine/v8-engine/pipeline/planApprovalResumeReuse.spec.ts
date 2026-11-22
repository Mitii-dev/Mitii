import { describe, expect, it } from "vitest";

import { PLANNING_SCHEMA_VERSION, type PlanArtifact } from "../../../modules/planning";
import { InMemoryRunCheckpointStore } from "../adapters/InMemoryRunCheckpointStore";
import { agentEngineStartInputSchema } from "../contracts";
import type { AgentRunCheckpoint } from "../internal/RunCheckpoint";
import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  createUnderstanding,
  ScriptedLlmPort,
} from "../tests/fixtures/stubs";
import { V8EnginePipeline } from "./V8EnginePipeline";
import {
  PLAN_GATE_AUTO_APPROVED_WARNING,
  noteAutoApprovedPlanGate,
  resolveEffectivePlanApproval,
} from "./planGatePolicy";

const plan: PlanArtifact = {
  schemaVersion: PLANNING_SCHEMA_VERSION,
  objective: "Fix src/auth/login.ts",
  assumptions: [],
  openQuestions: [],
  contextReviewed: [],
  constraints: [],
  dimensions: {
    scope: "file",
    risk: "low",
    clarity: "clear",
    complexity: "simple",
    changeImpact: ["code"],
  },
  phases: [
    {
      id: "phase-change",
      name: "Change",
      purpose: "Apply the fix",
      steps: [
        {
          id: "s1",
          intent: "Edit src/auth/login.ts",
          targetRefs: ["src/auth/login.ts"],
          actionSummary: "Edit login",
          expectedOutcome: "Login fixed",
          riskLevel: "low",
        },
      ],
      dependencies: [],
      successCriteria: ["Typecheck passes"],
    },
  ],
  risks: [],
  alternatives: [],
  verification: { checks: [], manualQa: [], commands: [] },
  approvalRequired: true,
  processHintsApplied: [],
};

const decision = createDecision({
  route: "execute",
  planningDepth: "visible",
  toolGrant: createReadOnlyGrant({
    maximumWorkspaceEffect: "write",
    allowedTools: ["apply_patch"],
    allowedEffects: ["workspace_write"],
    approvalMode: "never",
  }),
  reasonCodes: ["mutation_execute"],
});

function startInput() {
  return agentEngineStartInputSchema.parse({
    schemaVersion: 1,
    workspaceRoot: "/repo",
    request: {
      sessionId: "sess_reuse",
      mode: "agent",
      userMessage: "Fix src/auth/login.ts",
      workspace: { workspaceId: "ws_reuse" },
      requestId: "req_reuse",
    },
  });
}

function checkpoint(withUnderstanding: boolean): AgentRunCheckpoint {
  return {
    runId: "run_reuse",
    requestId: "req_reuse",
    suspensionKind: "plan_approval_required",
    input: startInput(),
    decision,
    messages: [],
    toolCacheEntries: [],
    plan,
    changedFiles: [],
    mutationCheckpointIds: [],
    reasonCodes: ["run_started", "plan_approval_suspended"],
    warnings: [],
    usage: { modelCalls: 0, toolCalls: 0, loopIterations: 0 },
    startedAtMs: Date.now(),
    ...(withUnderstanding ? { understanding: createUnderstanding() } : {}),
  };
}

async function resumeWith(withUnderstanding: boolean) {
  const store = new InMemoryRunCheckpointStore();
  await store.save(checkpoint(withUnderstanding));
  let understandCalls = 0;
  let decideCalls = 0;
  const deps = createStubDependencies({
    checkpointStore: store,
    decision,
    llm: new ScriptedLlmPort([
      {
        content: "Applying.",
        toolCalls: [
          {
            id: "call_patch",
            name: "apply_patch",
            arguments: JSON.stringify({
              patches: [
                { path: "src/auth/login.ts", oldText: "a", newText: "b" },
              ],
            }),
          },
        ],
      },
      { content: "Patched login.ts." },
    ]),
    toolResults: {
      apply_patch: {
        status: "succeeded",
        output: {
          checkpointId: "cp_reuse",
          changedFiles: ["src/auth/login.ts"],
        },
      },
    },
  });
  const understanding = createUnderstanding();
  (deps.understanding as { understand: unknown }).understand = async () => {
    understandCalls += 1;
    return understanding;
  };
  (deps.decision as { decide: unknown }).decide = () => {
    decideCalls += 1;
    return decision;
  };
  const result = await new V8EnginePipeline(deps).resume({
    schemaVersion: 1,
    runId: "run_reuse",
    planDecision: { decision: "approved" },
  }).result;
  return { result, understandCalls, decideCalls };
}

describe("plan approval resume reuses startup state", () => {
  it("does not re-run understanding or decision when the checkpoint carries them", async () => {
    const { result, understandCalls, decideCalls } = await resumeWith(true);
    expect(understandCalls).toBe(0);
    expect(decideCalls).toBe(0);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("resume_state_reused");
    expect(result.reasonCodes).toContain("plan_approved");
  });

  it("falls back to full startup for legacy checkpoints without understanding", async () => {
    const { result, understandCalls, decideCalls } = await resumeWith(false);
    expect(understandCalls).toBe(1);
    expect(decideCalls).toBe(1);
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).not.toContain("resume_state_reused");
  });
});

describe("plan gate policy", () => {
  it("treats approvalMode never as plan auto-approval unless planApproval is explicit", () => {
    expect(resolveEffectivePlanApproval({ approvalMode: "never" })).toBe("never");
    expect(
      resolveEffectivePlanApproval({
        approvalMode: "never",
        planApproval: "policy",
      }),
    ).toBe("policy");
    expect(
      resolveEffectivePlanApproval({ approvalMode: "when_required" }),
    ).toBeUndefined();
    expect(resolveEffectivePlanApproval({})).toBeUndefined();
  });

  it("notes auto-approval only when policy suppressed a required gate", () => {
    const emitted: unknown[] = [];
    const runtime = {
      emit: (_bus: unknown, event: unknown) => emitted.push(event),
      isoNow: () => "2026-01-01T00:00:00.000Z",
    } as never;
    const warnings: string[] = [];
    noteAutoApprovedPlanGate(runtime, {
      runId: "r",
      bus: {} as never,
      warnings,
      decision: createDecision({
        planningDepth: "visible",
        reasonCodes: ["plan_gate_suppressed_by_policy"],
      }),
    });
    expect(warnings).toEqual([PLAN_GATE_AUTO_APPROVED_WARNING]);
    expect(PLAN_GATE_AUTO_APPROVED_WARNING).not.toMatch(/was skipped/);
    expect(emitted).toHaveLength(1);

    noteAutoApprovedPlanGate(runtime, {
      runId: "r",
      bus: {} as never,
      warnings,
      decision: createDecision({ planningDepth: "visible" }),
    });
    expect(warnings).toHaveLength(1);
  });
});
