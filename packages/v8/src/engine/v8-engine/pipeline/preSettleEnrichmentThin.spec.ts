import { describe, expect, it } from "vitest";

import { handlePreSettleTurnRails } from "./handlePreSettleTurnRails";
import { applyPreSettleToolLoopGuard } from "./handlePreSettleToolLoopGuard";
import { applyPreSettleTruncationRails } from "./handlePreSettleTruncationRails";
import {
  maybeSuspendAfterPlanDraft,
  runPostPlanDraftGates,
} from "./enrichmentAfterPlanDraft";
import { maybeSuspendForPlanScopeFork } from "./enrichmentPlanScopeFork";
import { maybeSuspendAfterPlanScope } from "./enrichmentPlanAfterScope";
import { initModelLoopSession } from "./modelLoopInit";
import { runV8ModelLoop } from "./modelLoop";

describe("preSettle + enrichment + modelLoop thin", () => {
  it("exports pre-settle rail helpers", () => {
    expect(typeof handlePreSettleTurnRails).toBe("function");
    expect(typeof applyPreSettleToolLoopGuard).toBe("function");
    expect(typeof applyPreSettleTruncationRails).toBe("function");
  });

  it("exports post-plan enrichment helpers", () => {
    expect(typeof maybeSuspendAfterPlanDraft).toBe("function");
    expect(typeof runPostPlanDraftGates).toBe("function");
    expect(typeof maybeSuspendForPlanScopeFork).toBe("function");
    expect(typeof maybeSuspendAfterPlanScope).toBe("function");
  });

  it("exports modelLoop session init", () => {
    expect(typeof initModelLoopSession).toBe("function");
    expect(typeof runV8ModelLoop).toBe("function");
  });
});
