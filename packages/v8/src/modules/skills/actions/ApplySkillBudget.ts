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
 * Packing is rank-preserving for equal size classes. sizeClass L playbooks
 * prefer their compact L1 body when later M skills remain, and may be omitted
 * entirely when `forbidLargeSkills` is set (compact no_cache windows).
 */
export function applySkillBudget(params: {
  scored: readonly HydratedScoredSkill[];
  budgetTokens: number;
  maxSkills: number;
  /**
   * When true, omit sizeClass L skills unless alwaysApply / required.
   * Typical for compact no_cache local windows.
   */
  forbidLargeSkills?: boolean;
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
  const forbidLarge = params.forbidLargeSkills === true;

  for (let index = 0; index < params.scored.length; index += 1) {
    const entry = params.scored[index]!;
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

    const sizeClass = resolveSkillSizeClass(entry.skill);
    if (forbidLarge && sizeClass === "L" && !exemptFromMaxSkills) {
      omissions.push({
        skillId: entry.skill.id,
        reason: "budget",
        tokens: estimateTokens(fullContent),
      });
      budgetOmitted = true;
      continue;
    }

    const compactContent = entry.compactContent?.trim();
    const hasDistinctCompact = Boolean(
      compactContent && compactContent !== fullContent,
    );
    const laterMediumPending = params.scored
      .slice(index + 1)
      .some((candidate) => {
        if (candidate.skill.alwaysApply || candidate.selection === "required") {
          return false;
        }
        return resolveSkillSizeClass(candidate.skill) !== "L";
      });

    // Prefer two M over one L: when later medium skills remain, pack L via
    // compact L1 first instead of consuming the budget on the full playbook.
    const preferCompactForLarge =
      sizeClass === "L" &&
      !exemptFromMaxSkills &&
      hasDistinctCompact &&
      laterMediumPending;

    const packed = preferCompactForLarge
      ? packSkillContent({
          fullContent: compactContent!,
          compactContent: undefined,
          remaining,
          minUsefulTokens: minUseful,
        }) ??
        packSkillContent({
          fullContent,
          compactContent: hasDistinctCompact ? compactContent : undefined,
          remaining,
          minUsefulTokens: minUseful,
        })
      : packSkillContent({
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

    if (packed.kind === "compacted" || preferCompactForLarge) {
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

export type SkillSizeClass = "S" | "M" | "L";

export function resolveSkillSizeClass(skill: {
  sizeClass?: SkillSizeClass;
  content: string;
}): SkillSizeClass {
  if (skill.sizeClass === "S" || skill.sizeClass === "M" || skill.sizeClass === "L") {
    return skill.sizeClass;
  }
  const chars = skill.content.trim().length;
  if (chars <= 400) {
    return "S";
  }
  if (chars <= 2_500) {
    return "M";
  }
  return "L";
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
