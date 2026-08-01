import { SuperIntentOptions } from "./types";

const TASK_INTENTS = [
  // Core Implementation
  "bugfix",
  "feature",
  "refactor",
  "optimize",
  // Investigation & Quality
  "diagnose",
  "test",
  "audit",
  "review",
  "security",
  "trace",
  // Architecture & Generation
  "scaffold",
  "migrate",
  "schema",
  "mock",
  // Configuration & Environment
  "config",
  "dependency",
  // Presentation & Docs
  "docs",
  "style",
  "format",
  // General
  "question",
] as const;

const DEFAULT_OPTIONS: SuperIntentOptions = {
  llmWeight: 0.7,
  heuristicRuleWeight: 0.3,

  agreementBonus: 0.05,
  disagreementPenalty: 0.08,

  minimumConfidence: 0.6,
  minimumMargin: 0.15,

  maximumAlternatives: 3,
  maximumSecondaryIntents: 3,
  maximumClarificationOptions: 3,
};

export const INTENT_CONSTANTS = {
  TASK_INTENTS: TASK_INTENTS,
  // Confidence thresholds for intent classification
  HIGH_CONFIDENCE: 0.74,
  LOW_CONFIDENCE: 0.35,
  // Maximum number of alternative intents to consider
  MAX_ALTERNATIVES: 3,
  // Maximum number of secondary task intents allowed
  MAX_SECONDARY: 3,
  SCORE_DEFAULT_OPTIONS: DEFAULT_OPTIONS,
};
