import { describe, expect, it } from "vitest";

import { assessDirection } from "../../helpers/direction/AssessDirection";
import { mapAssessmentToTaskAnalysis } from "../../helpers/direction/MapAssessmentToTaskAnalysis";

describe("mapAssessmentToTaskAnalysis", () => {
  it("derives recommendsPlanning from planningHint only", () => {
    const ballot = assessDirection({
      schemaVersion: 1,
      userCommand: "plan a large migration across packages",
      mode: "agent",
    });
    const analysis = mapAssessmentToTaskAnalysis(ballot);
    expect(analysis.planningHint).toBe(ballot.planningHint);
    expect(analysis.recommendsPlanning).toBe(ballot.planningHint !== "none");
    expect(analysis.taskSize).toBe(ballot.taskBand);
  });
});
