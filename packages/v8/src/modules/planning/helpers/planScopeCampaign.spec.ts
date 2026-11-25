import { describe, expect, it } from "vitest";

import {
  appendNextPlanPhaseOffer,
  formatNextPlanPhaseOffer,
  remainingPlanScopeIds,
} from "./planScopeCampaign";

describe("remainingPlanScopeIds", () => {
  it("returns unfinished campaign scopes in order", () => {
    expect(remainingPlanScopeIds(["a"])).toEqual(["b", "c"]);
    expect(remainingPlanScopeIds(["a", "c"])).toEqual(["b"]);
    expect(remainingPlanScopeIds(["a", "b", "c"])).toEqual([]);
  });
});

describe("formatNextPlanPhaseOffer", () => {
  it("lists remaining scopes after the completed phase", () => {
    const offer = formatNextPlanPhaseOffer({
      completedScopeId: "a",
      remaining: ["b", "c"],
    });
    expect(offer).toContain("## Next phase available");
    expect(offer).toContain("scope A");
    expect(offer).toContain("B) Corpus-wide quality bar");
    expect(offer).toContain("C) Runner / architecture changes");
  });

  it("returns undefined when the campaign is complete", () => {
    expect(
      formatNextPlanPhaseOffer({
        completedScopeId: "c",
        remaining: [],
      }),
    ).toBeUndefined();
  });
});

describe("appendNextPlanPhaseOffer", () => {
  it("appends once and is idempotent", () => {
    const offer = formatNextPlanPhaseOffer({
      completedScopeId: "b",
      remaining: ["c"],
    })!;
    const once = appendNextPlanPhaseOffer("Plan done.", offer);
    expect(once).toContain("Plan done.");
    expect(once).toContain("## Next phase available");
    expect(appendNextPlanPhaseOffer(once, offer)).toBe(once);
  });
});
