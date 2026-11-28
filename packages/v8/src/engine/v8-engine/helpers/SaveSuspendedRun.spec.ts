import { describe, expect, it } from "vitest";

import { saveSuspendedRun } from "./SaveSuspendedRun";
import { toStoreSuspensionKind } from "./ToStoreSuspensionKind";
import type { AgentRunCheckpoint } from "../internal/RunCheckpoint";

function minimalCheckpoint(
  suspensionKind: AgentRunCheckpoint["suspensionKind"],
): AgentRunCheckpoint {
  return {
    runId: "r1",
    requestId: "q1",
    suspensionKind,
    input: {} as AgentRunCheckpoint["input"],
    decision: {} as AgentRunCheckpoint["decision"],
    messages: [],
    toolCacheEntries: [],
    changedFiles: [],
    mutationCheckpointIds: [],
    reasonCodes: [],
    warnings: [],
    usage: {} as AgentRunCheckpoint["usage"],
    startedAtMs: 1,
  };
}

describe("toStoreSuspensionKind", () => {
  it("maps hub mutation_approval_required to approval_required", () => {
    expect(toStoreSuspensionKind("mutation_approval_required")).toBe(
      "approval_required",
    );
  });

  it("passes through known store kinds", () => {
    expect(toStoreSuspensionKind("clarification_required")).toBe(
      "clarification_required",
    );
  });
});

describe("saveSuspendedRun", () => {
  it("normalizes and persists via the store port", async () => {
    const saved: AgentRunCheckpoint[] = [];
    const out = await saveSuspendedRun({
      store: {
        save: async (cp) => {
          saved.push(cp);
        },
        load: async () => undefined,
        delete: async () => undefined,
        saveRestorePoint: async () => undefined,
        loadRestorePoint: async () => undefined,
        listRestorePoints: async () => [],
        deleteRestorePoints: async () => undefined,
      },
      checkpoint: {
        ...minimalCheckpoint("approval_required"),
        suspensionKind: "approval_required",
      },
    });
    expect(saved).toHaveLength(1);
    expect(out.suspensionKind).toBe("approval_required");
    expect(out.suspendedAtMs).toBeTypeOf("number");
  });
});
