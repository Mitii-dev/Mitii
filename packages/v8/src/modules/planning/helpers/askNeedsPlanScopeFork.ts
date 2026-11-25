/**
 * Whether findings + A/B/C scope-fork is warranted.
 * Concrete feature/fix/refactor asks must NOT get harness A/B/C chips —
 * even when deterministic clarity was downgraded to "unclear" solely because
 * no file path targets were pinned yet.
 */

export type PlanScopeForkEvidence = {
  clarity?: string;
  primaryIntent?: string;
  requestedOutcomes?: readonly string[];
  query?: string;
};

const MULTI_OUTCOME =
  /\b(?:or|versus|vs\.?|either)\b.{0,80}\b(?:architecture|redesign|harness|corpus|framework)\b|\b(?:architecture|redesign|harness).{0,80}\b(?:or|versus|vs\.?)\b|\b(?:improve|harden).{0,40}\b(?:tests?|cases?).{0,40}\b(?:or|and\/or|\/)\b.{0,40}\b(?:architecture|runner|harness)\b/i;

const EXPLICIT_FORK =
  /\b(?:which scope|pick (?:a|one)|a\/b\/c|focused vs|mvp vs|full matrix)\b/i;

/** Concrete single-outcome delivery language (survives docs misclassification). */
const CONCRETE_DELIVERABLE =
  /\b(?:build|add|ship|implement|create)\b[\s\S]{0,80}\b(?:profiles?|feature|command|endpoint|workflow|runner)\b|\bnpm run\b|\btest:profile\b/i;

/** Short / empty asks cannot override an unclear clarity rating. */
const SUBSTANTIVE_ASK_CHARS = 48;

/**
 * True when the ask truly forks across mutually exclusive scopes.
 * Harness A/B/C is opt-in from fork language — not from clarity alone.
 */
export function askNeedsPlanScopeFork(
  evidence: PlanScopeForkEvidence,
): boolean {
  const clarity = (evidence.clarity ?? "").toLowerCase();
  const blob = [
    evidence.query ?? "",
    ...(evidence.requestedOutcomes ?? []),
  ]
    .join("\n")
    .trim();

  if (!blob) {
    return (
      clarity === "unclear" ||
      clarity === "partially_clear" ||
      clarity === "ambiguous" ||
      clarity !== "clear"
    );
  }

  if (EXPLICIT_FORK.test(blob) || MULTI_OUTCOME.test(blob)) {
    return true;
  }

  const outcomes = (evidence.requestedOutcomes ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (outcomes.length >= 2) {
    const joined = outcomes.join(" | ");
    if (MULTI_OUTCOME.test(joined) || /\bor\b/i.test(joined)) {
      return true;
    }
  }

  const primary = (evidence.primaryIntent ?? "").toLowerCase();
  const substantive = blob.length >= SUBSTANTIVE_ASK_CHARS;
  if (
    substantive &&
    (primary === "feature" ||
      primary === "bugfix" ||
      primary === "refactor" ||
      CONCRETE_DELIVERABLE.test(blob))
  ) {
    // Named deliverable asks (e.g. BillBuddy Run Profiles) stay on
    // discover_and_plan even if intent was mis-tagged docs / clarity unclear.
    return false;
  }

  if (
    clarity === "unclear" ||
    clarity === "partially_clear" ||
    clarity === "ambiguous"
  ) {
    return true;
  }

  return false;
}
