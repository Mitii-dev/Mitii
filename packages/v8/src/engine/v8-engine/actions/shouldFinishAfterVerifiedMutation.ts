import type { ToolResult } from "../../tool-runtime";
import { isSuccessfulVerificationToolResult } from "./runEvidence";

export type VerifiedMutationFinishInput = {
  /** A mutation (file edit or git write) already landed earlier in this run. */
  mutationApplied: boolean;
  /** The batch just settled contained a successful mutating/git-write call. */
  batchHadSuccessfulMutation: boolean;
  /** The batch just settled contained a failed/rejected mutating call. */
  batchHadRejectedMutation: boolean;
  /** Task-list items still pending/active; open work means the model must keep going. */
  openTaskCount: number;
  /** Settled tool calls of the batch in call order. */
  batch: ReadonlyArray<{ toolName: string; result: ToolResult | undefined }>;
};

/**
 * True when the batch just settled ran a passing verification command after
 * the last successful mutation. The loop should end so the verification gate
 * decides; another free-form model turn would only re-narrate finished work.
 */
export function shouldFinishAfterVerifiedMutation(
  input: VerifiedMutationFinishInput,
): boolean {
  if (!input.mutationApplied || input.openTaskCount > 0) return false;
  if (input.batchHadSuccessfulMutation || input.batchHadRejectedMutation) {
    return false;
  }
  return input.batch.some(
    ({ toolName, result }) =>
      result !== undefined &&
      isSuccessfulVerificationToolResult(toolName, result),
  );
}
