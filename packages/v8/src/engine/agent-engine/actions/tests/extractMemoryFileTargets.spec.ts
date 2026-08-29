import { describe, expect, it } from "vitest";

import { extractMemoryFileTargets } from "../extractMemoryFileTargets";
import { createUnderstanding } from "../../tests/fixtures/stubs";

describe("extractMemoryFileTargets", () => {
  it("keeps workspace-relative file targets and drops folders", () => {
    const base = createUnderstanding();
    const understanding = createUnderstanding({
      intent: base.intent,
      taskAnalysis: {
        ...base.taskAnalysis,
        targets: [
          { kind: "file", value: "src/LoginForm.tsx", explicit: true },
          { kind: "folder", value: "src/ui", explicit: true },
          { kind: "file", value: "../secret.ts", explicit: true },
        ],
      },
    });

    expect(extractMemoryFileTargets(understanding)).toEqual([
      "src/LoginForm.tsx",
    ]);
  });

  it("returns an empty list when understanding is omitted", () => {
    expect(extractMemoryFileTargets(undefined)).toEqual([]);
  });
});
