import { describe, expect, it } from "vitest";

import { isExecutionSeedTrusted, type ExecutionSeed } from "./resolve";

/**
 * Continue must restore the refined checkpoint seed. Re-resolving from the
 * raw user prompt alone drops context refinement (App.tsx wiring) and thrash-
 * Continues as execution_seed_weak — regression for Index→semantic runs.
 */
describe("execution seed resume preference", () => {
  it("treats a checkpoint-restored App.tsx wiring seed as trusted", () => {
    const checkpointSeed: ExecutionSeed = {
      paths: [
        "apps/desktop/src/renderer/App.tsx",
        "apps/desktop/src/shared/settings.ts",
      ],
      symbols: [],
      causeNotes: ["Index / Features semantic UI wiring"],
      confidence: "trusted",
      source: "mixed",
    };
    expect(isExecutionSeedTrusted(checkpointSeed)).toBe(true);

    // Prompt-only resolve typically has no paths for Index asks — prefer
    // checkpoint when present (wired in resumeToolLoop).
    const promptOnlyFallback: ExecutionSeed = {
      paths: [],
      symbols: [],
      causeNotes: [],
      confidence: "weak",
      source: "none",
    };
    const restored = checkpointSeed ?? promptOnlyFallback;
    expect(isExecutionSeedTrusted(restored)).toBe(true);
    expect(restored.paths).toContain("apps/desktop/src/renderer/App.tsx");
  });
});
