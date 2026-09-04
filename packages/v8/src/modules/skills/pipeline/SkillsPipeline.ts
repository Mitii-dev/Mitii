import {
  applySkillBudget,
  matchSkills,
  mergeSkillCandidates,
  resolveRequiredSkills,
  resolveSkillConflicts,
} from "../actions";
import { KeywordSkillSimilarity } from "../KeywordSkillSimilarity";
import { SKILLS_SCHEMA_VERSION } from "../constants";
import {
  SkillsError,
  skillBodySchema,
  skillDescriptorSchema,
  skillIndexEntrySchema,
  skillsSelectInputSchema,
  skillsSelectResultSchema,
} from "../contracts";
import type { HydratedScoredSkill, ScoredSkill } from "../actions";
import type {
  SkillBody,
  SkillIndexEntry,
  SkillsCatalogPort,
  SkillsSelectInput,
  SkillsSelectResult,
  SkillReasonCode,
} from "../contracts";
import type { SkillSimilarityPort } from "../contracts/ports/SkillSimilarityPort";
import type { z } from "zod";

export interface SkillsPipelineDependencies {
  catalog: SkillsCatalogPort;
  similarity?: SkillSimilarityPort;
}

/**
 * Skills facade.
 *
 * Flow:
 *   validate input
 *   → load catalog
 *   → match by task evidence / route / keywords (+ optional similarity)
 *   → resolve conflict groups
 *   → hydrate selected skill bodies
 *   → apply dedicated budget
 *   → return instruction blocks with provenance
 *
 * Does not own general prompt construction or run orchestration.
 */
export class SkillsPipeline {
  private readonly catalog: SkillsCatalogPort;
  private readonly similarity: SkillSimilarityPort;

  constructor(dependencies: SkillsPipelineDependencies) {
    if (!dependencies.catalog) {
      throw new SkillsError(
        "misconfigured_ports",
        "SkillsPipeline requires a catalog port.",
      );
    }
    this.catalog = dependencies.catalog;
    this.similarity =
      dependencies.similarity ?? new KeywordSkillSimilarity();
  }

  public async select(input: SkillsSelectInput): Promise<SkillsSelectResult> {
    const startedMs = Date.now();

    let parsed: z.infer<typeof skillsSelectInputSchema>;
    try {
      parsed = skillsSelectInputSchema.parse(input);
    } catch (error) {
      throw new SkillsError(
        "invalid_input",
        "Skills select input failed schema validation.",
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
        "Skills catalog failed to load.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const catalog = rawCatalog.map((entry) => skillIndexEntrySchema.parse(entry));
    const reasonCodes: SkillReasonCode[] = [];
    const warnings: string[] = [];

    if (catalog.length === 0) {
      reasonCodes.push("catalog_empty");
      return skillsSelectResultSchema.parse({
        schemaVersion: SKILLS_SCHEMA_VERSION,
        status: "empty",
        instructions: [],
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

    const required = resolveRequiredSkills({
      catalog,
      requiredSkillIds: parsed.requiredSkillIds,
    });
    if (required.resolvedIds.length > 0) {
      reasonCodes.push("skills_required");
    }
    if (
      parsed.requiredSkillIds.length > 0 &&
      required.omissions.some((omission) => omission.reason === "not_found")
    ) {
      reasonCodes.push("skills_required_not_found");
      warnings.push(
        "One or more required skills were not found in the catalog.",
      );
    }
    if (
      parsed.requiredSkillIds.length > 0 &&
      required.resolvedIds.length > 0 &&
      required.resolvedIds.length < parsed.requiredSkillIds.length
    ) {
      reasonCodes.push("skills_required_partial");
    }

    const matched = await matchSkills({
      catalog,
      input: parsed,
      similarity: this.similarity,
    });
    if (matched.nonMatchedCount > 0) {
      // Not pushed to `omissions`/`omittedCount` — those are reserved for
      // budget/conflict/duplicate drops of already-applicable skills. This
      // is the much larger "didn't match at all" population, which was
      // previously invisible: `omittedCount` only ever reflected the small
      // conflict/budget slice, never the catalog majority that never
      // qualified as a candidate in the first place.
      warnings.push(
        `${matched.nonMatchedCount} of ${catalog.length} catalog skill(s) did not match this request (path/intent/route/keyword/threshold) and were not considered.`,
      );
    }
    const merged = mergeSkillCandidates(required.scored, matched.scored);
    const conflicts = resolveSkillConflicts({ scored: merged });
    if (conflicts.conflictsResolved) {
      reasonCodes.push("conflicts_resolved");
    }

    const hydrated = await this.hydrateSelected(conflicts.selected);

    const budgeted = applySkillBudget({
      scored: hydrated.selected,
      budgetTokens: parsed.budgetTokens,
      maxSkills: resolveMaxSkills(input, parsed),
    });

    if (budgeted.budgetOmitted) {
      reasonCodes.push("budget_omitted_skills");
    }
    if (budgeted.compacted) {
      reasonCodes.push("skills_compacted");
      warnings.push(
        "One or more selected skills used compact metadata because the full playbook exceeded the skills budget.",
      );
    }
    if (budgeted.truncated) {
      reasonCodes.push("skills_truncated_to_budget");
      warnings.push(
        "One or more selected skills were truncated to fit the remaining skills budget.",
      );
    }

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
      reasonCodes.push("no_matching_skills");
      return skillsSelectResultSchema.parse({
        schemaVersion: SKILLS_SCHEMA_VERSION,
        status: "empty",
        instructions: [],
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

    reasonCodes.push("skills_selected");
    return skillsSelectResultSchema.parse({
      schemaVersion: SKILLS_SCHEMA_VERSION,
      status: "selected",
      instructions: budgeted.instructions,
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
        `Skills catalog failed to hydrate body for ${skill.id}.`,
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
