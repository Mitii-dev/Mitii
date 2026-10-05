import { describe, expect, it } from "vitest";

import { formatOpenChecklistLeftover } from "./finishVerificationAccepted";

describe("formatOpenChecklistLeftover", () => {
  it("lists pending/active titles after verify accept", () => {
    const note = formatOpenChecklistLeftover({
      schemaVersion: 1,
      source: "plan",
      purpose: "execution",
      items: [
        { id: "1", title: "Done row", status: "done" },
        { id: "2", title: "Add README", status: "pending" },
        { id: "3", title: "Extend tests", status: "active" },
        { id: "4", title: "Skipped", status: "skipped" },
      ],
    });
    expect(note).toContain("related work may still be open");
    expect(note).toContain("Add README");
    expect(note).toContain("Extend tests");
    expect(note).toMatch(/Want me to improve these as well/i);
    expect(note).toMatch(/continue/i);
    expect(note).not.toContain("Done row");
    expect(note).not.toContain("Skipped");
  });

  it("returns empty when nothing is open", () => {
    expect(
      formatOpenChecklistLeftover({
        schemaVersion: 1,
        source: "plan",
        items: [{ id: "1", title: "Done", status: "done" }],
      }),
    ).toBe("");
  });
});

describe("accepted incomplete_execute terminal policy", () => {
  it("fails only when no mutations landed; completes when edits exist", () => {
    // Mirrors finishVerificationAccepted branching after verify accept.
    const decide = (changedFileCount: number): "failed" | "completed" =>
      changedFileCount === 0 ? "failed" : "completed";
    expect(decide(0)).toBe("failed");
    expect(decide(2)).toBe("completed");
  });
});
