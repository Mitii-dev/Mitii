import { describe, expect, it } from "vitest";

import {
  createLoopFileReadTracker,
  isExplorationRereadHeavy,
  recordLoopFileReads,
  resetLoopFileReadTracker,
  snapshotLoopFileReads,
} from "../isExplorationRereadHeavy";

describe("isExplorationRereadHeavy", () => {
  it("is false below the minimum call count", () => {
    expect(
      isExplorationRereadHeavy({
        fileReadCalls: 7,
        uniqueFilePathsTouched: 1,
      }),
    ).toBe(false);
  });

  it("is true when reads are at least 2x unique paths", () => {
    expect(
      isExplorationRereadHeavy({
        fileReadCalls: 8,
        uniqueFilePathsTouched: 1,
      }),
    ).toBe(true);
    expect(
      isExplorationRereadHeavy({
        fileReadCalls: 8,
        uniqueFilePathsTouched: 4,
      }),
    ).toBe(true);
  });

  it("is false when reads stay below the ratio", () => {
    expect(
      isExplorationRereadHeavy({
        fileReadCalls: 8,
        uniqueFilePathsTouched: 5,
      }),
    ).toBe(false);
  });
});

describe("LoopFileReadTracker", () => {
  it("counts unique paths in this loop, including re-reads of known files", () => {
    const tracker = createLoopFileReadTracker();
    recordLoopFileReads(tracker, ["src/a.ts"]);
    recordLoopFileReads(tracker, ["src/b.ts"]);
    recordLoopFileReads(tracker, ["src/a.ts"]);
    expect(snapshotLoopFileReads(tracker)).toEqual({
      fileReadCalls: 3,
      uniqueFilePathsTouched: 2,
    });
  });

  it("does not look like a stall when repair re-reads several distinct error files", () => {
    const tracker = createLoopFileReadTracker();
    const paths = [
      "src/FormBuilder.tsx",
      "src/FormRenderer.tsx",
      "src/field-radio.tsx",
      "src/field-checkbox.tsx",
      "src/useFieldConditions.ts",
      "src/condition-type.ts",
    ];
    for (const path of paths) {
      recordLoopFileReads(tracker, [path]);
    }
    recordLoopFileReads(tracker, [paths[0]!]);
    recordLoopFileReads(tracker, [paths[1]!]);
    recordLoopFileReads(tracker, [paths[2]!]);
    expect(isExplorationRereadHeavy(snapshotLoopFileReads(tracker))).toBe(
      false,
    );
  });

  it("clears the ratio after a successful mutation", () => {
    const tracker = createLoopFileReadTracker();
    for (let index = 0; index < 8; index += 1) {
      recordLoopFileReads(tracker, ["src/form.ts"]);
    }
    expect(isExplorationRereadHeavy(snapshotLoopFileReads(tracker))).toBe(true);
    resetLoopFileReadTracker(tracker);
    recordLoopFileReads(tracker, ["src/form.ts"]);
    expect(isExplorationRereadHeavy(snapshotLoopFileReads(tracker))).toBe(
      false,
    );
  });
});
