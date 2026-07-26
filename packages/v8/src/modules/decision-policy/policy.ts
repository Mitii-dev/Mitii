/**
 * Tunable Decision Policy thresholds and weights.
 * Kept separate from algorithm-local literals.
 */
export const DECISION_POLICY_THRESHOLDS = {
  /** Below this intent confidence, material ambiguity tends toward clarification. */
  lowIntentConfidence: 0.45,
  /** Above this margin, competing intents are treated as clear enough to proceed. */
  minimumIntentMargin: 0.12,
  /** Estimated file count above which multi-file work gets an internal plan. */
  multiFilePlanThreshold: 2,
} as const;

/**
 * Patterns that attempt to broaden authority via user/repository text.
 * Matches never increase grants; they only annotate the decision.
 */
export const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /you\s+now\s+have\s+(full\s+)?(write|admin|root)\s+access/i,
  /disable\s+(all\s+)?approvals?/i,
  /grant\s+yourself\s+(write|network|git)\s+access/i,
  /bypass\s+(tool|permission|grant|approval)\s+checks?/i,
  /exfiltrate\s+(secrets?|credentials?|env)/i,
];
