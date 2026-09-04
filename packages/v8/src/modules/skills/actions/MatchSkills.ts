import { DEFAULT_CHARACTERS_PER_TOKEN } from "../defaults";
import type { SkillIndexEntry, SkillsSelectParsedInput } from "../contracts";
import type { SkillSimilarityPort } from "../contracts/ports/SkillSimilarityPort";
import { SKILLS_THRESHOLDS } from "../policy";
import type { SKILL_SELECTION_KINDS } from "../constants";

export type SkillSelectionKind = (typeof SKILL_SELECTION_KINDS)[number];

export interface ScoredSkill {
  skill: SkillIndexEntry;
  score: number;
  reasons: string[];
  selection?: SkillSelectionKind;
}

export interface MatchSkillsResult {
  scored: ScoredSkill[];
  /**
   * Catalog entries that never became a scored candidate (path gate,
   * applicability, or below minimumMatchScore) — distinct from `omissions`
   * elsewhere in the pipeline, which only covers budget/conflict/duplicate
   * drops of already-applicable skills. Without this, "why didn't skill X
   * load" is undiagnosable for the common non-match case.
   */
  nonMatchedCount: number;
}

/**
 * Score catalog entries against task evidence, route, and query keywords.
 */
export async function matchSkills(params: {
  catalog: readonly SkillIndexEntry[];
  input: SkillsSelectParsedInput;
  similarity?: SkillSimilarityPort;
}): Promise<MatchSkillsResult> {
  const { catalog, input, similarity } = params;
  const queryTokens = tokenize(input.query);
  const scored: ScoredSkill[] = [];
  let nonMatchedCount = 0;

  for (const skill of catalog) {
    if (!isPathGateSatisfied(skill, input)) {
      nonMatchedCount += 1;
      continue;
    }

    let score = 0;
    const reasons: string[] = [];

    if (skill.alwaysApply) {
      score += SKILLS_THRESHOLDS.alwaysApplyBaseScore;
      reasons.push("always_apply");
    }

    if (skill.intents.length > 0) {
      if (skill.intents.includes(input.evidence.primaryIntent)) {
        score += SKILLS_THRESHOLDS.primaryIntentWeight;
        reasons.push("primary_intent");
      } else if (
        input.evidence.secondaryIntents.some((intent) =>
          skill.intents.includes(intent),
        )
      ) {
        score += SKILLS_THRESHOLDS.secondaryIntentWeight;
        reasons.push("secondary_intent");
      }
    }

    if (skill.routes.length > 0) {
      if (skill.routes.includes(input.route)) {
        score += SKILLS_THRESHOLDS.routeWeight;
        reasons.push("route");
      }
    }

    const keywordScore = scoreKeywordOverlap(skill, queryTokens);
    if (keywordScore > 0) {
      score += SKILLS_THRESHOLDS.keywordWeight * keywordScore;
      reasons.push("keyword");
    }
    if (skill.paths.length > 0) {
      score += SKILLS_THRESHOLDS.pathWeight;
      reasons.push("path");
    }

    const hasIntentMatch =
      reasons.includes("primary_intent") ||
      reasons.includes("secondary_intent");
    const hasRouteMatch = reasons.includes("route");

    // Intent-scoped skills require an intent hit; route/keyword only boost.
    // Route-scoped skills (no intents) require a route hit.
    // Unscoped skills may load from keyword overlap alone.
    // When a skill declares routes, do not apply it on incompatible routes
    // (e.g. ask-concise on execute, or spec-driven on direct_answer).
    const routeCompatible =
      skill.routes.length === 0 || hasRouteMatch || skill.alwaysApply;
    const applicable =
      skill.alwaysApply ||
      (routeCompatible &&
        (skill.intents.length > 0
          ? hasIntentMatch
          : skill.routes.length > 0
            ? hasRouteMatch
            : reasons.includes("keyword")));

    if (!applicable) {
      nonMatchedCount += 1;
      continue;
    }

    // Soft understanding tags boost score only after applicability is earned.
    const recommendedTags = input.evidence.recommendedSkillTags ?? [];
    if (skill.tags.length > 0 && recommendedTags.length > 0) {
      const recommended = new Set(
        recommendedTags.map((tag) => tag.toLowerCase()),
      );
      const hits = skill.tags.filter((tag) =>
        recommended.has(tag.toLowerCase()),
      ).length;
      if (hits > 0) {
        score +=
          SKILLS_THRESHOLDS.recommendedTagWeight * (hits / skill.tags.length);
        reasons.push("recommended_tag");
      }
    }
    const languageBoost = overlapBoost(
      skill.languages,
      input.evidence.languages,
    );
    if (languageBoost > 0) {
      score += SKILLS_THRESHOLDS.recommendedTagWeight * languageBoost;
      reasons.push("language");
    }
    const projectKindBoost = overlapBoost(
      skill.projectKinds,
      input.evidence.projectKinds,
    );
    if (projectKindBoost > 0) {
      score += SKILLS_THRESHOLDS.recommendedTagWeight * projectKindBoost;
      reasons.push("project_kind");
    }

    if (similarity) {
      const similarityScore = await Promise.resolve(
        similarity.score(input.query, {
          id: skill.id,
          title: skill.title,
          description: skill.description,
          tags: skill.tags,
        }),
      );
      if (similarityScore > 0) {
        score +=
          SKILLS_THRESHOLDS.similarityWeight * Math.min(1, similarityScore);
        reasons.push("similarity");
      }
    }

    const normalized = Math.min(1, score);
    if (
      !skill.alwaysApply &&
      normalized < SKILLS_THRESHOLDS.minimumMatchScore
    ) {
      nonMatchedCount += 1;
      continue;
    }

    scored.push({
      skill,
      score: normalized,
      reasons,
      selection: skill.alwaysApply ? "always_apply" : "matched",
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Soft understanding tags break ties only among already-applicable skills.
    const aRecommended = a.reasons.includes("recommended_tag") ? 1 : 0;
    const bRecommended = b.reasons.includes("recommended_tag") ? 1 : 0;
    if (bRecommended !== aRecommended) {
      return bRecommended - aRecommended;
    }
    if (b.skill.priority !== a.skill.priority) {
      return b.skill.priority - a.skill.priority;
    }
    return a.skill.id.localeCompare(b.skill.id);
  });

  return { scored, nonMatchedCount };
}

export function estimateTokens(content: string): number {
  return Math.max(
    1,
    Math.ceil(content.length / DEFAULT_CHARACTERS_PER_TOKEN),
  );
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_+.-]+/i)
      .filter((token) => token.length >= 2),
  );
}

function isPathGateSatisfied(
  skill: SkillIndexEntry,
  input: SkillsSelectParsedInput,
): boolean {
  if (skill.paths.length === 0) {
    return true;
  }
  const evidencePaths = input.evidence.paths ?? [];
  if (evidencePaths.length === 0) {
    return false;
  }
  return skill.paths.some((pattern) =>
    evidencePaths.some((path) => matchesPathGlob(pattern, path)),
  );
}

function scoreKeywordOverlap(
  skill: SkillIndexEntry,
  queryTokens: ReadonlySet<string>,
): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  const searchable = tokenize(
    [
      skill.title,
      skill.description,
      ...skill.tags,
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (searchable.size === 0) {
    return 0;
  }
  let hits = 0;
  for (const token of searchable) {
    if (queryTokens.has(token)) {
      hits += 1;
    }
  }
  return hits === 0 ? 0 : Math.min(1, hits / Math.min(searchable.size, 6));
}

function overlapBoost(
  skillValues: readonly string[] | undefined,
  evidenceValues: readonly string[] | undefined,
): number {
  if (!skillValues?.length || !evidenceValues?.length) {
    return 0;
  }
  const evidence = new Set(evidenceValues.map((value) => value.toLowerCase()));
  const hits = skillValues.filter((value) =>
    evidence.has(value.toLowerCase()),
  ).length;
  return hits === 0 ? 0 : hits / skillValues.length;
}

export function matchesPathGlob(pattern: string, path: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(path);
  if (!normalizedPattern || !normalizedPath) {
    return false;
  }
  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
