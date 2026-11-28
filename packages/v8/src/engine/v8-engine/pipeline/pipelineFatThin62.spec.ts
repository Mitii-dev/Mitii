import { describe, expect, it } from "vitest";

import { runDiscoverySeedAndShapedPreflight } from "./pinDiscoveryPreflight";
import { runDiscoveryPreflightSearch } from "./pinDiscoveryPreflightSearch";
import {
  maybeSeedFirstShapedFallback,
  preReadDiscoverySeeds,
} from "./pinDiscoveryPreflightReads";
import {
  applyRepoBuildStateComparisonReasonCodes,
  captureBuildStateFromVerificationResult,
  runVerificationGate,
} from "./verificationGate";
import { runVerificationGateChecks } from "./verificationGateRunChecks";
import { executeOneTool } from "./executeTool";
import { resolveExecuteToolCacheHit } from "./executeToolCacheHits";
import { tryVerificationRepairAttempt } from "./verificationFinishRepairAttempt";
import {
  buildVerificationRepairUserContent,
  loadRepairSourceLines,
} from "./verificationFinishRepairPrompt";
import { runV8ModelLoop } from "./modelLoop";
import {
  applyPreSettleStateToSession,
  snapshotPreSettleState,
} from "./modelLoopApplyPreSettle";
import {
  handleApprovalResume,
  handleClarificationResume,
  handlePlanApprovalResume,
} from "./executeResumeHandlers";

describe("pipeline fat thin 62", () => {
  it("exports pinDiscovery preflight search/read helpers", () => {
    expect(typeof runDiscoverySeedAndShapedPreflight).toBe("function");
    expect(typeof runDiscoveryPreflightSearch).toBe("function");
    expect(typeof preReadDiscoverySeeds).toBe("function");
    expect(typeof maybeSeedFirstShapedFallback).toBe("function");
  });

  it("exports verification gate build/run helpers", () => {
    expect(typeof runVerificationGate).toBe("function");
    expect(typeof runVerificationGateChecks).toBe("function");
    expect(typeof captureBuildStateFromVerificationResult).toBe("function");
    expect(typeof applyRepoBuildStateComparisonReasonCodes).toBe("function");
  });

  it("exports executeTool cache + repair prompt helpers", () => {
    expect(typeof executeOneTool).toBe("function");
    expect(typeof resolveExecuteToolCacheHit).toBe("function");
    expect(typeof tryVerificationRepairAttempt).toBe("function");
    expect(typeof buildVerificationRepairUserContent).toBe("function");
    expect(typeof loadRepairSourceLines).toBe("function");
  });

  it("exports modelLoop preSettle apply + resume handlers", () => {
    expect(typeof runV8ModelLoop).toBe("function");
    expect(typeof applyPreSettleStateToSession).toBe("function");
    expect(typeof snapshotPreSettleState).toBe("function");
    expect(typeof handleClarificationResume).toBe("function");
    expect(typeof handlePlanApprovalResume).toBe("function");
    expect(typeof handleApprovalResume).toBe("function");
  });
});
