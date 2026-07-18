/**
 * Shared "the user wants a root cause identified" pattern.
 * Kept in one place so ask-mode routing and act/plan task classification
 * agree on what counts as a diagnostic request instead of drifting apart.
 */
export const DIAGNOSTIC_REQUEST =
  /\b(identify (?:the )?(?:issues?|problems?|bugs?|errors?)|find (?:the )?(?:issues?|problems?|bugs?|errors?)|what(?:'s| is) (?:wrong|broken)|why (?:doesn'?t|does ?n'?t|isn'?t|is ?n'?t|won'?t|can'?t|cannot)|diagnose|root cause|investigate why|figure out why|spot (?:the )?(?:issues?|bugs?|problems?)|doesn'?t (?:read|work|load|render|run|start)|does not (?:read|work|load|render|run|start))\b/i;
