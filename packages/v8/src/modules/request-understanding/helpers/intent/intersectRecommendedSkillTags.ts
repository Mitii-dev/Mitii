/**
 * Closed vocabulary for recommendedSkillTags.
 * Soft boosts only — never sole Skills selection authority.
 */

/** Engine priors always allowed even when catalog tags are empty. */
export const ENGINE_SKILL_TAG_PRIORS = ["localize", "fix"] as const;

/**
 * Baseline closed tags aligned with SDK skill frontmatter + engine priors.
 * Hosts may pass a broader allowlist derived from the loaded catalog.
 */
export const DEFAULT_CLOSED_SKILL_TAGS = [
  ...ENGINE_SKILL_TAG_PRIORS,
  "null",
  "error",
  "debug",
  "triage",
  "systematic",
  "mode-like",
  "root-cause",
  "stop-the-line",
  "incident",
  "logs",
  "ticket",
  "sentry",
  "automation",
  "ci",
  "cicd",
  "github-actions",
  "coverage",
  "pr",
  "workflow",
  "owasp",
  "auth",
  "secrets",
  "validation",
  "hardening",
  "review",
  "quality",
  "severity",
  "merge",
  "tdd",
  "prove-it",
  "regression",
  "red-green",
  "spec",
  "prd",
  "requirements",
  "boundaries",
  "ask",
  "explain",
  "plan",
  "discover",
  "verify",
  "change",
  "tasks",
  "breakdown",
  "acceptance",
  "incremental",
  "slice",
  "feature-flag",
  "rollback",
  "scaffold",
  "git",
  "branch",
  "worktree",
  "semver",
  "versioning",
  "commit",
  "conventional-commits",
  "commit-message",
  "scm",
  "changelog",
  "release",
  "keep-a-changelog",
  "pull-request",
  "summary",
  "release-notes",
  "gh",
  "null-safety",
] as const;

export interface IntersectSkillTagsResult {
  tags: string[];
  dropped: string[];
}

/**
 * Intersect LLM/recommended tags with a closed allowlist.
 * Preserves order, dedupes case-insensitively, caps at maxTags.
 */
export function intersectRecommendedSkillTags(
  tags: readonly string[],
  allowlist: readonly string[] = DEFAULT_CLOSED_SKILL_TAGS,
  maxTags = 10,
): IntersectSkillTagsResult {
  const allowed = new Set(
    allowlist.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0),
  );
  const seen = new Set<string>();
  const kept: string[] = [];
  const dropped: string[] = [];

  for (const raw of tags) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (allowed.has(key)) {
      if (kept.length < maxTags) {
        kept.push(trimmed.slice(0, 64));
      }
    } else {
      dropped.push(trimmed.slice(0, 64));
    }
  }

  return { tags: kept, dropped };
}

/**
 * Merge catalog tags into the default closed vocabulary.
 */
export function buildClosedSkillTagAllowlist(
  catalogTags: readonly string[] = [],
): string[] {
  const merged = new Set<string>();
  for (const tag of [...DEFAULT_CLOSED_SKILL_TAGS, ...catalogTags]) {
    const normalized = tag.trim().toLowerCase();
    if (normalized) merged.add(normalized);
  }
  return [...merged];
}
