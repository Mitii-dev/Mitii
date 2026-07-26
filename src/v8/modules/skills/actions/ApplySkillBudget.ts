import type {
  SkillInstructionBlock,
  SkillOmission,
} from "../contracts";
import { estimateTokens, type ScoredSkill } from "./MatchSkills";

/**
 * Apply the dedicated skills token budget and max count.
 */
export function applySkillBudget(params: {
  scored: readonly ScoredSkill[];
  budgetTokens: number;
  maxSkills: number;
}): {
  instructions: SkillInstructionBlock[];
  omissions: SkillOmission[];
  usedTokens: number;
  budgetOmitted: boolean;
} {
  const instructions: SkillInstructionBlock[] = [];
  const omissions: SkillOmission[] = [];
  let usedTokens = 0;
  let budgetOmitted = false;
  let remaining = params.budgetTokens;

  for (const entry of params.scored) {
    if (instructions.length >= params.maxSkills) {
      omissions.push({
        skillId: entry.skill.id,
        reason: "budget",
        tokens: estimateTokens(entry.skill.content),
      });
      budgetOmitted = true;
      continue;
    }

    const blockContent = entry.skill.content.trim();
    if (!blockContent) {
      omissions.push({ skillId: entry.skill.id, reason: "empty_content" });
      continue;
    }

    const tokens = estimateTokens(blockContent);
    if (tokens > remaining) {
      omissions.push({
        skillId: entry.skill.id,
        reason: "budget",
        tokens,
      });
      budgetOmitted = true;
      continue;
    }

    instructions.push({
      id: entry.skill.id,
      title: entry.skill.title,
      content: blockContent,
      priority: entry.skill.priority,
      provenance: {
        skillId: entry.skill.id,
        source: "skills",
        score: entry.score,
        conflictGroup: entry.skill.conflictGroup,
      },
    });
    usedTokens += tokens;
    remaining -= tokens;
  }

  return { instructions, omissions, usedTokens, budgetOmitted };
}
