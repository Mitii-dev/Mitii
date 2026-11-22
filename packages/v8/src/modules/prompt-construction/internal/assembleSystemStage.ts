import {
  buildSystemInstructions,
  updateSectionBudget,
} from "../actions";
import type { allocateBudget } from "../actions";
import type {
  PromptConstructionInput,
  TokenEstimatorPort,
} from "../contracts";
import {
  sectionAllocation,
  sumInstructionTokens,
  type PromptAssemblyState,
} from "./promptAssemblyState";

type SystemInstructions = ReturnType<typeof buildSystemInstructions>;

/** Builds system/rules/skills/memory/plan content and records provenance + budgets. */
export function assembleSystemStage(params: {
  parsed: PromptConstructionInput;
  allocation: ReturnType<typeof allocateBudget>;
  state: PromptAssemblyState;
  estimator: TokenEstimatorPort;
}): { system: SystemInstructions; systemContent: string } {
  const { parsed, state, estimator } = params;
  const { reasonCodes, warnings, omissions, provenance } = state;
  let sections = state.sections;
  const sectionAlloc = (
    name: (typeof sections)[number]["section"],
  ): number => sectionAllocation(sections, name);

  const systemBudget =
    sectionAlloc("system") +
    sectionAlloc("rules") +
    sectionAlloc("skills") +
    sectionAlloc("memory");

  const system = buildSystemInstructions({
    decision: parsed.decision,
    projectRules: parsed.instructions?.projectRules ?? [],
    skills: parsed.instructions?.skills ?? [],
    memory: parsed.instructions?.memory ?? [],
    environment: parsed.instructions?.environment ?? [],
    extraFragments: parsed.extraFragments ?? [],
    injectSkillCatalogL1: parsed.injectSkillCatalogL1 === true,
    skillCatalogL1: parsed.skillCatalogL1 ?? [],
    estimator: estimator,
    budgetTokens: systemBudget,
    planText: parsed.planText,
    decisionBriefText: parsed.decisionBriefText,
    executionSeedText: parsed.executionSeedText,
    ...(parsed.fragmentLimits
      ? { fragmentLimits: parsed.fragmentLimits }
      : {}),
  });
  const systemContent = system.content;

  provenance.push({
    blockId: "system:core",
    section: "system",
    source: "system:safety+route",
    trust: "trusted_instruction",
  });
  if (parsed.executionSeedText?.trim()) {
    provenance.push({
      blockId: "system:execution-seed",
      section: "system",
      source: "system:execution-seed",
      trust: "trusted_instruction",
    });
  }
  if (parsed.decisionBriefText?.trim()) {
    provenance.push({
      blockId: "system:decision-brief",
      section: "system",
      source: "system:decision-brief",
      trust: "trusted_instruction",
    });
  }
  for (const id of system.includedEnvironmentIds) {
    provenance.push({
      blockId: id,
      // Fold into system section so budget weights stay stable.
      section: "system",
      source: `environment:${id}`,
      trust: "trusted_instruction",
    });
  }
  for (const id of system.includedRuleIds) {
    provenance.push({
      blockId: id,
      section: "rules",
      source: `rules:${id}`,
      trust: "trusted_instruction",
    });
  }
  for (const id of system.includedSkillIds) {
    provenance.push({
      blockId: id,
      section: "skills",
      source: `skills:${id}`,
      trust: "trusted_instruction",
    });
  }
  if (system.skillCatalogL1Injected) {
    provenance.push({
      blockId: "system:skill-catalog-l1",
      section: "skills",
      source: "skills:catalog_l1",
      trust: "trusted_instruction",
    });
    reasonCodes.push("skill_catalog_l1_injected");
  }
  for (const id of system.includedMemoryIds) {
    provenance.push({
      blockId: id,
      section: "memory",
      source: `memory:${id}`,
      trust: "untrusted_memory_content",
    });
  }
  const extraById = new Map(
    (parsed.extraFragments ?? []).map((fragment) => [fragment.id, fragment]),
  );
  for (const id of system.includedExtraIds) {
    const extra = extraById.get(id);
    const section =
      !extra || extra.section === "environment"
        ? "system"
        : extra.section === "plan"
          ? "plan"
          : extra.section === "rules" ||
              extra.section === "skills" ||
              extra.section === "memory"
            ? extra.section
            : "system";
    provenance.push({
      blockId: id,
      section,
      source: `extra:${extra?.contentKind ?? id}`,
      trust: extra?.trust ?? "trusted_instruction",
    });
  }
  if (system.includedExtraIds.length > 0) {
    reasonCodes.push("extra_fragments_injected");
  }
  for (const omitted of system.omitted) {
    omissions.push({
      section:
        omitted.section === "environment" || omitted.section === "system"
          ? "system"
          : omitted.section === "plan"
            ? "plan"
            : omitted.section,
      reason: "budget",
      detail: `Omitted instruction block ${omitted.id}`,
      tokens: omitted.tokens,
      source: omitted.id,
    });
  }
  if (system.reviewFlaggedFragmentIds.length > 0) {
    reasonCodes.push("fragment_review_threshold");
    warnings.push(
      `Fragment(s) exceeded the ${1_000}-token review threshold: ${system.reviewFlaggedFragmentIds.join(", ")}.`,
    );
  }

  const rulesUsed = sumInstructionTokens(
    parsed.instructions?.projectRules ?? [],
    system.includedRuleIds,
    estimator,
  );
  const skillsUsed =
    sumInstructionTokens(
      parsed.instructions?.skills ?? [],
      system.includedSkillIds,
      estimator,
    ) + system.skillCatalogL1UsedTokens;
  const memoryUsed = sumInstructionTokens(
    parsed.instructions?.memory ?? [],
    system.includedMemoryIds,
    estimator,
  );
  const environmentUsed = sumInstructionTokens(
    parsed.instructions?.environment ?? [],
    system.includedEnvironmentIds,
    estimator,
  );
  const systemCoreUsed = Math.max(
    0,
    system.usedTokens -
      rulesUsed -
      skillsUsed -
      memoryUsed -
      environmentUsed -
      system.planUsedTokens,
  );

  sections = updateSectionBudget(sections, "system", {
    usedTokens: systemCoreUsed,
    truncatedTokens: system.truncatedTokens,
    omittedTokens: 0,
  });
  sections = updateSectionBudget(sections, "rules", {
    usedTokens: rulesUsed,
    omittedTokens: system.omitted
      .filter((item) => item.section === "rules")
      .reduce((sum, item) => sum + item.tokens, 0),
  });
  sections = updateSectionBudget(sections, "skills", {
    usedTokens: skillsUsed,
    omittedTokens: system.omitted
      .filter((item) => item.section === "skills")
      .reduce((sum, item) => sum + item.tokens, 0),
  });
  sections = updateSectionBudget(sections, "memory", {
    usedTokens: memoryUsed,
    omittedTokens: system.omitted
      .filter((item) => item.section === "memory")
      .reduce((sum, item) => sum + item.tokens, 0),
  });
  const planAllocated =
    system.planUsedTokens > 0
      ? Math.max(system.planUsedTokens, parsed.planBudgetTokens ?? 0)
      : 0;
  sections = updateSectionBudget(sections, "plan", {
    allocatedTokens: planAllocated,
    usedTokens: system.planUsedTokens,
  });

  state.sections = sections;
  return { system, systemContent };
}
