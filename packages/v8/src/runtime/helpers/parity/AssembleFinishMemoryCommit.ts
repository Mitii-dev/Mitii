/**
 * Finish-time memory commit for start facade (S11-MEM).
 */

import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import type { RuntimeStartInput } from "../../contracts/input/RuntimeStartInput";
import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";
import type { VerifyFinishSketch } from "../../flow/steps/11-VerifyFinish";
import type { ToolInvocationRecord } from "../tool-journal";
import {
  commitRuntimeMemory,
  commitRuntimeMemoryAsync,
  type RuntimeMemoryCommitSketch,
} from "../memory/CommitRuntimeMemory";

export async function assembleFinishMemoryCommit(input: {
  mode: "ask" | "plan" | "agent";
  finishStatus: "completed" | "cancelled" | "failed" | "suspended";
  decision: RuntimeDecisionSketch;
  verify?: VerifyFinishSketch;
  deps?: RuntimeDependencies;
  start: RuntimeStartInput;
  runId: string;
  trimmedAnswer?: string;
  journal: readonly ToolInvocationRecord[];
  planObjective?: string;
}): Promise<RuntimeMemoryCommitSketch> {
  const hadMutations = input.journal.some(
    (row) =>
      row.status === "succeeded" &&
      (row.effectClass === "mutate" || row.effectClass === "external"),
  );
  const params = {
    mode: input.mode,
    status: input.finishStatus,
    route: input.decision.route,
    verify: input.verify
      ? {
          ranVerify: input.verify.ranVerify,
          invalidated: input.verify.invalidated,
          outcomeStatus: input.verify.outcome?.status,
        }
      : undefined,
    commitPort: input.deps?.memoryCommit,
    objective: input.planObjective,
    answerSummary: input.trimmedAnswer,
    changedPaths: input.start.host?.dirtyPaths,
    workspaceId: input.start.host?.cwd,
    runId: input.runId,
    hadMutations,
  };
  return input.deps?.memoryCommit
    ? commitRuntimeMemoryAsync(params)
    : commitRuntimeMemory(params);
}
