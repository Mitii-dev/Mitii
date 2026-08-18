import type { MutationBudget } from "../../../modules/decision-policy";
import type { ModelToolDefinition } from "../../../modules/model-gateway";

/**
 * Keep apply_patch catalog text aligned with the live grant. The static
 * catalog must not teach a 3-file batch when the window effort allows 8.
 */
export function annotateMutationToolDefinitions(
  tools: readonly ModelToolDefinition[],
  budget: MutationBudget | undefined,
): ModelToolDefinition[] {
  if (!budget) {
    return [...tools];
  }
  return tools.map((tool) => {
    if (tool.name !== "apply_patch") {
      return tool;
    }
    return {
      ...tool,
      description: `Apply structured oldText/newText patches inside a recoverable transaction. Prefer ${budget.preferredBatchSize} files per call (hard max ${budget.maxUniqueFilesPerCall} unique files, ${budget.maxPatchesPerCall} patches, ${budget.maxPatchPayloadCharacters} characters of oldText+newText). Use minimal hunks. Create new files with oldText="". For deletes use delete_file; for renames use move_file.`,
    };
  });
}
