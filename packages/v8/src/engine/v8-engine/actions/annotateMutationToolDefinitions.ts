import type { MutationBudget } from "../../../modules/decision-policy";
import type { ModelToolDefinition } from "../../../modules/model-gateway";

import { buildMutationBudgetInstruction } from "./buildMutationBudgetInstruction";

/**
 * Keep apply_patch catalog text aligned with the live grant. Retry/stale-hunk
 * guidance lives here (tools stay in context) instead of rewriting the
 * cached system prefix.
 */
export function annotateMutationToolDefinitions(
  tools: readonly ModelToolDefinition[],
  budget: MutationBudget | undefined,
): ModelToolDefinition[] {
  if (!budget) {
    return [...tools];
  }
  const instruction = buildMutationBudgetInstruction(budget);
  return tools.map((tool) => {
    if (tool.name !== "apply_patch") {
      return tool;
    }
    return {
      ...tool,
      description: [
        `Apply structured oldText/newText patches inside a recoverable transaction. Prefer ${budget.preferredBatchSize} files per call (hard max ${budget.maxUniqueFilesPerCall} unique files, ${budget.maxPatchesPerCall} patches, ${budget.maxPatchPayloadCharacters} characters of oldText+newText). Use minimal hunks. Create new files with oldText="". For deletes use delete_file; for renames use move_file.`,
        instruction?.content,
      ]
        .filter((line): line is string => Boolean(line))
        .join(" "),
    };
  });
}
