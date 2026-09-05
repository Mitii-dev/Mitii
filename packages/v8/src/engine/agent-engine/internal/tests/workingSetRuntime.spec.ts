import { describe, expect, it } from "vitest";

import { WORKING_SET_MARKER } from "../../../../modules/task-list";

import { upsertTrailingWorkingSet } from "../workingSetRuntime";

describe("upsertTrailingWorkingSet", () => {
  it("always appends a working set when input is omitted", () => {
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "implement the scaffold" },
    ];
    upsertTrailingWorkingSet(messages);
    expect(messages).toHaveLength(3);
    expect(messages[2]?.role).toBe("user");
    expect(messages[2]?.content).toContain(WORKING_SET_MARKER);
    expect(messages[2]?.content).toContain("## Checklist");
  });

  it("replaces an existing trailing working set instead of stacking", () => {
    const messages = [
      { role: "user" as const, content: "ask" },
      {
        role: "user" as const,
        content: `${WORKING_SET_MARKER}\nold checklist\n</working_set>`,
      },
    ];
    upsertTrailingWorkingSet(messages, {
      establishedFacts: [
        {
          id: "path:packages/mui-builder/src/index.ts",
          content: "packages/mui-builder/src/index.ts exists",
        },
      ],
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain(WORKING_SET_MARKER);
    expect(messages[1]?.content).not.toContain("old checklist");
    expect(messages[1]?.content).toContain("packages/mui-builder/src/index.ts");
  });

  it("keeps non-working-set user messages intact", () => {
    const messages = [
      { role: "user" as const, content: "prior recovery nudge" },
      {
        role: "user" as const,
        content: `${WORKING_SET_MARKER}\nv1\n</working_set>`,
      },
    ];
    upsertTrailingWorkingSet(messages, {});
    expect(messages[0]?.content).toBe("prior recovery nudge");
    expect(messages[1]?.content).toContain(WORKING_SET_MARKER);
  });
});
