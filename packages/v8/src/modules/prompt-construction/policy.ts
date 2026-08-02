/**
 * Tunable Prompt Construction thresholds.
 * Kept separate from algorithm-local literals.
 */
export const PROMPT_CONSTRUCTION_THRESHOLDS = {
  /**
   * Fraction of the provider context window reserved for model output
   * before any optional input sections are filled.
   */
  outputReserveRatio: 0.3,

  /** Absolute floor for output reserve tokens when the window is large enough. */
  minimumOutputReserveTokens: 4_096,

  /** Soft minimum tokens retained for the required system safety preamble. */
  minimumSystemTokens: 200,

  /** Soft minimum tokens retained for the current user request. */
  minimumUserRequestTokens: 64,

  /** When compacting conversation, truncate older tool results to this many chars. */
  compactedToolResultCharacters: 400,

  /**
   * Keep this many most-recent tool results fully intact when compacting;
   * older tool messages are truncated to compactedToolResultCharacters.
   */
  compactedToolResultKeepRecent: 3,

  /**
   * Soft fraction of maximumOutputTokens used as a headroom hint for
   * estimated mutation payloads (Agent Engine preflight / recovery).
   */
  mutationOutputHeadroomRatio: 0.7,
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
