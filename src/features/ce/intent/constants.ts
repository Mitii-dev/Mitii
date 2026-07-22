const TASK_INTENTS = [
  // Core Implementation
  'bugfix',
  'feature',
  'refactor',
  'optimize',
  // Investigation & Quality
  'diagnose',
  'test',
  'audit',
  'review',
  'security',
  'trace',
  // Architecture & Generation
  'scaffold',
  'migrate',
  'schema',
  'mock',
  // Configuration & Environment
  'config',
  'dependency',
  // Presentation & Docs
  'docs',
  'style',
  'format',
  // General
  'question',
] as const;

export const INTENT_CONSTANTS = {
  TASK_INTENTS: TASK_INTENTS,
  // Confidence thresholds for intent classification
  HIGH_CONFIDENCE: 0.74,
  LOW_CONFIDENCE: 0.35,

  // Maximum number of alternative intents to consider
  MAX_ALTERNATIVES: 3,

  // Maximum number of secondary task intents allowed
  MAX_SECONDARY: 3,
};