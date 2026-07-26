/**
 * Tunable Prompt Construction thresholds.
 * Kept separate from algorithm-local literals.
 */
export const PROMPT_CONSTRUCTION_THRESHOLDS = {
  /**
   * Fraction of the provider context window reserved for model output
   * before any optional input sections are filled.
   */
  outputReserveRatio: 0.15,

  /** Absolute floor for output reserve tokens when the window is large enough. */
  minimumOutputReserveTokens: 256,

  /** Absolute ceiling for output reserve (still capped by provider max output). */
  maximumOutputReserveTokens: 8_192,

  /** Soft minimum tokens retained for the required system safety preamble. */
  minimumSystemTokens: 200,

  /** Soft minimum tokens retained for the current user request. */
  minimumUserRequestTokens: 64,

  /** When compacting conversation, truncate older tool results to this many chars. */
  compactedToolResultCharacters: 600,

  /** Maximum repository blocks serialized even when budget remains. */
  maximumRepositoryBlocks: 48,
} as const;

/**
 * Patterns that attempt to smuggle authority through repository or tool text.
 * Matches never become instructions; content stays wrapped as untrusted evidence.
 */
export const UNTRUSTED_CONTENT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /you\s+now\s+have\s+(full\s+)?(write|admin|root)\s+access/i,
  /disable\s+(all\s+)?approvals?/i,
  /grant\s+yourself\s+(write|network|git)\s+access/i,
  /bypass\s+(tool|permission|grant|approval)\s+checks?/i,
  /system\s*:\s*you\s+are/i,
];
