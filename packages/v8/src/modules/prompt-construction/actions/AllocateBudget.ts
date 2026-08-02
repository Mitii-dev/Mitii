import type { ModelCapabilities } from "../../model-gateway";

import { PROMPT_SECTIONS } from "../constants";
import { DEFAULT_SECTION_WEIGHTS } from "../defaults";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../policy";
import type { PromptSection, PromptSectionBudget } from "../contracts";

export interface BudgetAllocation {
  contextWindowTokens: number;
  outputReservedTokens: number;
  inputBudgetTokens: number;
  sections: PromptSectionBudget[];
}

export function allocateBudget(params: {
  capabilities: ModelCapabilities;
  outputReserveTokens?: number;
}): BudgetAllocation {
  const { capabilities, outputReserveTokens } = params;
  const contextWindowTokens = capabilities.contextWindowTokens;

  const ratioReserve = Math.floor(
    contextWindowTokens * PROMPT_CONSTRUCTION_THRESHOLDS.outputReserveRatio,
  );
  const derivedReserve = clamp(
    Math.max(
      ratioReserve,
      PROMPT_CONSTRUCTION_THRESHOLDS.minimumOutputReserveTokens,
    ),
    PROMPT_CONSTRUCTION_THRESHOLDS.minimumOutputReserveTokens,
    Math.min(
      capabilities.maximumOutputTokens,
      Math.max(1, contextWindowTokens - 1),
    ),
  );

  const outputReservedTokens = clamp(
    outputReserveTokens ?? derivedReserve,
    1,
    Math.min(capabilities.maximumOutputTokens, contextWindowTokens - 1),
  );

  const inputBudgetTokens = Math.max(
    0,
    contextWindowTokens - outputReservedTokens,
  );

  const weightEntries = PROMPT_SECTIONS.filter(
    (section) => section !== "output_reserve",
  ).map((section) => ({
    section,
    weight: DEFAULT_SECTION_WEIGHTS[section],
  }));
  const totalWeight = weightEntries.reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );

  const sections: PromptSectionBudget[] = [
    {
      section: "output_reserve",
      allocatedTokens: outputReservedTokens,
      usedTokens: 0,
      omittedTokens: 0,
      truncatedTokens: 0,
    },
    ...weightEntries.map(({ section, weight }) => ({
      section,
      allocatedTokens:
        totalWeight === 0
          ? 0
          : Math.floor((inputBudgetTokens * weight) / totalWeight),
      usedTokens: 0,
      omittedTokens: 0,
      truncatedTokens: 0,
    })),
  ];

  return {
    contextWindowTokens,
    outputReservedTokens,
    inputBudgetTokens,
    sections,
  };
}

export function updateSectionBudget(
  sections: PromptSectionBudget[],
  section: PromptSection,
  patch: Partial<
    Pick<
      PromptSectionBudget,
      "usedTokens" | "omittedTokens" | "truncatedTokens" | "allocatedTokens"
    >
  >,
): PromptSectionBudget[] {
  return sections.map((entry) =>
    entry.section === section ? { ...entry, ...patch } : entry,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
