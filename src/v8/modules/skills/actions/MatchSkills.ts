import { DEFAULT_CHARACTERS_PER_TOKEN } from "../defaults";
import type { SkillDescriptor } from "../contracts";
import type { SkillsSelectInput } from "../contracts";
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
  input: SkillsSelectInput;
}): ScoredSkill[] {
  const { catalog, input } = params;
  const queryTokens = tokenize(input.query);
  const scored: ScoredSkill[] = [];

  for (const skill of catalog) {
    if (!skill.content.trim()) {
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
    } else if (!skill.alwaysApply && skill.intents.length === 0) {
      // Untagged skills are only loaded via keyword overlap.
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

    const applicable =
      skill.alwaysApply ||
      reasons.includes("primary_intent") ||
      reasons.includes("secondary_intent") ||
      reasons.includes("route") ||
      reasons.includes("keyword");

    if (!applicable) {
      continue;
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
