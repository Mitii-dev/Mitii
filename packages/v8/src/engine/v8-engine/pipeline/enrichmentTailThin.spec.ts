import { describe, expect, it } from "vitest";

import { finishEnrichmentSkillsMemoryPlan } from "./executeStartEnrichmentTail";
import { retrieveEnrichmentSkillsAndMemory } from "./enrichmentSkillsMemory";
import { runEnrichmentPlanning } from "./enrichmentPlanning";
import {
  approvalRequiredOutcome,
  applySucceededToolSideEffects,
  cacheSucceededReadonlyTool,
  emitToolCompletedAndRecord,
} from "./executeToolFinishPostSuccess";

describe("enrichment tail + tool-finish thin", () => {
  it("exports enrichment phase helpers", () => {
    expect(typeof finishEnrichmentSkillsMemoryPlan).toBe("function");
    expect(typeof retrieveEnrichmentSkillsAndMemory).toBe("function");
    expect(typeof runEnrichmentPlanning).toBe("function");
  });

  it("exports tool-finish post-success helpers", () => {
    expect(typeof approvalRequiredOutcome).toBe("function");
    expect(typeof cacheSucceededReadonlyTool).toBe("function");
    expect(typeof applySucceededToolSideEffects).toBe("function");
    expect(typeof emitToolCompletedAndRecord).toBe("function");
  });
});
