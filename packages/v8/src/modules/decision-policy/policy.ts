/**
 * Tunable Decision Policy thresholds and weights.
 * Kept separate from algorithm-local literals.
 */
export const DECISION_POLICY_THRESHOLDS = {
  /** Below this intent confidence, material ambiguity tends toward clarification. */
  lowIntentConfidence: 0.45,
  /**
   * When understanding already set needsClarification, still ask if confidence
   * is below this (covers investigate-vs-fix forks around ~0.6).
   */
  clarifyWhenFlaggedBelowConfidence: 0.75,
  /** Above this margin, competing intents are treated as clear enough to proceed. */
  minimumIntentMargin: 0.12,
  /** Estimated file count above which multi-file work gets an internal plan. */
  multiFilePlanThreshold: 2,
  /**
   * Estimated files above which execute grants use a tight mutation budget
   * (smaller apply_patch batches to stay under provider output limits).
   */
  largeMutationFileThreshold: 8,
} as const;

/**
 * Mutation batch budgets attached to write grants.
 * Tool Runtime enforces the hard caps; Engine prompts preferredBatchSize.
 */
export const MUTATION_BUDGET_PROFILES = {
  /** Localized single-file / small edits — still capped to protect output tokens. */
  relaxed: {
    maxPatchesPerCall: 48,
    maxUniqueFilesPerCall: 32,
    maxPatchPayloadCharacters: 80_000,
    preferredBatchSize: 12,
    requireBatchedExecution: false,
  },
  /** Default agent execute path. */
  standard: {
    maxPatchesPerCall: 36,
    maxUniqueFilesPerCall: 24,
    maxPatchPayloadCharacters: 48_000,
    preferredBatchSize: 8,
    requireBatchedExecution: false,
  },
  /** Large / multi-file / high-complexity refactors — batch, but do not shrink below window effort. */
  tight: {
    maxPatchesPerCall: 16,
    maxUniqueFilesPerCall: 12,
    maxPatchPayloadCharacters: 32_000,
    preferredBatchSize: 8,
    requireBatchedExecution: true,
  },
} as const;

/**
 * Patterns that attempt to broaden authority via user/repository text.
 * Matches never increase grants; they only annotate the decision.
 */
export const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|system)\s+(instructions|rules|policies)/i,
  /you\s+now\s+have\s+(full\s+)?(write|admin|root)\s+access/i,
  /disable\s+(all\s+)?approvals?/i,
  /grant\s+yourself\s+(write|network|git|admin|root)\s+access/i,
  /bypass\s+(tool|permission|grant|approval|safety)\s+checks?/i,
  /exfiltrate\s+(secrets?|credentials?|env|api\s*keys?)/i,
  /(?:sudo|root)\s+mode\s+(?:enabled|on|activated)/i,
  /(?:jailbreak|dan\s+mode|developer\s+mode)\b/i,
  /override\s+(?:the\s+)?(?:system|safety|security)\s+(?:prompt|policy|rules?)/i,
  /do\s+not\s+ask\s+for\s+(?:permission|approval)/i,
  /pretend\s+(?:you\s+)?(?:have|are)\s+(?:unrestricted|no)\s+(?:access|limits?)/i,
  /act\s+as\s+if\s+(?:safety|permission|grant)\s+(?:rules?|checks?)\s+(?:do\s+not|don't)\s+exist/i,
];
