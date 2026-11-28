import { describe, expect, it } from "vitest";

import { finishAfterLoop } from "./verificationFinish";
import { finishIfNonCompletedOutcome } from "./verificationFinishEarlyOutcomes";
import { runCompletedVerificationPass } from "./verificationFinishCompletedPass";
import { handleVerificationFailed } from "./verificationFinishFailed";
import { tryVerificationRepairAttempt } from "./verificationFinishRepairAttempt";
import { finishFailedVerificationTerminal } from "./verificationFinishFailedTerminal";
import {
  applyVerificationAcceptSideEffects,
  commitMutations,
  persistVerificationArtifact,
  summarizeVerificationForUser,
} from "./verificationArtifacts";
import { prepareModelLoopTurn } from "./prepareModelLoopTurn";
import { prepareModelLoopCompaction } from "./prepareModelLoopCompaction";

describe("verificationFinish + artifacts + prepareTurn thin", () => {
  it("exports finish-after-loop helpers", () => {
    expect(typeof finishAfterLoop).toBe("function");
    expect(typeof finishIfNonCompletedOutcome).toBe("function");
    expect(typeof runCompletedVerificationPass).toBe("function");
    expect(typeof handleVerificationFailed).toBe("function");
    expect(typeof tryVerificationRepairAttempt).toBe("function");
    expect(typeof finishFailedVerificationTerminal).toBe("function");
  });

  it("exports verification artifact helpers", () => {
    expect(typeof applyVerificationAcceptSideEffects).toBe("function");
    expect(typeof commitMutations).toBe("function");
    expect(typeof persistVerificationArtifact).toBe("function");
    expect(typeof summarizeVerificationForUser).toBe("function");
  });

  it("exports prepareModelLoopTurn + compaction", () => {
    expect(typeof prepareModelLoopTurn).toBe("function");
    expect(typeof prepareModelLoopCompaction).toBe("function");
  });
});
