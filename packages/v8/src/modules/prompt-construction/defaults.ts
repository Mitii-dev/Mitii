import { PROMPT_SECTIONS } from "./constants";

type PromptSection = (typeof PROMPT_SECTIONS)[number];

/** Default characters-per-token for the local estimator when no port is injected. */
export const DEFAULT_CHARACTERS_PER_TOKEN = 4;

/**
 * Soft share of the input budget per section after output is reserved.
 * Shares are relative weights, not hard floors.
 */
export const DEFAULT_SECTION_WEIGHTS: Readonly<Record<PromptSection, number>> = {
  system: 10,
  rules: 8,
  skills: 4,
  memory: 4,
  plan: 0,
  conversation: 24,
  repository: 36,
  tools: 14,
  output_reserve: 0,
};

/** Keep at least this many recent non-system conversation turns when compacting. */
export const DEFAULT_MIN_CONVERSATION_TURNS = 2;

/** Truncation marker appended when content is compacted by policy. */
export const TRUNCATION_MARKER = "\n…[truncated for context budget]";
