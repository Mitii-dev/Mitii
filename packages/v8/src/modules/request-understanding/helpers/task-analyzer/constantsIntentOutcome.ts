import type { TaskIntent } from "../intent/types";

/**
 * INTENT-BASED DEFAULTS
 */

export const VERIFICATION_REQUIRED = [
  "bugfix",
  "feature",
  "refactor",
  "optimize",
  "test",
  "security",
  "scaffold",
  "migrate",
  "schema",
  "mock",
  "config",
  "dependency",
  "docs",
  "style",
  "format",
] as const satisfies readonly TaskIntent[];

export const PLANNING_RECOMMENDED = [
  "feature",
  "refactor",
  "optimize",
  "security",
  "scaffold",
  "migrate",
  "schema",
  "config",
] as const satisfies readonly TaskIntent[];

export const REPOSITORY_DEPENDENT = [
  "bugfix",
  "feature",
  "refactor",
  "optimize",
  "diagnose",
  "test",
  "audit",
  "review",
  "security",
  "trace",
  "migrate",
  "schema",
  "config",
  "dependency",
  "docs",
  "style",
  "format",
] as const satisfies readonly TaskIntent[];

export const ACTION_AT_START_PATTERN =
  /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|i\s+want\s+you\s+to\s+|i\s+need\s+you\s+to\s+|i\s+need\s+|we\s+need\s+to\s+|let(?:'s|\s+us)\s+)?(implement|build|create|add|fix|resolve|repair|patch|migrate|refactor|rewrite|convert|integrate|configure|optimize|redesign|replace|remove|delete|update|modify|generate|document|deploy|test|validate|verify|review|audit|analyze|diagnose|investigate|troubleshoot|explain|compare|identify|find|trace|format|style|scaffold|install|upgrade|downgrade|rename|extract|restructure|reorganize|plan|outline|propose)\b/i;

export const OUTCOME_CONNECTOR_PATTERN =
  /\s*(?:,?\s+\band\s+then\b\s+|,?\s+\bthen\b\s+|;\s*|\n+|,\s+(?=(?:and\s+)?(?:implement|build|create|add|fix|resolve|repair|patch|migrate|refactor|rewrite|convert|integrate|configure|optimize|redesign|replace|remove|delete|update|modify|generate|document|deploy|test|validate|verify|review|audit|analyze|diagnose|investigate|troubleshoot|explain|compare|identify|find|trace|format|style|scaffold|install|upgrade|downgrade|rename|extract|restructure|reorganize|plan|outline|propose)\b)|\s+\band\b\s+(?=(?:also\s+)?(?:implement|build|create|add|fix|resolve|repair|patch|migrate|refactor|rewrite|convert|integrate|configure|optimize|redesign|replace|remove|delete|update|modify|generate|document|deploy|test|validate|verify|review|audit|analyze|diagnose|investigate|troubleshoot|explain|compare|identify|find|trace|format|style|scaffold|install|upgrade|downgrade|rename|extract|restructure|reorganize|plan|outline|propose)\b))/gi;

export const SENTENCE_BOUNDARY_PATTERN = /[.!?]+(?:\s+|$)/g;

export const POLITE_PREFIX_PATTERN =
  /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|will\s+you\s+|i\s+want\s+you\s+to\s+|i\s+would\s+like\s+you\s+to\s+|i\s+need\s+you\s+to\s+|i\s+need\s+|we\s+need\s+to\s+|we\s+should\s+|let(?:'s|\s+us)\s+)/i;

export const LEADING_CONNECTOR_PATTERN =
  /^(?:and\s+then|then|and|also|next|after\s+that)\s+/i;

export const TRAILING_CONNECTOR_PATTERN =
  /\s+(?:and\s+then|then|and|also|next|after\s+that)$/i;

export const NEGATED_ACTION_PATTERN =
  /\b(?:do not|don't|dont|never|avoid|without)\s+(?:trying\s+to\s+)?(?:implement|build|create|add|fix|resolve|repair|patch|migrate|refactor|rewrite|convert|integrate|configure|optimize|redesign|replace|remove|delete|update|modify|generate|document|deploy|test|validate|verify|format|style|install|upgrade|downgrade|rename)\b/i;

export const QUESTION_PREFIX_PATTERN = /^(?:how|why|what|where|when|which|who)\b/i;

export const ACKNOWLEDGEMENT_PATTERN =
  /^(?:hi|hello|hey|thanks|thank\s+you|ok|okay|got\s+it|makes\s+sense)[\s.!?,]*$/i;

export const OUTCOME_ACTION_PATTERN =
  /\b(?:implement|build|create|add|fix|resolve|repair|patch|migrate|refactor|rewrite|convert|integrate|configure|optimize|redesign|replace|remove|delete|update|modify|generate|document|deploy|test|validate|verify|review|audit|analyze|diagnose|investigate|troubleshoot|explain|compare|identify|find|trace|format|style|scaffold|install|upgrade|downgrade|rename|extract|restructure|reorganize|plan|outline|propose)\b/i;
