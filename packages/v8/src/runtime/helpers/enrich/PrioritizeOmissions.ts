/**
 * Apply WindowPolicy section budgets to a ContextBundle (§11.2 / S11-BUDGET).
 * Drops lowest-priority material first; never silent — omissions + reasonCodes.
 */

import {
  contextBundleSchema,
  type ContextBundle,
} from "../../contracts/enrich/ContextBundle";
import type { EnrichOmissionKind } from "./OmissionPriority";

export interface EnrichSectionBudgets {
  skillsTokens?: number;
  repositoryTokens?: number;
  /** Soft token budget for memory reinject. */
  memoryTokens?: number;
  /** Max skill instruction items (WindowPolicy.skills.maxSkills). */
  maxSkills?: number;
}

export interface PrioritizeOmissionsInput {
  bundle: ContextBundle;
  budgets: EnrichSectionBudgets;
  focusPaths?: readonly string[];
  requiredSkillIds?: readonly string[];
}

export interface PrioritizeOmissionsResult {
  bundle: ContextBundle;
  omitted: Array<{ kind: EnrichOmissionKind; detail: string }>;
  reasonCodes: string[];
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function isFocusedPath(item: string, focusPaths: readonly string[]): boolean {
  if (focusPaths.length === 0) return true;
  return focusPaths.some(
    (focus) =>
      item === focus || item.startsWith(`${focus}/`) || focus.startsWith(item),
  );
}

function isRequiredSkill(
  item: string,
  requiredSkillIds: readonly string[],
): boolean {
  if (requiredSkillIds.length === 0) return false;
  return requiredSkillIds.some(
    (id) => item === id || item.includes(id) || item.startsWith(`skill:${id}`),
  );
}

function trimByBudget(
  items: readonly string[],
  budget: number | undefined,
  preferKeep: (item: string) => boolean,
): { kept: string[]; dropped: string[]; used: number } {
  if (budget == null) {
    return {
      kept: [...items],
      dropped: [],
      used: items.reduce((n, s) => n + estimateTokens(s), 0),
    };
  }
  const preferred = items.filter(preferKeep);
  const rest = items.filter((i) => !preferKeep(i));
  const kept: string[] = [];
  const dropped: string[] = [];
  let used = 0;
  for (const item of [...preferred, ...rest]) {
    const cost = estimateTokens(item);
    if (kept.length === 0 || used + cost <= budget) {
      kept.push(item);
      used += cost;
    } else {
      dropped.push(item);
    }
  }
  const keptSet = new Set(kept);
  return {
    kept: items.filter((i) => keptSet.has(i)),
    dropped,
    used,
  };
}

export function prioritizeOmissions(
  input: PrioritizeOmissionsInput,
): PrioritizeOmissionsResult {
  const focusPaths = input.focusPaths ?? input.bundle.focusPaths ?? [];
  const requiredSkillIds = input.requiredSkillIds ?? [];
  const omitted: Array<{ kind: EnrichOmissionKind; detail: string }> = [];
  const reasonCodes: string[] = [];

  let skillsItems = input.bundle.skills?.items ?? [];
  let skillsOmissions = [...(input.bundle.skills?.omissions ?? [])];
  let skillsTokens = input.bundle.skills?.tokens ?? 0;
  let skillsCache = input.bundle.skills?.cacheClass ?? "stable";

  let memoryItems = input.bundle.memory?.items ?? [];
  let memoryOmissions = [...(input.bundle.memory?.omissions ?? [])];
  let memoryTokens = input.bundle.memory?.tokens ?? 0;
  let memoryCache = input.bundle.memory?.cacheClass ?? "semi";

  let repoItems = input.bundle.repoContext?.items ?? [];
  let repoOmissions = [...(input.bundle.repoContext?.omissions ?? [])];
  let repoTokens = input.bundle.repoContext?.tokens ?? 0;
  let repoCache = input.bundle.repoContext?.cacheClass ?? "volatile";

  if (input.budgets.maxSkills != null && skillsItems.length > input.budgets.maxSkills) {
    const preferred = skillsItems.filter((i) =>
      isRequiredSkill(i, requiredSkillIds),
    );
    const rest = skillsItems.filter((i) => !isRequiredSkill(i, requiredSkillIds));
    const kept = [...preferred, ...rest].slice(0, input.budgets.maxSkills);
    const keptSet = new Set(kept);
    for (const d of skillsItems.filter((i) => !keptSet.has(i))) {
      omitted.push({
        kind: isRequiredSkill(d, requiredSkillIds)
          ? "required_skills"
          : "optional_skills",
        detail: d.slice(0, 80),
      });
      skillsOmissions.push(`skill_max:${d.slice(0, 64)}`);
    }
    skillsItems = skillsItems.filter((i) => keptSet.has(i));
    reasonCodes.push("enrich_omit_skills_max");
  }

  {
    const trimmed = trimByBudget(
      skillsItems,
      input.budgets.skillsTokens,
      (item) => isRequiredSkill(item, requiredSkillIds),
    );
    for (const d of trimmed.dropped) {
      omitted.push({
        kind: isRequiredSkill(d, requiredSkillIds)
          ? "required_skills"
          : "optional_skills",
        detail: d.slice(0, 80),
      });
      skillsOmissions.push(`skill_budget:${d.slice(0, 64)}`);
    }
    if (trimmed.dropped.length > 0) reasonCodes.push("enrich_omit_skills_budget");
    skillsItems = trimmed.kept;
    skillsTokens = trimmed.used;
  }

  {
    const trimmed = trimByBudget(
      memoryItems,
      input.budgets.memoryTokens,
      () => false,
    );
    for (const d of trimmed.dropped) {
      omitted.push({ kind: "memory", detail: d.slice(0, 80) });
      memoryOmissions.push(`memory_budget:${d.slice(0, 64)}`);
    }
    if (trimmed.dropped.length > 0) reasonCodes.push("enrich_omit_memory_budget");
    memoryItems = trimmed.kept;
    memoryTokens = trimmed.used;
  }

  {
    const trimmed = trimByBudget(
      repoItems,
      input.budgets.repositoryTokens,
      (item) => isFocusedPath(item, focusPaths),
    );
    for (const d of trimmed.dropped) {
      omitted.push({
        kind: isFocusedPath(d, focusPaths) ? "focused_repo" : "broad_repo",
        detail: d.slice(0, 80),
      });
      repoOmissions.push(`repo_budget:${d.slice(0, 64)}`);
    }
    if (trimmed.dropped.length > 0) reasonCodes.push("enrich_omit_repo_budget");
    repoItems = trimmed.kept;
    repoTokens = trimmed.used;
  }

  const next: ContextBundle = {
    ...input.bundle,
    reasonCodes: [
      ...new Set([
        ...input.bundle.reasonCodes,
        ...reasonCodes,
        ...(omitted.length > 0 ? ["enrich_omissions_applied"] : []),
      ]),
    ],
  };

  if (input.bundle.skills || skillsItems.length > 0) {
    if (skillsItems.length > 0) {
      next.skills = {
        items: skillsItems,
        tokens: skillsTokens,
        cacheClass: skillsCache,
        omissions: [...new Set(skillsOmissions)],
      };
    } else {
      delete next.skills;
    }
  }

  if (input.bundle.memory || memoryItems.length > 0) {
    if (memoryItems.length > 0) {
      next.memory = {
        items: memoryItems,
        tokens: memoryTokens,
        cacheClass: memoryCache,
        omissions: [...new Set(memoryOmissions)],
      };
    } else {
      delete next.memory;
    }
  }

  if (input.bundle.repoContext || repoItems.length > 0) {
    if (repoItems.length > 0) {
      next.repoContext = {
        items: repoItems,
        tokens: repoTokens,
        cacheClass: repoCache,
        omissions: [...new Set(repoOmissions)],
      };
    } else {
      delete next.repoContext;
    }
  }

  return {
    bundle: contextBundleSchema.parse(next),
    omitted,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

/** Map WindowPolicy-like slice onto enrich section budgets. */
export function sectionBudgetsFromWindowPolicy(policy: {
  sections?: {
    skillsTokens?: number;
    repositoryTokens?: number;
  };
  skills?: { budgetTokens?: number; maxSkills?: number };
  compaction?: { memoryReinjectChars?: number };
}): EnrichSectionBudgets {
  const memoryChars = policy.compaction?.memoryReinjectChars;
  return {
    skillsTokens: policy.skills?.budgetTokens ?? policy.sections?.skillsTokens,
    repositoryTokens: policy.sections?.repositoryTokens,
    memoryTokens:
      memoryChars != null ? Math.max(1, Math.ceil(memoryChars / 4)) : undefined,
    maxSkills: policy.skills?.maxSkills,
  };
}
