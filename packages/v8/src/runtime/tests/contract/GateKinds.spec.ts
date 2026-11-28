import { describe, expect, it } from "vitest";

import {
  gateVerdictSchema,
  mapLegacySuspensionKind,
} from "../../helpers/gates";

describe("gate kinds contract", () => {
  it("parses suspend and complete verdicts", () => {
    expect(
      gateVerdictSchema.parse({
        action: "suspend",
        kind: "clarification_required",
        payload: { clarifyOrigin: "early_decide" },
        reasonCodes: [],
      }).action,
    ).toBe("suspend");

    expect(
      gateVerdictSchema.parse({
        action: "complete",
        terminal: "plan_ready_complete",
      }).action,
    ).toBe("complete");
  });

  it("maps legacy approval_required to mutation_approval_required", () => {
    expect(mapLegacySuspensionKind("approval_required")).toBe(
      "mutation_approval_required",
    );
    expect(mapLegacySuspensionKind("plan_approval_required")).toBe(
      "plan_approval_required",
    );
    expect(mapLegacySuspensionKind("nope")).toBeUndefined();
  });
});
