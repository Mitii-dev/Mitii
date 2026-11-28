/**
 * Stable identifiers for Skills.
 */
export const SKILLS_SCHEMA_VERSION = 1 as const;

export const SKILL_SELECTION_STATUSES = [
  "selected",
  "empty",
  "blocked",
] as const;

export const SKILL_OMISSION_REASONS = [
  "budget",
  "required_budget",
  "conflict",
  "not_applicable",
  "not_found",
  "disabled",
  "duplicate",
  "empty_content",
] as const;

export const SKILL_SELECTION_KINDS = [
  "required",
  "preferred",
  "matched",
  "always_apply",
] as const;

export const SKILL_REASON_CODES = [
  "skills_selected",
  "skills_required",
  "skills_required_not_found",
  "skills_required_partial",
  "skills_preferred",
  "no_matching_skills",
  "budget_omitted_skills",
  "skills_compacted",
  "skills_truncated_to_budget",
  "conflicts_resolved",
  "catalog_empty",
  "catalog_l1_included",
] as const;

export type SkillReasonCodeConst = (typeof SKILL_REASON_CODES)[number];

/** Named reason-code accessors — never build codes with string templates. */
export const SKILL_REASON = {
  selected: "skills_selected",
  required: "skills_required",
  requiredNotFound: "skills_required_not_found",
  requiredPartial: "skills_required_partial",
  preferred: "skills_preferred",
  noMatching: "no_matching_skills",
  budgetOmitted: "budget_omitted_skills",
  compacted: "skills_compacted",
  truncatedToBudget: "skills_truncated_to_budget",
  conflictsResolved: "conflicts_resolved",
  catalogEmpty: "catalog_empty",
  catalogL1Included: "catalog_l1_included",
} as const satisfies Record<string, SkillReasonCodeConst>;

/** Maximum explicitly attached skills per run (prompt, CLI, or host field). */
export const MAX_REQUIRED_SKILLS = 3;

/** Soft-preferred skill ids (Engine size/route boost); missing ids are ignored. */
export const MAX_PREFERRED_SKILLS = 3;

export const SKILLS_ERROR_CODES = [
  "invalid_input",
  "misconfigured_ports",
  "catalog_failed",
] as const;

export const SKILLS_MESSAGES = {
  catalogRequired: "SkillsPipeline requires a catalog port.",
  selectInputInvalid: "Skills select input failed schema validation.",
  catalogLoadFailed: "Skills catalog failed to load.",
  hydrateBodyFailed: (skillId: string) =>
    `Skills catalog failed to hydrate body for ${skillId}.`,
  requiredMissing: "One or more required skills were not found in the catalog.",
  excludedMatched: (count: number) =>
    `Excluded ${count} auto-matched skill(s) for this run.`,
  nonMatched: (nonMatched: number, catalogSize: number) =>
    `${nonMatched} of ${catalogSize} catalog skill(s) did not match this request (path/intent/route/keyword/threshold) and were not considered.`,
  compacted:
    "One or more selected skills used compact metadata because the full playbook exceeded the skills budget.",
  truncated:
    "One or more selected skills were truncated to fit the remaining skills budget.",
} as const;

/** Ordered flow stage names for SkillsPipeline.select (+ logger). */
export const SKILLS_STAGES = {
  resolveRequired: "1-resolve-required",
  resolvePreferred: "2-resolve-preferred",
  matchSkills: "3-match-skills",
  mergeCandidates: "4-merge-candidates",
  resolveConflicts: "5-resolve-conflicts",
  applyBudget: "6-apply-budget",
  parseMentions: "7-parse-mentions",
  mapUnderstandingEvidence: "8-map-understanding-evidence",
  deriveRepoEvidence: "9-derive-repo-evidence",
  formatPromptContent: "10-format-prompt-content",
} as const;

export type SkillsStageName =
  (typeof SKILLS_STAGES)[keyof typeof SKILLS_STAGES];
