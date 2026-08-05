import { DEFAULT_CHARACTERS_PER_TOKEN } from "../defaults";
import type { SkillDescriptor, SkillsSelectParsedInput } from "../contracts";
import { SKILLS_THRESHOLDS } from "../policy";

export interface ScoredSkill {
  skill: SkillDescriptor;
  score: number;
  reasons: string[];
}

/**
 * Score catalog entries against task evidence, route, and query keywords.
 */
export function matchSkills(params: {
  catalog: readonly SkillDescriptor[];
  input: SkillsSelectParsedInput;
}): ScoredSkill[] {
  const { catalog, input } = params;
  const queryTokens = tokenize(input.query);
  const scored: ScoredSkill[] = [];

  for (const skill of catalog) {
    if (!skill.content.trim()) {
      continue;
    }
    if (!isPathGateSatisfied(skill, input)) {
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

    if (skill.tags.length > 0 && queryTokens.size > 0) {
      const tagHits = skill.tags.filter((tag) =>
        queryTokens.has(tag.toLowerCase()),
      ).length;
      if (tagHits > 0) {
        const fraction = tagHits / skill.tags.length;
        score += SKILLS_THRESHOLDS.keywordWeight * fraction;
        reasons.push("keyword");
      }
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

    const normalized = Math.min(1, score);
    if (
      !skill.alwaysApply &&
      normalized < SKILLS_THRESHOLDS.minimumMatchScore
    ) {
      continue;
    }

    scored.push({ skill, score: normalized, reasons });
  }

  return scored.sort((a, b) => {
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
  skill: SkillDescriptor,
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
