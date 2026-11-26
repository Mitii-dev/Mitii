import { describe, expect, it } from "vitest";

import {
  resumeCheckpointConflict,
  resumeClarification,
  resumeContinueDecision,
  resumePlanDecision,
} from "../../helpers/gates";

describe("resume handlers", () => {
  it("routes plan-scoped clarify to after_plan", () => {
    expect(
      resumeClarification({
        clarifyOrigin: "scope_fork",
        hasPlanDraft: true,
      }).reenter,
    ).toBe("after_plan");
  });

  it("replates on plan approve", () => {
    expect(resumePlanDecision({ decision: "approve" })).toMatchObject({
      reenter: "loop",
      replate: true,
    });
  });

  it("stops continue wall cleanly", () => {
    expect(resumeContinueDecision({ action: "stop" }).terminal).toBe(
      "continue_stopped",
    );
  });

  it("resyncs checkpoint conflict via orient", () => {
    expect(
      resumeCheckpointConflict({ action: "resync" }).reenter,
    ).toBe("orient");
  });
});
