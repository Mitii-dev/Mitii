import { describe, expect, it } from "vitest";

import { runDiscoveryPass } from "./pinDiscoveryPass";
import { setupDiscoveryPass } from "./pinDiscoveryPassSetup";
import { finishDiscoveryPass } from "./pinDiscoveryPassFinish";
import { settleToolBatch } from "./settleTools";
import { finalizeSettledToolBatch } from "./settleToolsFinalize";
import { runModelLoopModelTurn } from "./runModelLoopModelTurn";
import { prepareModelLoopModelTurn } from "./runModelLoopModelTurnPrepare";
import { tryVerificationRepairAttempt } from "./verificationFinishRepairAttempt";
import { runVerificationRepairLoop } from "./verificationFinishRepairRun";
import {
  applySucceededToolSideEffects,
  approvalRequiredOutcome,
} from "./executeToolFinishPostSuccess";
import { maybeAutoAdvanceAfterSucceededTool } from "./executeToolFinishAutoAdvance";
import { prepareModelLoopTurn } from "./prepareModelLoopTurn";
import { clampTurnOutput } from "./prepareModelLoopTurnClamp";

describe("pipeline fat thin 63", () => {
  it("exports pinDiscovery setup/finish helpers", () => {
    expect(typeof runDiscoveryPass).toBe("function");
    expect(typeof setupDiscoveryPass).toBe("function");
    expect(typeof finishDiscoveryPass).toBe("function");
  });

  it("exports settle finalize + model-turn prepare", () => {
    expect(typeof settleToolBatch).toBe("function");
    expect(typeof finalizeSettledToolBatch).toBe("function");
    expect(typeof runModelLoopModelTurn).toBe("function");
    expect(typeof prepareModelLoopModelTurn).toBe("function");
  });

  it("exports repair run + tool auto-advance + turn clamp", () => {
    expect(typeof tryVerificationRepairAttempt).toBe("function");
    expect(typeof runVerificationRepairLoop).toBe("function");
    expect(typeof applySucceededToolSideEffects).toBe("function");
    expect(typeof approvalRequiredOutcome).toBe("function");
    expect(typeof maybeAutoAdvanceAfterSucceededTool).toBe("function");
    expect(typeof prepareModelLoopTurn).toBe("function");
    expect(typeof clampTurnOutput).toBe("function");
  });
});
