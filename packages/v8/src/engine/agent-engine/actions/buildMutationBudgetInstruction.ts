import type { MutationBudget } from "../../../modules/decision-policy";
import type { PromptInstructionBlock } from "../../../modules/prompt-construction";

/**
 * Trusted project-rule instruction that teaches the model to batch mutations
 * under the Decision Policy mutationBudget.
 */
export function buildMutationBudgetInstruction(
  budget: MutationBudget | undefined,
): PromptInstructionBlock | undefined {
  if (!budget) {
    return undefined;
  }

  const batchHint = budget.requireBatchedExecution
    ? `This task requires batched execution. Plan the file list first if needed, then mutate at most ${budget.preferredBatchSize} files per apply_patch turn.`
    : `Prefer at most ${budget.preferredBatchSize} files per apply_patch turn.`;

  return {
    id: "mitii.mutation_budget",
    title: "Mutation batch limits",
    priority: 90,
    content: [
      batchHint,
      `Hard limits per apply_patch call: ≤${budget.maxPatchesPerCall} patches, ≤${budget.maxUniqueFilesPerCall} unique files, ≤${budget.maxPatchPayloadCharacters} characters of oldText+newText.`,
      "Use minimal diffs (small oldText anchors). Never emit 30+ file rewrites in one response — split across turns.",
      "If a prior turn was truncated, immediately retry with a smaller batch.",
      "After a multi-file apply_patch, re-read or typecheck the touched files before the next mutation. Do not batch files whose contents may be stale.",
      "If apply_patch returns patch_conflict, the tool result includes current file content — copy exact oldText from that content and retry the stale file alone. Do not re-read unless currentContent is missing.",
    ].join("\n"),
  };
}
