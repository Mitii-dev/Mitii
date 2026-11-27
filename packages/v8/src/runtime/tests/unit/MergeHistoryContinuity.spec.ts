import { describe, expect, it } from "vitest";

import { mergeHistoryContinuity } from "../../helpers/continuity/MergeHistoryContinuity";

describe("mergeHistoryContinuity", () => {
  it("fills orphaned priorRoute and endingPosture from continuity", () => {
    const merged = mergeHistoryContinuity(
      { digest: "user: hi | assistant: drafts" },
      {
        priorRoute: "answer",
        endingPosture: "proposal_ready",
        priorTaskBand: "medium",
      },
    );
    expect(merged?.priorRoute).toBe("answer");
    expect(merged?.endingPosture).toBe("proposal_ready");
    expect(merged?.priorTaskBand).toBe("medium");
    expect(merged?.digest).toBe("user: hi | assistant: drafts");
  });

  it("does not overwrite host-provided continuity", () => {
    const merged = mergeHistoryContinuity(
      {
        priorRoute: "execute",
        endingPosture: "mutated",
      },
      {
        priorRoute: "answer",
        endingPosture: "proposal_ready",
      },
    );
    expect(merged?.priorRoute).toBe("execute");
    expect(merged?.endingPosture).toBe("mutated");
  });
});
