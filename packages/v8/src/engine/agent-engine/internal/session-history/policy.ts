/**
 * Session-history retrieve policy (Mitii hybrid over OpenCode dual-store archive).
 * Mirrors memory RRF defaults without importing memory module internals.
 */
export const SESSION_HISTORY_POLICY = {
  /** Reciprocal rank fusion k (memory / repo hybrid convention). */
  rrfK: 60,
  lexicalStreamWeight: 0.55,
  locatorStreamWeight: 0.35,
  recencyStreamWeight: 0.1,
  /** Max hits packed into one projection checkpoint. */
  maxHits: 8,
  /** Soft diversify: max hits per toolName / role bucket. */
  maxPerSource: 3,
  /**
   * OpenCode keep.tokens analogue: prefer not to drown recent live turns.
   * Hybrid projection chars default to this fraction of conversationTokens
   * when conversationTokens is supplied; else droppedTurnSummaryChars.
   */
  conversationShareFraction: 0.35,
  /** Absolute floor/ceiling for projection body (chars). */
  projectionCharsMin: 800,
  projectionCharsMax: 12_000,
  /** Skip retrieve when query is shorter than this (non-referential noise). */
  minQueryChars: 8,
  /**
   * Referential cues that bias toward archive retrieve even without compaction
   * this turn (Mitii: long-session follow-ups).
   */
  referentialPatterns: [
    /\bearlier\b/i,
    /\bbefore\b/i,
    /\bas we (said|discussed|found|agreed)\b/i,
    /\byou (said|mentioned|found|told)\b/i,
    /\bprevious(ly)?\b/i,
    /\bremind me\b/i,
    /\bthat file\b/i,
    /\bthe (hook|decision|finding|approach)\b/i,
  ],
} as const;

export const SESSION_HISTORY_PROJECTION_MARKERS = {
  start: "<session_history_checkpoint>",
  end: "</session_history_checkpoint>",
  summaryTag: "summary",
  hitTag: "recalled_turn",
} as const;
