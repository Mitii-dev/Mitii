import { describe, expect, it } from "vitest";

import {
  isEvidenceOnlyTaskTitles,
  isEvidenceOrStatusTitle,
} from "../../helpers/plan/IsEvidenceOrStatusTitle";

describe("isEvidenceOrStatusTitle", () => {
  it("rejects verify telemetry titles", () => {
    expect(isEvidenceOrStatusTitle("Exit code: 0")).toBe(true);
    expect(isEvidenceOrStatusTitle("14 passed, 0 failed, 2 skipped")).toBe(
      true,
    );
    expect(isEvidenceOrStatusTitle("Passed via `node --test a.js`")).toBe(
      true,
    );
  });

  it("keeps real work steppers", () => {
    expect(isEvidenceOrStatusTitle("Desugar nested http.start")).toBe(false);
    expect(isEvidenceOrStatusTitle("Add session continuity")).toBe(false);
  });

  it("detects evidence-only title sets", () => {
    expect(
      isEvidenceOnlyTaskTitles([
        "Exit code: 0",
        "14 passed, 0 failed, 2 skipped",
      ]),
    ).toBe(true);
    expect(
      isEvidenceOnlyTaskTitles(["Exit code: 0", "Add React cases"]),
    ).toBe(false);
  });
});
