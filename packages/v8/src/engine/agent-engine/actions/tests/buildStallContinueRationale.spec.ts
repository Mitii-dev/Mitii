import { describe, expect, it } from "vitest";

import { taskListSchema } from "../../../../modules/task-list";
import {
  buildStallContinueRationale,
  shouldOfferStallContinue,
} from "../buildStallContinueRationale";

describe("buildStallContinueRationale", () => {
  it("summarizes changed files and pending checklist items", () => {
    const taskList = taskListSchema.parse({
      schemaVersion: 1,
      source: "agent",
      title: "Work",
      items: [
        {
          id: "1",
          title: "Wire FormBuilder",
          status: "pending",
        },
      ],
    });
    const rationale = buildStallContinueRationale({
      changedFiles: ["src/a.ts", "src/b.ts"],
      taskList,
      fileReadCalls: 24,
      uniqueFilePathsTouched: 6,
    });

    expect(rationale).toContain("2 file(s) changed");
    expect(rationale).toContain("Wire FormBuilder");
    expect(rationale).toContain("24 file reads");
  });
});

describe("shouldOfferStallContinue", () => {
  it("offers continue when files changed", () => {
    expect(
      shouldOfferStallContinue({
        changedFiles: ["src/a.ts"],
        mutationRequired: true,
      }),
    ).toBe(true);
  });

  it("does not offer continue for unfulfilled execute with no edits", () => {
    expect(
      shouldOfferStallContinue({
        changedFiles: [],
        mutationRequired: true,
      }),
    ).toBe(false);
  });
});
