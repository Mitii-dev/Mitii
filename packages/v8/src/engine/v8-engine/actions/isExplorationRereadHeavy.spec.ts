import { describe, expect, it } from "vitest";

import {
  createLoopFileReadTracker,
  isExplorationRereadHeavy,
  isLoopFilePathFullyLoaded,
  markLoopFileReadResult,
  recordLoopFileReads,
  snapshotLoopFileReads,
} from "./isExplorationRereadHeavy";

describe("LoopFileReadTracker coverage", () => {
  it("counts same-file windowed reads as one thrash unit within allowance", () => {
    const tracker = createLoopFileReadTracker();
    for (let index = 0; index < 4; index += 1) {
      recordLoopFileReads(tracker, [
        `scripts/data/node-ecosystem-cases.mjs:${index * 50 + 1}-${index * 50 + 50}`,
      ]);
    }
    const snapshot = snapshotLoopFileReads(tracker, {
      explorationSamePathReadAllowance: 4,
    });
    expect(snapshot.uniqueFilePathsTouched).toBe(1);
    expect(snapshot.rawFileReadCalls).toBe(4);
    expect(snapshot.fileReadCalls).toBe(1);
    expect(
      isExplorationRereadHeavy(snapshot, {
        explorationRereadMinCalls: 6,
        explorationRereadRatio: 2,
      }),
    ).toBe(false);
  });

  it("charges thrash only after same-path allowance is exceeded", () => {
    const tracker = createLoopFileReadTracker();
    for (let index = 0; index < 8; index += 1) {
      recordLoopFileReads(tracker, ["src/large.ts"]);
    }
    const snapshot = snapshotLoopFileReads(tracker, {
      explorationSamePathReadAllowance: 4,
    });
    // 1 + (8 - 4) = 5 effective calls against 1 unique path
    expect(snapshot.fileReadCalls).toBe(5);
    expect(
      isExplorationRereadHeavy(snapshot, {
        explorationRereadMinCalls: 5,
        explorationRereadRatio: 2,
      }),
    ).toBe(true);
  });

  it("requires eof and non-truncated before fullyLoaded", () => {
    const tracker = createLoopFileReadTracker();
    recordLoopFileReads(tracker, ["src/large.ts"]);
    expect(isLoopFilePathFullyLoaded(tracker, "src/large.ts")).toBe(false);

    markLoopFileReadResult(tracker, "src/large.ts", {
      truncated: true,
      eof: false,
    });
    expect(isLoopFilePathFullyLoaded(tracker, "src/large.ts")).toBe(false);

    markLoopFileReadResult(tracker, "src/large.ts", {
      truncated: false,
      eof: true,
    });
    expect(isLoopFilePathFullyLoaded(tracker, "src/large.ts")).toBe(true);
  });
});
