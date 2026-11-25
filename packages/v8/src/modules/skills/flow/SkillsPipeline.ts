import {
  applySkillBudget,
  matchSkills,
  mergeSkillCandidates,
  resolvePreferredSkills,
  resolveRequiredSkills,
  resolveSkillConflicts,
} from "./steps";
import { KeywordSkillSimilarity } from "../adapters";
import {
  SKILLS_MESSAGES,
  SKILLS_SCHEMA_VERSION,
  SKILLS_STAGES,
  SKILL_REASON,
} from "../constants";
import {
  DEFAULT_SKILL_CATALOG_L1_MAX_ENTRIES,
} from "../defaults";
import {
  SkillsError,
  noopModuleLogger,
  skillBodySchema,
  skillDescriptorSchema,
  skillIndexEntrySchema,
  skillsSelectInputSchema,
  skillsSelectResultSchema,
  type ModuleLoggerPort,
} from "../contracts";
import type { HydratedScoredSkill, ScoredSkill } from "./steps";
import type {
  SkillBody,
  SkillCatalogL1Entry,
  SkillIndexEntry,
  SkillsCatalogPort,
  SkillsSelectInput,
  SkillsSelectResult,
  SkillReasonCode,
} from "../contracts";
import type { SkillSimilarityPort } from "../ports/SkillSimilarityPort";
import type { z } from "zod";

export interface SkillsPipelineDependencies {
  catalog: SkillsCatalogPort;
  similarity?: SkillSimilarityPort;
  log?: ModuleLoggerPort;
}

/**
 * Skills facade.
 *
 * Flow:
 *   1-resolve-required → 2-resolve-preferred → 3-match-skills
 *   → 4-merge-candidates → 5-resolve-conflicts → hydrate → 6-apply-budget
 *
 * Does not own general prompt construction or run orchestration.
 */
export class SkillsPipeline {
  private readonly catalog: SkillsCatalogPort;
  private readonly similarity: SkillSimilarityPort;
  private readonly log: ModuleLoggerPort;

  constructor(dependencies: SkillsPipelineDependencies) {
    if (!dependencies.catalog) {
      throw new SkillsError(
        "misconfigured_ports",
        SKILLS_MESSAGES.catalogRequired,
      );
    }
    this.catalog = dependencies.catalog;
    this.similarity =
      dependencies.similarity ?? new KeywordSkillSimilarity();
    this.log = dependencies.log ?? noopModuleLogger;
  }

  public async select(input: SkillsSelectInput): Promise<SkillsSelectResult> {
    const startedMs = Date.now();

    let parsed: z.infer<typeof skillsSelectInputSchema>;
    try {
      parsed = skillsSelectInputSchema.parse(input);
    } catch (error) {
      throw new SkillsError(
        "invalid_input",
        SKILLS_MESSAGES.selectInputInvalid,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    let rawCatalog: readonly SkillIndexEntry[];
    try {
      rawCatalog = await this.catalog.list();
    } catch (error) {
      throw new SkillsError(
        "catalog_failed",
        SKILLS_MESSAGES.catalogLoadFailed,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const catalog = rawCatalog.map((entry) => skillIndexEntrySchema.parse(entry));
    const reasonCodes: SkillReasonCode[] = [];
    const warnings: string[] = [];
    const catalogL1 = parsed.includeCatalogL1
      ? buildCatalogL1(catalog)
      : undefined;
    if (catalogL1 && catalogL1.length > 0) {
      reasonCodes.push(SKILL_REASON.catalogL1Included);
    }

    if (catalog.length === 0) {
      reasonCodes.push(SKILL_REASON.catalogEmpty);
      return skillsSelectResultSchema.parse({
        schemaVersion: SKILLS_SCHEMA_VERSION,
        status: "empty",
        instructions: [],
        ...(catalogL1 ? { catalogL1 } : {}),
        omissions: [],
        required: [],
        requiredCount: 0,
        matchedCount: 0,
        usedTokens: 0,
        budgetTokens: parsed.budgetTokens,
        warnings,
        reasonCodes,
        durationMs: Date.now() - startedMs,
      });
    }

    let stageStartedMs = Date.now();
    const required = resolveRequiredSkills({
      catalog,
      requiredSkillIds: parsed.requiredSkillIds,
    });
    if (required.resolvedIds.length > 0) {
      reasonCodes.push(SKILL_REASON.required);
    }
    if (
      parsed.requiredSkillIds.length > 0 &&
      required.omissions.some((omission) => omission.reason === "not_found")
    ) {
      reasonCodes.push(SKILL_REASON.requiredNotFound);
      warnings.push(SKILLS_MESSAGES.requiredMissing);
    }
    if (
      parsed.requiredSkillIds.length > 0 &&
      required.resolvedIds.length > 0 &&
      required.resolvedIds.length < parsed.requiredSkillIds.length
    ) {
      reasonCodes.push(SKILL_REASON.requiredPartial);
    }
    this.log.stage({
      module: "skills",
      stage: SKILLS_STAGES.resolveRequired,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { resolvedCount: required.resolvedIds.length },
    });

    stageStartedMs = Date.now();
    const preferred = resolvePreferredSkills({
      catalog,
      preferredSkillIds: parsed.preferredSkillIds,
    });
    if (preferred.resolvedIds.length > 0) {
      reasonCodes.push(SKILL_REASON.preferred);
    }
    this.log.stage({
      module: "skills",
      stage: SKILLS_STAGES.resolvePreferred,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { resolvedCount: preferred.resolvedIds.length },
    });

    stageStartedMs = Date.now();
    const matched = await matchSkills({
      catalog,
      input: parsed,
      similarity: this.similarity,
    });
    if (matched.nonMatchedCount > 0) {
      warnings.push(
        SKILLS_MESSAGES.nonMatched(matched.nonMatchedCount, catalog.length),
      );
    }
    this.log.stage({
      module: "skills",
      stage: SKILLS_STAGES.matchSkills,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        scoredCount: matched.scored.length,
        nonMatchedCount: matched.nonMatchedCount,
      },
    });

    const excluded = new Set(
      parsed.excludedSkillIds.map((id) => id.trim()).filter(Boolean),
    );
    const matchedWithoutExcluded =
      excluded.size === 0
        ? matched.scored
        : matched.scored.filter((entry) => !excluded.has(entry.skill.id));
    if (
      excluded.size > 0 &&
      matchedWithoutExcluded.length < matched.scored.length
    ) {
      warnings.push(
        SKILLS_MESSAGES.excludedMatched(
          matched.scored.length - matchedWithoutExcluded.length,
        ),
      );
    }
    const preferredWithoutExcluded =
      excluded.size === 0
        ? preferred.scored
        : preferred.scored.filter((entry) => !excluded.has(entry.skill.id));

    stageStartedMs = Date.now();
    const merged = mergeSkillCandidates(
      required.scored,
      matchedWithoutExcluded,
      preferredWithoutExcluded,
    );
    this.log.stage({
      module: "skills",
      stage: SKILLS_STAGES.mergeCandidates,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { mergedCount: merged.length },
    });

    stageStartedMs = Date.now();
    const conflicts = resolveSkillConflicts({ scored: merged });
    if (conflicts.conflictsResolved) {
      reasonCodes.push(SKILL_REASON.conflictsResolved);
    }
    this.log.stage({
      module: "skills",
      stage: SKILLS_STAGES.resolveConflicts,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: conflicts.conflictsResolved
        ? [SKILL_REASON.conflictsResolved]
        : [],
      outputSummary: { selectedCount: conflicts.selected.length },
    });

    const hydrated = await this.hydrateSelected(conflicts.selected);

    stageStartedMs = Date.now();
    const budgeted = applySkillBudget({
      scored: hydrated.selected,
      budgetTokens: parsed.budgetTokens,
      maxSkills: resolveMaxSkills(input, parsed),
      forbidLargeSkills: parsed.forbidLargeSkills === true,
    });

    if (budgeted.budgetOmitted) {
      reasonCodes.push(SKILL_REASON.budgetOmitted);
    }
    if (budgeted.compacted) {
      reasonCodes.push(SKILL_REASON.compacted);
      warnings.push(SKILLS_MESSAGES.compacted);
    }
    if (budgeted.truncated) {
      reasonCodes.push(SKILL_REASON.truncatedToBudget);
      warnings.push(SKILLS_MESSAGES.truncated);
    }
    this.log.stage({
      module: "skills",
      stage: SKILLS_STAGES.applyBudget,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        instructionCount: budgeted.instructions.length,
        usedTokens: budgeted.usedTokens,
      },
    });

    const omissions = [
      ...required.omissions,
      ...conflicts.omissions,
      ...hydrated.omissions,
      ...budgeted.omissions,
    ];

    const requiredInInstructions = budgeted.instructions.filter(
      (block) => block.provenance.selection === "required",
    );
    const matchedCount = budgeted.instructions.filter(
      (block) => block.provenance.selection === "matched",
    ).length;

    if (budgeted.instructions.length === 0) {
      reasonCodes.push(SKILL_REASON.noMatching);
      return skillsSelectResultSchema.parse({
        schemaVersion: SKILLS_SCHEMA_VERSION,
        status: "empty",
        instructions: [],
        ...(catalogL1 ? { catalogL1 } : {}),
        omissions,
        required: required.resolvedIds,
        requiredCount: requiredInInstructions.length,
        matchedCount,
        usedTokens: 0,
        budgetTokens: parsed.budgetTokens,
        warnings,
        reasonCodes: unique(reasonCodes),
        durationMs: Date.now() - startedMs,
      });
    }

    reasonCodes.push(SKILL_REASON.selected);
    return skillsSelectResultSchema.parse({
      schemaVersion: SKILLS_SCHEMA_VERSION,
      status: "selected",
      instructions: budgeted.instructions,
      ...(catalogL1 ? { catalogL1 } : {}),
      omissions,
      required: required.resolvedIds,
      requiredCount: requiredInInstructions.length,
      matchedCount,
      usedTokens: budgeted.usedTokens,
      budgetTokens: parsed.budgetTokens,
      warnings,
      reasonCodes: unique(reasonCodes),
      durationMs: Date.now() - startedMs,
    });
  }

  private async hydrateSelected(
    selected: readonly ScoredSkill[],
  ): Promise<{
    selected: HydratedScoredSkill[];
    omissions: SkillsSelectResult["omissions"];
  }> {
    const hydrated: HydratedScoredSkill[] = [];
    const omissions: SkillsSelectResult["omissions"] = [];

    for (const entry of selected) {
      const loadedBody = await this.loadBody(entry.skill);
      const compactContent = entry.skill.content?.trim();
      const fullContent = loadedBody?.content.trim();
      const content = fullContent || compactContent;
      if (!content) {
        omissions.push({ skillId: entry.skill.id, reason: "empty_content" });
        continue;
      }
      const descriptor = skillDescriptorSchema.parse({
        ...entry.skill,
        content,
        resources: loadedBody?.resources ?? entry.skill.resources,
      });
      hydrated.push({
        ...entry,
        skill: descriptor,
        compactContent:
          compactContent && compactContent !== content
            ? compactContent
            : undefined,
      });
    }

    return { selected: hydrated, omissions };
  }

  private async loadBody(skill: SkillIndexEntry): Promise<SkillBody | undefined> {
    if (!this.catalog.loadBody) {
      return undefined;
    }
    try {
      const body = await this.catalog.loadBody(skill.id);
      return body ? skillBodySchema.parse(body) : undefined;
    } catch (error) {
      throw new SkillsError(
        "catalog_failed",
        SKILLS_MESSAGES.hydrateBodyFailed(skill.id),
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

function unique(codes: readonly SkillReasonCode[]): SkillReasonCode[] {
  return [...new Set(codes)];
}

function resolveMaxSkills(
  rawInput: SkillsSelectInput,
  parsed: z.infer<typeof skillsSelectInputSchema>,
): number {
  if (typeof rawInput.maxSkills === "number") {
    return parsed.maxSkills;
  }
  switch (parsed.evidence.complexity) {
    case "complex":
    case "very_complex":
      return 4;
    case "moderate":
      return 3;
    default:
      return parsed.maxSkills;
  }
}

function buildCatalogL1(
  catalog: readonly SkillIndexEntry[],
): SkillCatalogL1Entry[] {
  return catalog
    .filter((entry) => entry.id.trim() && entry.title.trim())
    .slice(0, DEFAULT_SKILL_CATALOG_L1_MAX_ENTRIES)
    .map((entry) => ({
      id: entry.id,
      name: entry.title,
      description: (entry.description ?? entry.title).trim() || entry.title,
    }));
}
