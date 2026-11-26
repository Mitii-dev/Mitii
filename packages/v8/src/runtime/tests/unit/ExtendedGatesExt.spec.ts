import { describe, expect, it } from "vitest";

import { evaluateGates } from "../../helpers/gates";
import {
  resumeAuthOrDependency,
  resumeCheckpointConflict,
  resumeExternalSideEffect,
} from "../../helpers/gates";
import { runtimeResumeInputSchema } from "../../contracts/input/RuntimeResumeInput";

describe("S10-EXT kinds", () => {
  it("EXTERNAL suspends after_tool when extended + flagged", () => {
    const verdict = evaluateGates("after_tool", {
      phase: "after_tool",
      runId: "r1",
      enableExtendedGates: true,
      needsExternalSideEffectApproval: true,
    });
    expect(verdict?.kind).toBe("external_side_effect_required");
  });

  it("DESTRUCT promotes when extended + destructive", () => {
    const verdict = evaluateGates("after_tool", {
      phase: "after_tool",
      runId: "r1",
      enableExtendedGates: true,
      needsDestructiveApproval: true,
      needsMutationApproval: true,
    });
    expect(verdict?.kind).toBe("destructive_action_required");
    expect(verdict?.payload).toEqual({ approvalClass: "destructive" });
  });

  it("DESTRUCT stamps approvalClass on mutation when extended off", () => {
    const verdict = evaluateGates("after_tool", {
      phase: "after_tool",
      runId: "r1",
      needsDestructiveApproval: true,
      needsMutationApproval: true,
    });
    expect(verdict?.kind).toBe("mutation_approval_required");
    expect(verdict?.payload).toEqual({ approvalClass: "destructive" });
  });

  it("CONFLICT suspends on_resume when flagged", () => {
    const verdict = evaluateGates("on_resume", {
      phase: "on_resume",
      runId: "r1",
      checkpointConflict: true,
    });
    expect(verdict?.kind).toBe("checkpoint_conflict_required");
  });

  it("resume helpers map conflict / external / auth", () => {
    expect(resumeCheckpointConflict({ action: "resync" }).reenter).toBe(
      "orient",
    );
    expect(resumeCheckpointConflict({ action: "cancel" }).terminal).toBe(
      "cancelled",
    );
    expect(resumeExternalSideEffect({ approved: true }).replayTool).toBe(true);
    expect(resumeExternalSideEffect({ approved: false }).terminal).toBe(
      "cancelled",
    );
    expect(resumeAuthOrDependency({ action: "connected" }).replayTool).toBe(
      true,
    );
  });

  it("resume input accepts conflict/external/destructive/auth targets", () => {
    const parsed = runtimeResumeInputSchema.parse({
      runId: "r1",
      decision: "approve",
      target: "conflict",
      conflictAction: "force",
    });
    expect(parsed.target).toBe("conflict");
    expect(parsed.conflictAction).toBe("force");

    expect(
      runtimeResumeInputSchema.parse({
        runId: "r1",
        decision: "approve",
        target: "external",
      }).target,
    ).toBe("external");

    expect(
      runtimeResumeInputSchema.parse({
        runId: "r1",
        decision: "approve",
        target: "auth",
        authAction: "skip_fallback",
      }).authAction,
    ).toBe("skip_fallback");
  });
});
