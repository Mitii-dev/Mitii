import { describe, expect, it } from "vitest";

import {
  DECISION_PLATE_REGISTRY,
  listDecisionPlates,
  mapPlanningHintToDepth,
} from "../../index";

describe("decision plate registry", () => {
  it("lists route plates", () => {
    const ids = listDecisionPlates().map((p) => p.id);
    expect(ids).toContain("clarify_material");
    expect(ids).toContain("execute_fast_path");
    expect(ids).toContain("execute_visible");
  });

  it("exposes clamps and upgrades", () => {
    expect(DECISION_PLATE_REGISTRY.clamps.map((c) => c.id)).toContain(
      "anti_nag_suppress_clarify",
    );
    expect(DECISION_PLATE_REGISTRY.upgrades.map((u) => u.id)).toContain(
      "upgrade_unlock_network",
    );
  });

  it("maps planningHint to planningDepth", () => {
    expect(mapPlanningHintToDepth("none")).toBe("none");
    expect(mapPlanningHintToDepth("short")).toBe("internal");
    expect(mapPlanningHintToDepth("medium")).toBe("internal");
    expect(mapPlanningHintToDepth("long")).toBe("visible");
  });
});
