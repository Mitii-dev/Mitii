/**
 * Budget drop order for ContextBundle slices (§11.2) — table-driven, generic.
 * Lower priority number = drop first when over section budget.
 */

export const ENRICH_OMISSION_PRIORITY = [
  "broad_repo",
  "optional_skills",
  "memory",
  "focused_repo",
  "required_skills",
  "handoff_peaks",
  "decision_brief",
  "project_rules",
] as const;

export type EnrichOmissionKind = (typeof ENRICH_OMISSION_PRIORITY)[number];

/** Never omit these for budget alone — seals / objective stay. */
export const ENRICH_OMISSION_PROTECTED: ReadonlySet<EnrichOmissionKind> =
  new Set(["project_rules", "decision_brief", "handoff_peaks"]);

export function omissionPriorityIndex(kind: EnrichOmissionKind): number {
  return ENRICH_OMISSION_PRIORITY.indexOf(kind);
}
