import { describe, expect, it } from "vitest";

import {
  extractMutationTargetPaths,
  missingMustReadPaths,
} from "../assertBatchReads";
import {
  createLoopFileReadTracker,
  recordLoopFileReads,
} from "../isExplorationRereadHeavy";

describe("extractMutationTargetPaths", () => {
  it("collects apply_patch, delete, and move targets", () => {
    expect(
      extractMutationTargetPaths("apply_patch", {
        patches: [
          { path: "src/auth/session.ts", oldText: "a", newText: "b" },
          { path: "./src/auth/session.ts", oldText: "c", newText: "d" },
        ],
      }),
    ).toEqual(["src/auth/session.ts"]);
    expect(
      extractMutationTargetPaths("delete_file", { path: "src/gone.ts" }),
    ).toEqual(["src/gone.ts"]);
    expect(
      extractMutationTargetPaths("move_file", {
        from: "src/a.ts",
        to: "src/b.ts",
      }),
    ).toEqual(["src/a.ts"]);
    expect(
      extractMutationTargetPaths("read_file", { path: "src/a.ts" }),
    ).toEqual([]);
  });
});

describe("missingMustReadPaths", () => {
  const taskList = {
    schemaVersion: 1 as const,
    source: "plan" as const,
    purpose: "execution" as const,
    items: [
      {
        id: "fix",
        title: "Change: Fix src/auth/session.ts",
        status: "active" as const,
        write: ["src/auth/session.ts"],
        mustRead: ["src/auth/types.ts"],
      },
    ],
  };

  it("returns unread mustRead paths for a write mutation", () => {
    expect(
      missingMustReadPaths({
        taskList,
        mutationPaths: ["src/auth/session.ts"],
      }),
    ).toEqual(["src/auth/types.ts"]);
  });

  it("treats this-loop reads and established facts as loaded", () => {
    const loopFileReads = createLoopFileReadTracker();
    recordLoopFileReads(loopFileReads, ["src/auth/types.ts"]);
    expect(
      missingMustReadPaths({
        taskList,
        mutationPaths: ["src/auth/session.ts"],
        loopFileReads,
        establishedFacts: [
          {
            id: "read_file:src/auth/session.ts",
            content: "src/auth/session.ts => type Session",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("skips when the mutation does not touch the active write set", () => {
    expect(
      missingMustReadPaths({
        taskList,
        mutationPaths: ["src/unrelated.ts"],
      }),
    ).toEqual([]);
  });

  it("skips when the active task has no mustRead", () => {
    expect(
      missingMustReadPaths({
        taskList: {
          ...taskList,
          items: [{ ...taskList.items[0]!, mustRead: undefined }],
        },
        mutationPaths: ["src/auth/session.ts"],
      }),
    ).toEqual([]);
  });
});
