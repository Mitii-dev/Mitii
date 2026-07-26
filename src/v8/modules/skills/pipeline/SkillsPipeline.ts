import {
  applySkillBudget,
  matchSkills,
  resolveSkillConflicts,
} from "../actions";
import { SKILLS_SCHEMA_VERSION } from "../constants";
import {
  SkillsError,
  skillDescriptorSchema,
  skillsSelectInputSchema,
  skillsSelectResultSchema,
} from "../contracts";
import type {
  SkillDescriptor,
  SkillsCatalogPort,
  SkillsSelectInput,
  SkillsSelectResult,
  SkillReasonCode,
} from "../contracts";

export interface SkillsPipelineDependencies {
  catalog: SkillsCatalogPort;
}

/**
 * Skills facade.
 *
 * Flow:
 *   validate input
 *   → load catalog
 *   → match by task evidence / route / keywords
 *   → resolve conflict groups
 *   → apply dedicated budget
 *   → return instruction blocks with provenance
 *
 * Does not own general prompt construction or run orchestration.
 */
export class SkillsPipeline {
  private readonly catalog: SkillsCatalogPort;

  constructor(dependencies: SkillsPipelineDependencies) {
    if (!dependencies.catalog) {
      throw new SkillsError(
        "misconfigured_ports",
        "SkillsPipeline requires a catalog port.",
      );
    }
    this.catalog = dependencies.catalog;
  }

  public async select(input: SkillsSelectInput): Promise<SkillsSelectResult> {
    const startedMs = Date.now();

    let parsed: SkillsSelectInput;
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

    let rawCatalog: readonly SkillDescriptor[];
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

    const catalog = rawCatalog.map((entry) => skillDescriptorSchema.parse(entry));
    const reasonCodes: SkillReasonCode[] = [];
    const warnings: string[] = [];

    if (catalog.length === 0) {
      reasonCodes.push("catalog_empty");
      return skillsSelectResultSchema.parse({
        schemaVersion: SKILLS_SCHEMA_VERSION,
        status: "empty",
        instructions: [],
        omissions: [],
        usedTokens: 0,
        budgetTokens: parsed.budgetTokens,
        warnings,
        reasonCodes,
        durationMs: Date.now() - startedMs,
      });
    }

    const matched = matchSkills({ catalog, input: parsed });
    const conflicts = resolveSkillConflicts({ scored: matched });
    if (conflicts.conflictsResolved) {
      reasonCodes.push("conflicts_resolved");
    }

    const budgeted = applySkillBudget({
      scored: conflicts.selected,
      budgetTokens: parsed.budgetTokens,
      maxSkills: parsed.maxSkills,
    });

    if (budgeted.budgetOmitted) {
      reasonCodes.push("budget_omitted_skills");
    }

    const omissions = [...conflicts.omissions, ...budgeted.omissions];

    if (budgeted.instructions.length === 0) {
      reasonCodes.push("no_matching_skills");
      return skillsSelectResultSchema.parse({
        schemaVersion: SKILLS_SCHEMA_VERSION,
        status: "empty",
        instructions: [],
        omissions,
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
      usedTokens: budgeted.usedTokens,
      budgetTokens: parsed.budgetTokens,
      warnings,
      reasonCodes: unique(reasonCodes),
      durationMs: Date.now() - startedMs,
    });
  }
}

function unique(codes: readonly SkillReasonCode[]): SkillReasonCode[] {
  return [...new Set(codes)];
}
