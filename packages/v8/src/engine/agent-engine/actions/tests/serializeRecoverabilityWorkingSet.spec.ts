import { describe, expect, it } from "vitest";

import type { MutationBudget } from "../../../../modules/decision-policy";
import { WORKING_SET_MARKER, taskListSchema } from "../../../../modules/task-list";
import { serializeRecoverabilityWorkingSet } from "../serializeRecoverabilityWorkingSet";

describe("serializeRecoverabilityWorkingSet", () => {
  const budget: MutationBudget = {
    maxPatchesPerCall: 8,
    maxUniqueFilesPerCall: 7,
    maxPatchPayloadCharacters: 48_000,
    preferredBatchSize: 7,
    requireBatchedExecution: true,
  };

  it("merges checklist, mutation budget, preflight, compiler queue, and observations", () => {
    const taskList = taskListSchema.parse({
      schemaVersion: 1,
      source: "plan",
      items: [
        {
          id: "step-1",
          title: "Fix Login.ts",
          status: "active",
          write: ["src/auth/Login.ts"],
          mustRead: ["src/auth/types.ts"],
        },
      ],
    });
    const block = serializeRecoverabilityWorkingSet({
      taskList,
      mutationBudget: budget,
      preflightDiagnostics:
        "Preflight verification already captured 2 error(s).\n- src/auth/Login.ts:12 TS2322: bad type",
      establishedFacts: [
        {
          id: "error-queue:compiler",
          content: "Remaining compiler errors (2) grouped by code…",
        },
        {
          id: "read_file:src/auth/types.ts",
          content: "src/auth/types.ts => export interface User {}",
        },
      ],
    });

    expect(block).toContain(WORKING_SET_MARKER);
    expect(block).toContain("## Checklist");
    expect(block).toContain("write: src/auth/Login.ts");
    expect(block).toContain("## Mutation budget");
    expect(block).toContain("Batched execution required");
    expect(block).toContain("## Preflight diagnostics");
    expect(block).toContain("TS2322");
    expect(block).toContain("## Compiler queue");
    expect(block).toContain("Remaining compiler errors");
    expect(block).toContain("## Established observations");
    expect(block).toContain("read_file:src/auth/types.ts");
    expect(block).not.toContain("(error-queue:compiler)");
  });

  it("keeps standing checklist guidance when no live list exists", () => {
    const block = serializeRecoverabilityWorkingSet({});
    expect(block).toContain(WORKING_SET_MARKER);
    expect(block).toContain("No live checklist yet");
    expect(block).toContain("update_todos");
  });
});
