import { describe, expect, it } from "vitest";

import {
  answerResearchPlate,
  askModeSeal,
  clarifyPlate,
  diagnosePlate,
  executeFastPathPlate,
  executeMutatePlate,
  expandWritePathsUpgrade,
  injectionClamp,
  planVisiblePlate,
  promoteDiagnoseToExecuteUpgrade,
  unlockNetworkUpgrade,
  unlockRunCommandUpgrade,
} from "../../plates";

describe("decision plate registry", () => {
  it("exports route plates with research or none grants", () => {
    expect(clarifyPlate.grantProfile).toBe("none");
    expect(answerResearchPlate.grantProfile).toBe("research");
    expect(diagnosePlate.grantProfile).toBe("research");
    expect(planVisiblePlate.grantProfile).toBe("research");
    expect(executeMutatePlate.grantProfile).toBe("agent_execute");
    expect(executeFastPathPlate.grantProfile).toBe("agent_execute");
  });

  it("exports mode seals and widen-only upgrades", () => {
    expect(askModeSeal.neverWrite).toBe(true);
    expect(injectionClamp.direction).toBe("narrow");
    expect(unlockRunCommandUpgrade.direction).toBe("widen");
    expect(expandWritePathsUpgrade.direction).toBe("widen");
    expect(promoteDiagnoseToExecuteUpgrade.direction).toBe("widen");
    expect(unlockNetworkUpgrade.direction).toBe("widen");
  });
});
