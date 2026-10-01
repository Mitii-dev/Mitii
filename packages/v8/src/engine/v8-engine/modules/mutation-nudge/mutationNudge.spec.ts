import { describe, expect, it } from "vitest";

import {
  softMutationNudgeMessage,
  requiresMutation,
  batchIsReadonlyTools,
  hasPlanDraftedThisRun,
  resolveReadonlyTurnsBeforeMutationNudge,
  shouldEscalateReadonlyThrashToContinue,
  readonlyThrashPartialAnswer,
} from "./index";
import { createDecision, createReadOnlyGrant } from "../../tests/fixtures/stubs";

describe("mutationNudge", () => {
  it("detects execute+write as requiring mutation", () => {
    expect(
      requiresMutation(
        createDecision({
          route: "execute",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch"],
            allowedEffects: ["workspace_write"],
          }),
        }),
      ),
    ).toBe(true);
    expect(requiresMutation(createDecision({ route: "direct_answer" }))).toBe(
      false,
    );
  });

  it("classifies readonly batches", () => {
    expect(
      batchIsReadonlyTools([
        { id: "1", name: "read_file", arguments: "{}" },
        { id: "2", name: "search_files", arguments: "{}" },
      ]),
    ).toBe(true);
    expect(
      batchIsReadonlyTools([
        { id: "1", name: "apply_patch", arguments: "{}" },
      ]),
    ).toBe(false);
  });

  it("builds a soft mutation nudge that refuses to claim edits are done", () => {
    const message = softMutationNudgeMessage(4, { hasPlan: true });
    expect(message).toContain("4 read-only");
    expect(message).toContain("apply_patch");
    expect(message).toMatch(/NOT done/i);
    expect(message.toLowerCase()).not.toContain("evidence");
    expect(message).toMatch(/plan\/checklist/i);
  });

  it("uses a tighter readonly threshold after a plan is drafted", () => {
    expect(
      hasPlanDraftedThisRun({
        planningDepth: "visible",
        reasonCodes: [],
      }),
    ).toBe(true);
    expect(
      hasPlanDraftedThisRun({
        planningDepth: "none",
        reasonCodes: ["officer_task_size_plan", "plan_drafted"],
      }),
    ).toBe(true);
    expect(
      hasPlanDraftedThisRun({
        planningDepth: "none",
        reasonCodes: ["run_started"],
      }),
    ).toBe(false);

    expect(
      resolveReadonlyTurnsBeforeMutationNudge({
        hasPlan: true,
        maxReadOnlyTurnsBeforeMutationNudge: 12,
        maxReadOnlyTurnsBeforeMutationNudgeAfterPlan: 4,
      }),
    ).toBe(4);
    expect(
      resolveReadonlyTurnsBeforeMutationNudge({
        hasPlan: false,
        maxReadOnlyTurnsBeforeMutationNudge: 12,
        maxReadOnlyTurnsBeforeMutationNudgeAfterPlan: 4,
      }),
    ).toBe(12);
  });

  it("escalates to Continue after soft nudge budget without claiming done", () => {
    expect(
      shouldEscalateReadonlyThrashToContinue({
        softMutationNudges: 2,
        maxSoftMutationNudgesBeforeContinue: 2,
        changedFileCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldEscalateReadonlyThrashToContinue({
        softMutationNudges: 1,
        maxSoftMutationNudgesBeforeContinue: 2,
        changedFileCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldEscalateReadonlyThrashToContinue({
        softMutationNudges: 5,
        maxSoftMutationNudgesBeforeContinue: 2,
        changedFileCount: 3,
      }),
    ).toBe(false);

    const partial = readonlyThrashPartialAnswer({
      hasPlan: true,
      fileReadCalls: 46,
    });
    expect(partial).toMatch(/no workspace edits have been applied/i);
    expect(partial.toLowerCase()).not.toMatch(
      /mutations? (are|were) done|edits (are|were) complete|finished successfully/,
    );
  });
});
