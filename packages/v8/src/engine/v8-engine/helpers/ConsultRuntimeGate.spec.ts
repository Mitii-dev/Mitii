import { describe, expect, it } from "vitest";

import { consultRuntimeGate, hubSuspendKind } from "./ConsultRuntimeGate";

describe("ConsultRuntimeGate (S10-EVAC)", () => {
  it("after_decide suspends for clarify disposition", () => {
    const verdict = consultRuntimeGate("after_decide", {
      runId: "e1",
      route: "clarify",
      runDisposition: "clarification_required",
    });
    expect(verdict).toMatchObject({
      action: "suspend",
      kind: "clarification_required",
    });
    expect(hubSuspendKind(verdict, "clarification_required")).toBe(
      "clarification_required",
    );
  });

  it("after_plan suspends for scope fork flags", () => {
    const verdict = consultRuntimeGate("after_plan", {
      runId: "e2",
      mode: "plan",
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

  it("after_plan suspends for plan approval", () => {
    const verdict = consultRuntimeGate("after_plan", {
      runId: "e3",
      mode: "agent",
      route: "execute",
      planningDepth: "visible",
      planGate: "required_before_execute",
    });
    expect(verdict).toMatchObject({
      action: "suspend",
      kind: "plan_approval_required",
    });
  });

  it("after_tool suspends for mutation approval", () => {
    const verdict = consultRuntimeGate("after_tool", {
      runId: "e4",
      needsMutationApproval: true,
    });
    expect(verdict).toMatchObject({
      action: "suspend",
      kind: "mutation_approval_required",
    });
  });

  it("after_tool suspends for grant expansion", () => {
    const verdict = consultRuntimeGate("after_tool", {
      runId: "e5",
      needsGrantExpansion: true,
    });
    expect(verdict).toMatchObject({
      action: "suspend",
      kind: "grant_expansion_required",
    });
  });

  it("on_budget suspends for hard wall", () => {
    const verdict = consultRuntimeGate("on_budget", {
      runId: "e6",
      budgetHardWall: true,
    });
    expect(verdict).toMatchObject({
      action: "suspend",
      kind: "continue_required",
    });
  });

  it("hubSuspendKind falls back when verdict missing", () => {
    expect(hubSuspendKind(undefined, "continue_required")).toBe(
      "continue_required",
    );
  });
});
