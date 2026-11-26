import { describe, expect, it } from "vitest";

import { applyAfterToolSettleMutateRails } from "./advanceAfterToolSettleMutateRails";
import { applyAfterSettleReadonlyEvidenceRails } from "./advanceAfterToolSettleReadonlyEvidence";
import { runStartEarlyDecide } from "./executeStartEarlyDecide";
import { maybeSuspendForClarification } from "./executeStartEarlyClarify";
import { runEnrichmentContext } from "./executeStartEnrichmentContext";
import { retrieveEnrichmentRepositoryContext } from "./executeStartEnrichmentContextRetrieve";
import { runStartPromptAndLoop } from "./executeStartPromptAndLoop";
import { constructStartPrompt } from "./executeStartPromptConstruct";
import { runDiscoveryPassModelLoop } from "./pinDiscoveryPassLoop";
import { executeDiscoveryPassToolBatch } from "./pinDiscoveryPassLoopTools";
import {
  maybeSuspendAfterPlanDraft,
  runPostPlanDraftGates,
} from "./enrichmentAfterPlanDraft";
import { prepareAfterPlanDraft } from "./enrichmentAfterPlanDraftPrepare";

describe("pipeline fat thin 61", () => {
  it("exports after-settle mutate + readonly evidence helpers", () => {
    expect(typeof applyAfterToolSettleMutateRails).toBe("function");
    expect(typeof applyAfterSettleReadonlyEvidenceRails).toBe("function");
  });

  it("exports early decide + clarify helpers", () => {
    expect(typeof runStartEarlyDecide).toBe("function");
    expect(typeof maybeSuspendForClarification).toBe("function");
  });

  it("exports enrichment context retrieve helpers", () => {
    expect(typeof runEnrichmentContext).toBe("function");
    expect(typeof retrieveEnrichmentRepositoryContext).toBe("function");
  });

  it("exports prompt construct + loop helpers", () => {
    expect(typeof runStartPromptAndLoop).toBe("function");
    expect(typeof constructStartPrompt).toBe("function");
  });

  it("exports discovery loop tool batch + after-plan prepare", () => {
    expect(typeof runDiscoveryPassModelLoop).toBe("function");
    expect(typeof executeDiscoveryPassToolBatch).toBe("function");
    expect(typeof maybeSuspendAfterPlanDraft).toBe("function");
    expect(typeof runPostPlanDraftGates).toBe("function");
    expect(typeof prepareAfterPlanDraft).toBe("function");
  });
});
