import { describe, expect, it } from "vitest";

import { AGENT_ENGINE_SCHEMA_VERSION } from "../../../engine/v8-engine/legacy/constants";
import { EchoLlmPort } from "../../../modules/model-gateway";
import { composeAgentEngine } from "../../../engine/v8-engine/adapters/composeAgentEngine";
import {
  createAgentRunHandleFromRuntimeResult,
  mapRuntimeGateToSuspensionKind,
} from "../../adapters/bridge/AgentRunHandleFromRuntimeResult";
import { adaptEngineResumeToRuntime } from "../../adapters/bridge/AdaptEngineResumeToRuntime";

describe("runtime shell bridge", () => {
  it("maps mutation gate to approval_required", () => {
    expect(mapRuntimeGateToSuspensionKind("mutation_approval_required")).toBe(
      "approval_required",
    );
  });

  it("builds AgentRunHandle from suspended RuntimeRunResult", async () => {
    const handle = createAgentRunHandleFromRuntimeResult({
      schemaVersion: 1,
      runId: "bridge-1",
      status: "suspended",
      route: "clarify",
      gateKind: "clarification_required",
      reasonCodes: ["runtime_start_suspended"],
    });
    const result = await handle.result;
    expect(result.status).toBe("suspended");
    expect(result.suspension?.kind).toBe("clarification_required");
    expect(result.reasonCodes).toContain("clarification_suspended");
  });

  it("forwards hollow_plan clarifyOrigin onto suspension", async () => {
    const handle = createAgentRunHandleFromRuntimeResult({
      schemaVersion: 1,
      runId: "bridge-hollow",
      status: "suspended",
      route: "plan",
      gateKind: "clarification_required",
      clarificationPrompt: "Plan needed before building.",
      clarifyOrigin: "hollow_plan",
      reasonCodes: ["gate_clarify_hollow_plan", "runtime_start_plan_gate"],
    });
    const result = await handle.result;
    expect(result.suspension).toMatchObject({
      kind: "clarification_required",
      clarifyOrigin: "hollow_plan",
      clarificationPrompt: "Plan needed before building.",
    });
  });

  it("forwards taskList progress and nextAction on completed execute", async () => {
    const handle = createAgentRunHandleFromRuntimeResult({
      schemaVersion: 1,
      runId: "bridge-progress",
      status: "completed",
      route: "execute",
      answer: "HTTP slice landed.",
      taskList: {
        schemaVersion: 1,
        source: "plan",
        items: [
          { id: "t1", title: "HTTP", status: "done" },
          { id: "t2", title: "React cases", status: "pending" },
        ],
      },
      progress: {
        planCompletedCount: 1,
        planTotalCount: 2,
        doneCount: 1,
        pendingCount: 1,
        nextTitle: "React cases",
        openTitles: ["React cases"],
      },
      completedPlanStepIds: ["t1"],
      nextAction: {
        kind: "continue_checklist",
        prompt: "Continue with the next plan item: React cases",
      },
      reasonCodes: ["runtime_start_completed", "runtime_slice_next_action"],
    });
    const result = await handle.result;
    expect(result.taskList?.items).toHaveLength(2);
    expect(result.progress?.nextTitle).toBe("React cases");
    expect(result.completedPlanStepIds).toEqual(["t1"]);
    expect(result.nextAction).toMatchObject({
      kind: "continue_checklist",
      prompt: expect.stringContaining("React cases"),
    });
  });

  it("attaches pendingApproval onto suspension for mutation gates", async () => {
    const handle = createAgentRunHandleFromRuntimeResult({
      schemaVersion: 1,
      runId: "bridge-appr",
      status: "suspended",
      route: "execute",
      gateKind: "mutation_approval_required",
      pendingApproval: {
        approvalId: "appr_inv_1",
        fingerprint: "fp_delete",
        toolName: "delete_file",
        callId: "inv_1",
        paths: ["tsconfig.json"],
        arguments: { path: "tsconfig.json" },
        summary: "path=tsconfig.json",
      },
      reasonCodes: ["runtime_start_mutation_gate"],
    });
    const result = await handle.result;
    expect(result.status).toBe("suspended");
    expect(result.suspension?.kind).toBe("approval_required");
    expect(result.suspension?.approval).toMatchObject({
      approvalId: "appr_inv_1",
      toolName: "delete_file",
      callId: "inv_1",
      paths: ["tsconfig.json"],
    });
    expect(result.suspension?.rationale).toMatch(/delete_file/);
    expect(result.suspension?.rationale).toMatch(/tsconfig\.json/);
  });

  it("adaptEngineResumeToRuntime maps approval to mutation target", () => {
    const adapted = adaptEngineResumeToRuntime({
      input: {
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: "r1",
        approval: { approvalId: "a1", decision: "approved" },
      },
      fallbackMessage: "refactor packages/v8/src/runtime",
      mode: "agent",
    });
    expect(adapted).toMatchObject({
      decision: "approve",
      target: "mutation",
    });
  });

  it("adaptEngineResumeToRuntime keeps fallback message on clarify", () => {
    const adapted = adaptEngineResumeToRuntime({
      input: {
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: "r-clarify",
        clarificationAnswer: "go ahead",
      },
      fallbackMessage:
        "redesign HTTP checks and add React cases that prove it",
      mode: "agent",
    });
    expect(adapted.decision).toBe("clarify_answer");
    expect(adapted.clarifyAnswer).toBe("go ahead");
    expect(adapted.message).toContain("redesign HTTP checks");
    expect(adapted.message).not.toBe("go ahead");
  });

  it("preferRuntimeShell routes engine.start through runtime", async () => {
    const llm = new EchoLlmPort();
    const { engine, runtime } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
      preferRuntimeShell: true,
    });
    expect(runtime.stepIds[0]).toBe("1-window-policy");

    const handle = engine.start({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      request: {
        sessionId: "s1",
        mode: "ask",
        userMessage: "fix it",
        workspace: { workspaceId: "ws1" },
      },
    });
    const result = await handle.result;
    expect(result.status).toBe("suspended");
    expect(result.route).toBe("clarify");
    expect(result.suspension?.kind).toBe("clarification_required");
  });
});
