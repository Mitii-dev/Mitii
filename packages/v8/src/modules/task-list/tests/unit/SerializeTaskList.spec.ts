import { describe, expect, it } from "vitest";

import {
  parseTaskListMarkdown,
  serializeTaskListForPrompt,
  serializeTaskListGuidance,
  serializeTaskListMarkdown,
  taskListSchema,
} from "../../index";

describe("serializeTaskList", () => {
  const list = taskListSchema.parse({
    schemaVersion: 1,
    source: "agent",
    title: "Focus Chain List for Task 1",
    items: [
      { id: "a", title: "Analyze project structure", status: "done" },
      { id: "b", title: "Read readme", status: "active" },
      { id: "c", title: "Write summary", status: "pending" },
    ],
  });

  it("writes and parses checkbox markdown", () => {
    const markdown = serializeTaskListMarkdown(list);
    expect(markdown).toContain("- [x] Analyze project structure");
    expect(markdown).toContain("- [>] Read readme");
    expect(markdown).toContain("- [ ] Write summary");
    const parsed = parseTaskListMarkdown(markdown);
    expect(parsed?.items.map((item) => item.status)).toEqual([
      "done",
      "active",
      "pending",
    ]);
  });

  it("parses Cursor-style focus chain lists", () => {
    const parsed = parseTaskListMarkdown(
      [
        "# Focus Chain List for Task 1786569152232",
        "",
        "- [x] Analyze project structure from file listing",
        "- [x] Read main readme.md for overview",
        "- [ ] Review root package.json",
      ].join("\n"),
    );
    expect(parsed?.items).toHaveLength(3);
    expect(parsed?.items.filter((item) => item.status === "done")).toHaveLength(2);
  });

  it("includes ids in the prompt form", () => {
    const prompt = serializeTaskListForPrompt(list);
    expect(prompt).toContain("update_todos");
    expect(prompt).toContain("a: Analyze project structure");
    expect(prompt).toContain("Keep exactly one item active");
    expect(prompt).toContain("prefer patch by id");
    expect(prompt).toContain("Skip update_todos only for trivial single-step work");
  });

  it("asks agent to create concrete tasks when no list exists", () => {
    const guidance = serializeTaskListGuidance();
    expect(guidance).toContain("No live working list yet");
    expect(guidance).toContain("update_todos");
    expect(guidance).toContain("after the first read/diagnose tool turn");
    expect(guidance).toContain("concrete file, failure, or user-visible behavior");
    expect(guidance).toContain("Keep exactly one item active");
    expect(guidance).not.toContain("Discover:");
  });
});
