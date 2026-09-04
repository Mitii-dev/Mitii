import type {
  SkillDescriptor,
  SkillInstructionBlock,
  SkillOmission,
} from "../contracts";
import { DEFAULT_CHARACTERS_PER_TOKEN } from "../defaults";
import { SKILLS_THRESHOLDS } from "../policy";
import { estimateTokens, type ScoredSkill } from "./MatchSkills";

const TRUNCATION_MARKER = "\n…(skill truncated to budget)";

export type HydratedScoredSkill = Omit<ScoredSkill, "skill"> & {
  skill: SkillDescriptor;
  /** Compact L1 body when distinct from the hydrated playbook. */
  compactContent?: string;
};

/**
 * Apply the dedicated skills token budget and max count.
 *
 * Packing is rank-preserving: a higher-ranked skill is never dropped solely
 * so a smaller later skill can take its slot. When the full body does not
 * fit, a distinct compact body is used (or truncated) before omitting.
 */
export function applySkillBudget(params: {
  scored: readonly HydratedScoredSkill[];
  budgetTokens: number;
  maxSkills: number;
}): {
  instructions: SkillInstructionBlock[];
  omissions: SkillOmission[];
  usedTokens: number;
  budgetOmitted: boolean;
  compacted: boolean;
  truncated: boolean;
} {
  const instructions: SkillInstructionBlock[] = [];
  const omissions: SkillOmission[] = [];
  let usedTokens = 0;
  let budgetOmitted = false;
  let compacted = false;
  let truncated = false;
  let remaining = params.budgetTokens;
  let selectedMatchSkills = 0;
  const minUseful = SKILLS_THRESHOLDS.minUsefulSkillTokens;

  for (const entry of params.scored) {
    const exemptFromMaxSkills =
      entry.skill.alwaysApply || entry.selection === "required";
    if (!exemptFromMaxSkills && selectedMatchSkills >= params.maxSkills) {
      omissions.push({
        skillId: entry.skill.id,
        reason: "budget",
        tokens: estimateTokens(entry.skill.content),
      });
      budgetOmitted = true;
      continue;
    }

    const fullContent = entry.skill.content.trim();
    if (!fullContent) {
      omissions.push({ skillId: entry.skill.id, reason: "empty_content" });
      continue;
    }

    const compactContent = entry.compactContent?.trim();
    const hasDistinctCompact = Boolean(
      compactContent && compactContent !== fullContent,
    );
    const packed = packSkillContent({
      fullContent,
      compactContent: hasDistinctCompact ? compactContent : undefined,
      remaining,
      minUsefulTokens: minUseful,
    });

    if (!packed) {
      omissions.push({
        skillId: entry.skill.id,
        reason:
          entry.selection === "required" ? "required_budget" : "budget",
        tokens: estimateTokens(fullContent),
      });
      budgetOmitted = true;
      continue;
    }

    if (packed.kind === "compacted") {
      compacted = true;
    }
    if (packed.kind === "truncated") {
      truncated = true;
    }

    instructions.push({
      id: entry.skill.id,
      title: entry.skill.title,
      content: packed.content,
      priority: entry.skill.priority,
      resources: entry.skill.resources,
      provenance: {
        skillId: entry.skill.id,
        source: "skills",
        score: entry.score,
        ...(entry.selection ? { selection: entry.selection } : {}),
        conflictGroup: entry.skill.conflictGroup,
      },
    });
    usedTokens += packed.tokens;
    remaining -= packed.tokens;
    if (!exemptFromMaxSkills) {
      selectedMatchSkills += 1;
    }
  }

  return {
    instructions,
    omissions,
    usedTokens,
    budgetOmitted,
    compacted,
    truncated,
  };
}

function packSkillContent(params: {
  fullContent: string;
  compactContent: string | undefined;
  remaining: number;
  minUsefulTokens: number;
}): { content: string; tokens: number; kind: "full" | "compacted" | "truncated" } | undefined {
  const fullTokens = estimateTokens(params.fullContent);
  if (fullTokens <= params.remaining) {
    return { content: params.fullContent, tokens: fullTokens, kind: "full" };
  }

  if (!params.compactContent) {
    return undefined;
  }

  const compactTokens = estimateTokens(params.compactContent);
  if (compactTokens <= params.remaining) {
    return {
      content: params.compactContent,
      tokens: compactTokens,
      kind: "compacted",
    };
  }

  if (params.remaining < params.minUsefulTokens) {
    return undefined;
  }

  const truncated = truncateToTokenBudget(
    params.compactContent,
    params.remaining,
  );
  const tokens = estimateTokens(truncated);
  if (tokens > params.remaining || tokens < params.minUsefulTokens) {
    return undefined;
  }
  return { content: truncated, tokens, kind: "truncated" };
}

function truncateToTokenBudget(content: string, tokenBudget: number): string {
  const maxChars = Math.max(0, tokenBudget * DEFAULT_CHARACTERS_PER_TOKEN);
  if (content.length <= maxChars) {
    return content;
  }
  const sliceAt = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  return `${content.slice(0, sliceAt).trimEnd()}${TRUNCATION_MARKER}`;
}
