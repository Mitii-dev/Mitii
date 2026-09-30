import { describe, expect, it } from "vitest";

import { serializeRecoverabilityWorkingSet } from "./serializeRecoverabilityWorkingSet";

describe("serializeRecoverabilityWorkingSet", () => {
  it("includes a stale-checklist reminder when requested", () => {
    const block = serializeRecoverabilityWorkingSet({
      taskList: {
        schemaVersion: 1,
        source: "agent",
        purpose: "execution",
        items: [
          {
            id: "a",
            title: "Fix src/a.ts",
            status: "active",
            write: ["src/a.ts"],
          },
          { id: "b", title: "Fix src/b.ts", status: "pending" },
        ],
      },
      remindTodoUpdate: true,
    });
    expect(block).toContain("## Checklist");
    expect(block).toContain("Checklist may be stale");
    expect(block).toContain("Patch update_todos now");
  });

  it("omits the reminder by default", () => {
    const block = serializeRecoverabilityWorkingSet({
      taskList: {
        schemaVersion: 1,
        source: "agent",
        items: [{ id: "a", title: "Fix src/a.ts", status: "active" }],
      },
    });
    expect(block).not.toContain("Checklist may be stale");
  });
});
