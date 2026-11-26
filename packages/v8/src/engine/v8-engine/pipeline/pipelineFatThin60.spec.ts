import { describe, expect, it } from "vitest";

import { settleToolBatch } from "./settleTools";
import { settleOneToolCall } from "./settleToolsOneCall";
import { applyPreSettleTruncationRails } from "./handlePreSettleTruncationRails";
import { applyReasoningAbortMutatePressure } from "./handlePreSettleReasoningMutate";
import { runDiscoveryPass } from "./pinDiscoveryPass";
import { buildPinDiscoveryPassMessages } from "./pinDiscoveryPassMessages";
import { runLiveEnrichmentPlanning } from "./enrichmentPlanningDiscover";
import { setupEnrichmentPlanningStrategy } from "./enrichmentPlanningStrategySetup";
import { runEnrichmentPlanningDiscoveryPhase } from "./enrichmentPlanningDiscoveryPhase";

describe("pipeline fat thin 60", () => {
  it("exports settleTools one-call + types surface", () => {
    expect(typeof settleToolBatch).toBe("function");
    expect(typeof settleOneToolCall).toBe("function");
  });

  it("exports truncation mutate-pressure helper", () => {
    expect(typeof applyPreSettleTruncationRails).toBe("function");
    expect(typeof applyReasoningAbortMutatePressure).toBe("function");
  });

  it("exports pinDiscovery message builder", () => {
    expect(typeof runDiscoveryPass).toBe("function");
    expect(typeof buildPinDiscoveryPassMessages).toBe("function");
  });

  it("exports enrichment planning strategy + discovery phase", () => {
    expect(typeof runLiveEnrichmentPlanning).toBe("function");
    expect(typeof setupEnrichmentPlanningStrategy).toBe("function");
    expect(typeof runEnrichmentPlanningDiscoveryPhase).toBe("function");
  });
});
