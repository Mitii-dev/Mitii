import type { BudgetAllocation } from "./allocateBudget";
import type {
  PromptOmission,
  PromptProvenanceEntry,
  PromptReasonCode,
} from "../contracts";

export type PromptBudgetSections = BudgetAllocation["sections"];

/** Mutable accumulators shared by the prompt assembly stages. */
export interface PromptAssemblyState {
  reasonCodes: PromptReasonCode[];
  warnings: string[];
  omissions: PromptOmission[];
  provenance: PromptProvenanceEntry[];
  sections: PromptBudgetSections;
}

export function sectionAllocation(
  sections: PromptBudgetSections,
  name: PromptBudgetSections[number]["section"],
): number {
  return sections.find((entry) => entry.section === name)?.allocatedTokens ?? 0;
}

export function sumInstructionTokens(
  blocks: readonly { id: string; content: string }[],
  includedIds: readonly string[],
  estimator: { estimate(text: string): number },
): number {
  const included = new Set(includedIds);
  return blocks
    .filter((block) => included.has(block.id))
    .reduce((sum, block) => sum + estimator.estimate(block.content), 0);
}
