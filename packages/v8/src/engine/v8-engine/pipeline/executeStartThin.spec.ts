import { describe, expect, it } from "vitest";

import { executeV8Start } from "./executeStart";
import { runStartPromptAndLoop } from "./executeStartPromptAndLoop";
import { runStartEnrichment } from "./executeStartEnrichment";
import { runEnrichmentContext } from "./executeStartEnrichmentContext";
import { runEnrichmentPlanning } from "./enrichmentPlanning";
import { runLiveEnrichmentPlanning } from "./enrichmentPlanningDiscover";
import { finishIfGrantExpansionRequired } from "./verificationFinishGrantExpansion";
import { finishIfContinueRequired } from "./verificationFinishContinueSuspend";

describe("executeStart + enrichment + suspend thin", () => {
  it("exports start path helpers", () => {
    expect(typeof executeV8Start).toBe("function");
    expect(typeof runStartPromptAndLoop).toBe("function");
    expect(typeof runStartEnrichment).toBe("function");
    expect(typeof runEnrichmentContext).toBe("function");
  });

  it("exports planning helpers", () => {
    expect(typeof runEnrichmentPlanning).toBe("function");
    expect(typeof runLiveEnrichmentPlanning).toBe("function");
  });

  it("exports verification suspend helpers", () => {
    expect(typeof finishIfGrantExpansionRequired).toBe("function");
    expect(typeof finishIfContinueRequired).toBe("function");
  });
});
