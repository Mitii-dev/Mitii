import { describe, expect, it } from "vitest";

import { advanceAfterToolSettle } from "./advanceAfterToolSettle";
import { applyAfterToolSettleDiagnoseRails } from "./advanceAfterToolSettleDiagnose";
import { applyAfterToolSettleMutateRails } from "./advanceAfterToolSettleMutateRails";
import {
  batchNeedsWorkspaceTools,
  settleToolsPreflightFailure,
} from "./settleToolsPreflight";
import { rejectMutateLockBlockedTool } from "./settleToolsMutateLockReject";

describe("advanceAfterToolSettle + settleTools thin", () => {
  it("exports after-settle rail helpers", () => {
    expect(typeof advanceAfterToolSettle).toBe("function");
    expect(typeof applyAfterToolSettleMutateRails).toBe("function");
    expect(typeof applyAfterToolSettleDiagnoseRails).toBe("function");
  });

  it("exports settleTools preflight + mutate-lock helpers", () => {
    expect(typeof batchNeedsWorkspaceTools).toBe("function");
    expect(typeof settleToolsPreflightFailure).toBe("function");
    expect(typeof rejectMutateLockBlockedTool).toBe("function");
  });

  it("batchNeedsWorkspaceTools ignores update_todos-only batches", () => {
    expect(
      batchNeedsWorkspaceTools([{ id: "1", name: "update_todos", arguments: "{}" }]),
    ).toBe(false);
    expect(
      batchNeedsWorkspaceTools([{ id: "1", name: "read_file", arguments: "{}" }]),
    ).toBe(true);
  });
});
