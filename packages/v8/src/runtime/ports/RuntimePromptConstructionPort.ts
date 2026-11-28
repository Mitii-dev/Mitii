/**
 * Prompt-construction port (S11-BRIEF) — modules own packing; runtime invokes.
 */

import type {
  PromptConstructionInput,
  PromptConstructionResult,
} from "../../modules/prompt-construction";

export interface RuntimePromptConstructionPort {
  construct(input: PromptConstructionInput): PromptConstructionResult;
}
