import { describe, expect, it } from "vitest";

import { assemblePlanQualityGates } from "../../helpers/plan/AssemblePlanQualityGates";

describe("assemblePlanQualityGates", () => {
  const nonHollowArtifact = {
    objective: "Add React bench cases",
    phases: [
      {
        name: "Change",
        steps: [
          {
            intent: "Add optimistic-like case",
            actionSummary: "Author task.yaml + tests",
            targetRefs: ["cases/js/atomic/frontend/optimistic-like-react"],
          },
        ],
      },
    ],
  };

  it("plan mode does not hollow-clarify solely on thin discovery floor", () => {
    const result = assemblePlanQualityGates({
      artifact: nonHollowArtifact as never,
      planningStatus: "validated",
      planningDepth: "visible",
      mode: "plan",
      discoveryQualityOk: false,
      discoveryRan: true,
    });
    expect(result.hollowCheck.ok).toBe(true);
    expect(result.discoveryQualityFailed).toBe(true);
    expect(result.effectiveHollow).toBe(false);
  });

  it("agent visible still fail-closes when discovery floor fails and artifact hollow", () => {
    const result = assemblePlanQualityGates({
      artifact: undefined,
      planningStatus: "blocked",
      planningDepth: "visible",
      mode: "agent",
      discoveryQualityOk: false,
      discoveryRan: true,
    });
    expect(result.effectiveHollow).toBe(true);
  });
});
