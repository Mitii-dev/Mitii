import { describe, expect, it } from "vitest";

import type { ModelToolDefinition } from "../../../../modules/model-gateway";
import {
  filterToolsForMutationLock,
  filterToolsForMutationOnly,
  initialPostNudgeEvidenceReadsUsed,
  isMutationLocked,
  remainingPostNudgeEvidenceReads,
} from "../../pipeline/mutationLockTools";
import { buildBudgetWallResetMessage } from "../buildStallContinueRationale";
import { serializeRecoverabilityWorkingSet } from "../serializeRecoverabilityWorkingSet";

const tools: ModelToolDefinition[] = [
  { name: "read_file", description: "r", inputSchema: {} },
  { name: "read_many_files", description: "rm", inputSchema: {} },
  { name: "read_diagnostics", description: "rd", inputSchema: {} },
  { name: "glob_files", description: "g", inputSchema: {} },
  { name: "list_directory", description: "l", inputSchema: {} },
  { name: "search_files", description: "s", inputSchema: {} },
  { name: "document_symbol", description: "ds", inputSchema: {} },
  { name: "apply_patch", description: "p", inputSchema: {} },
  { name: "delete_file", description: "d", inputSchema: {} },
  { name: "update_todos", description: "t", inputSchema: {} },
];

describe("mutation lock after Continue (BillBuddy 22:38)", () => {
  it("locks as soon as the mutation nudge is awaiting (strips broad discovery)", () => {
    expect(
      isMutationLocked({
        awaitingReadOnlyMutationRetry: true,
        postNudgeEvidenceReadTurns: 0,
        maxPostNudgeEvidenceReadTurns: 2,
      }),
    ).toBe(true);
    expect(
      isMutationLocked({
        awaitingReadOnlyMutationRetry: false,
        postNudgeEvidenceReadTurns: 0,
        maxPostNudgeEvidenceReadTurns: 2,
      }),
    ).toBe(false);
  });

  it("keeps targeted reads + caret code-intel + mutation tools; strips list/glob/search/workspace_symbol", () => {
    const locked = filterToolsForMutationLock([
      ...tools,
      { name: "goto_definition", description: "g", inputSchema: {} },
      { name: "workspace_symbol", description: "ws", inputSchema: {} },
      { name: "analyze_change_impact", description: "ci", inputSchema: {} },
    ]);
    expect(locked?.map((tool) => tool.name).sort()).toEqual([
      "analyze_change_impact",
      "apply_patch",
      "delete_file",
      "document_symbol",
      "goto_definition",
      "read_diagnostics",
      "read_file",
      "read_many_files",
      "update_todos",
    ]);
  });

  it("Continue evidence budget: first full, later Continues spent", () => {
    expect(
      initialPostNudgeEvidenceReadsUsed({
        forceMutationOnResume: true,
        forceMutationLock: false,
        continueOverrideCount: 1,
        maxPostNudgeEvidenceReadTurns: 2,
      }),
    ).toBe(0);
    expect(
      remainingPostNudgeEvidenceReads({
        postNudgeEvidenceReadTurns: 0,
        maxPostNudgeEvidenceReadTurns: 2,
      }),
    ).toBe(2);
    expect(
      initialPostNudgeEvidenceReadsUsed({
        forceMutationOnResume: true,
        forceMutationLock: false,
        continueOverrideCount: 2,
        maxPostNudgeEvidenceReadTurns: 2,
      }),
    ).toBe(2);
    expect(
      remainingPostNudgeEvidenceReads({
        postNudgeEvidenceReadTurns: 2,
        maxPostNudgeEvidenceReadTurns: 2,
      }),
    ).toBe(0);
  });

  it("strips evidence reads when only mutation tools remain", () => {
    const only = filterToolsForMutationOnly(tools);
    expect(only?.map((tool) => tool.name).sort()).toEqual([
      "apply_patch",
      "delete_file",
      "update_todos",
    ]);
  });

  it("Continue reset allows remaining targeted reads then patch", () => {
    const reset = buildBudgetWallResetMessage({
      reason: "unfulfilled_execute",
      mutationRequired: true,
      changedFiles: [],
    });
    expect(reset).toMatch(/apply_patch/i);
    expect(reset).toMatch(/targeted read_file/i);
    expect(reset).not.toMatch(/Read tools are unavailable/i);
    expect(reset).toMatch(/list_directory|glob_files|search_files/i);
  });

  it("working set allows targeted reads when locked", () => {
    const content = serializeRecoverabilityWorkingSet({ mutationLocked: true });
    expect(content).toMatch(/Mutation required now/i);
    expect(content).toMatch(/targeted read_file/i);
    expect(content).not.toMatch(/Do not read or search first/i);
  });
});
