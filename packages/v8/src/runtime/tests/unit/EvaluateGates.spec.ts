import { describe, expect, it } from "vitest";

import { applyGate, evaluateGates } from "../../helpers/gates";

describe("evaluateGates", () => {
  it("after_decide suspends for clarify route", () => {
    const verdict = evaluateGates("after_decide", {
      runId: "r1",
      route: "clarify",
    });
    expect(verdict).toMatchObject({
      action: "suspend",
      kind: "clarification_required",
    });
  });

  it("after_plan completes for plan mode", () => {
    const verdict = evaluateGates("after_plan", {
      runId: "r1",
      mode: "plan",
      route: "plan",
    });
    expect(verdict).toMatchObject({
      action: "complete",
      terminal: "plan_ready_complete",
    });
  });

  it("after_plan requires approval for agent visible execute with ready plan", () => {
    const verdict = evaluateGates("after_plan", {
      runId: "r1",
      mode: "agent",
      route: "execute",
      planningDepth: "visible",
      planGate: "required_before_execute",
      hasReadyPlan: true,
    });
    expect(verdict).toMatchObject({
      action: "suspend",
      kind: "plan_approval_required",
    });
  });

  it("after_plan does not approve empty plan without ready artifact", () => {
    const verdict = evaluateGates("after_plan", {
      runId: "r1",
      mode: "agent",
      route: "execute",
      planningDepth: "visible",
      planGate: "required_before_execute",
      hasReadyPlan: false,
    });
    expect(verdict?.kind).not.toBe("plan_approval_required");
  });

  it("after_plan prefers scope_fork clarify over plan approval", () => {
    const verdict = evaluateGates("after_plan", {
      runId: "r1",
      mode: "plan",
      route: "plan",
      planStrategy: "clarify",
      hasClarifyDraft: true,
      scopeChoiceResolved: false,
      qualityFloor: true,
    });
    expect(verdict).toMatchObject({
      action: "suspend",
      kind: "clarification_required",
      payload: { clarifyOrigin: "scope_fork" },
    });
  });

  it("after_plan suspends for hollow plan", () => {
    const verdict = evaluateGates("after_plan", {
      runId: "r1",
      mode: "agent",
      hollowPlan: true,
    });
    expect(verdict).toMatchObject({
      action: "suspend",
      kind: "clarification_required",
      payload: { clarifyOrigin: "hollow_plan" },
    });
    expect(verdict?.reasonCodes).toContain("gate_clarify_hollow_plan");
  });

  it("on_budget raises provider continue", () => {
    const verdict = evaluateGates("on_budget", {
      runId: "r1",
      providerUnavailable: true,
    });
    expect(verdict).toMatchObject({
      kind: "continue_required",
      payload: { continueReason: "provider_unavailable" },
    });
  });
});

describe("applyGate", () => {
  it("saves checkpoint on suspend when store provided", async () => {
    const saved: unknown[] = [];
    const result = await applyGate(
      {
        action: "suspend",
        kind: "continue_required",
        payload: { continueReason: "budget_exhausted" },
        reasonCodes: ["t"],
      },
      { runId: "r1", requestId: "q1" },
      {
        checkpointStore: {
          save: async (cp) => {
            saved.push(cp);
          },
        },
        nowMs: () => 42,
      },
    );
    expect(result.status).toBe("suspended");
    expect(result.checkpointSaved).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      runId: "r1",
      suspensionKind: "continue_required",
      suspendedAtMs: 42,
    });
  });

  it("does not save checkpoint on complete", async () => {
    const result = await applyGate(
      {
        action: "complete",
        terminal: "plan_ready_complete",
        payload: {},
        reasonCodes: [],
      },
      { runId: "r1", requestId: "q1" },
      {
        checkpointStore: {
          save: async () => {
            throw new Error("should not save");
          },
        },
      },
    );
    expect(result).toMatchObject({
      status: "completed",
      checkpointSaved: false,
      terminal: "plan_ready_complete",
    });
  });
});
