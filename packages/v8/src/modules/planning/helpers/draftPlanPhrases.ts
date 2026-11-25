import { isRepairIntentTaxonomy } from "../../decision-policy";
import type { PlanningTaskEvidence } from "../contracts";
import { clipPhrase } from "./draftPlanShared";

export function isPronounOnlyFollowUp(text: string): boolean {
  return /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:fix|update|change|check|do|handle|implement)\s+(?:it|this|that)\b/i.test(
    text,
  ) || text.length < 8;
}

export function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function specializeIntent(
  summary: string,
  targetRefs: readonly string[],
): string {
  const trimmed = summary.trim();
  if (targetRefs.length === 0) {
    return clipPhrase(trimmed, 200);
  }
  const first = targetRefs[0]!;
  if (trimmed.includes(first) || /\b(?:in|at|for|from)\s+\S+/i.test(trimmed)) {
    return clipPhrase(trimmed, 200);
  }
  return clipPhrase(`${trimmed}${scopeLabel(targetRefs)}`, 200);
}

export function scopeLabel(targetRefs: readonly string[]): string {
  const refs = targetRefs
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 3);
  if (refs.length === 0) return "";
  if (refs.length === 1) return ` in ${refs[0]}`;
  if (refs.length === 2) return ` in ${refs[0]} and ${refs[1]}`;
  return ` in ${refs[0]} (+${refs.length - 1} more)`;
}

export function intentActionVerb(primaryIntent: string): string {
  const intent = primaryIntent.trim().toLowerCase();
  if (intent.includes("bug") || intent.includes("fix")) return "Fix";
  if (intent.includes("refactor")) return "Refactor";
  if (intent.includes("migrat")) return "Migrate";
  if (intent.includes("test")) return "Cover";
  if (intent.includes("config") || intent.includes("depend")) return "Update";
  if (intent.includes("docs")) return "Document";
  if (intent.includes("secur")) return "Harden";
  if (intent.includes("optim")) return "Optimize";
  return "Implement";
}

export function actionAwareIntent(
  verb: string,
  shortObjective: string,
  scope: string,
): string {
  const scopedObjective = shortObjective.includes(scope.trim()) || !scope
    ? shortObjective
    : /\b(?:in|at|for|from)\s+\S+/i.test(shortObjective)
      ? shortObjective
      : `${shortObjective}${scope}`;
  if (
    new RegExp(`^${escapeRegExp(verb)}\\b`, "i").test(scopedObjective) ||
    /^(?:fix|implement|add|update|resolve|refactor|migrate)\b/i.test(
      scopedObjective,
    )
  ) {
    return clipPhrase(scopedObjective, 200);
  }
  return clipPhrase(`${verb} ${scopedObjective}`, 200);
}

export function shouldIncludeVerifyPhase(
  evidence: PlanningTaskEvidence,
): boolean {
  // Dimension-driven: honor explicit false except for repair intents.
  if (evidence.recommendsVerification === false) {
    return isRepairIntent(evidence);
  }
  return true;
}

/**
 * Repair-shaped work from request-understanding intent taxonomy only.
 * No language/tool/provider keyword sniffing. Shared predicate — see
 * decision-policy's `isRepairIntentTaxonomy` (also used by Decision Policy's
 * preflight gate and Planning's strategy rules).
 */
export function isRepairIntent(evidence: PlanningTaskEvidence): boolean {
  return isRepairIntentTaxonomy([
    evidence.primaryIntent,
    ...evidence.secondaryIntents,
  ]);
}

/**
 * Strip chat @-mention markers from user/outcome text while keeping the path.
 * Never delete destination package paths from phrases like
 * "Create packages/mui-builder as a full port of …".
 */
export function sanitizeUserPhrase(
  value: string,
  _targetRefs: readonly string[] = [],
): string {
  let text = value.replace(/\r\n/g, "\n").trim();
  // Hosts attach paths as @packages/foo — keep the path, drop only the @.
  text = text.replace(/(^|[\s(,])@(?=[\w./\\-])/g, "$1");
  // Collapse duplicate blank lines / spaces from mention cleanup.
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[^\S\n]{2,}/g, " ").trim();
  // Drop leftover punctuation-only crumbs.
  text = text.replace(/^[,:;.\-_/]+/, "").replace(/[,:;.\-_/]+$/, "").trim();
  return text;
}

export function pickPreferredPhrase(candidates: readonly string[]): string | undefined {
  if (candidates.length === 0) return undefined;
  const scored = candidates.map((phrase, index) => ({
    phrase,
    score:
      phrase.length +
      (/^(?:fix|resolve|add|implement|update|remove|refactor)\b/i.test(phrase)
        ? 40
        : 0) -
      (phrase.includes("@") ? 50 : 0) -
      index,
  }));
  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.phrase;
}

export function normalizePhraseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
