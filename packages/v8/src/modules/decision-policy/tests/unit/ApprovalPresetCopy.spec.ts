import { describe, expect, it } from "vitest";

import {
  APPROVAL_PRESET_COPY,
  formatApprovalPresetHelp,
  getApprovalPresetCopy,
} from "../../actions/ApprovalPresetCopy";

describe("ApprovalPresetCopy", () => {
  it("documents Safe / Guided / Pilot", () => {
    expect(APPROVAL_PRESET_COPY.map((entry) => entry.id)).toEqual([
      "safe",
      "guided",
      "pilot",
    ]);
    const help = formatApprovalPresetHelp();
    expect(help).toContain("Safe");
    expect(help).toContain("Guided");
    expect(help).toContain("Pilot");
    expect(help).toContain("Ask mode still cannot edit");
  });

  it("maps builder legacy alias to guided", () => {
    expect(getApprovalPresetCopy("builder").id).toBe("guided");
    expect(getApprovalPresetCopy("pilot").mapsTo.approvalMode).toBe("never");
    expect(getApprovalPresetCopy("safe").mapsTo.approvalMode).toBe(
      "every_mutation",
    );
  });
});
