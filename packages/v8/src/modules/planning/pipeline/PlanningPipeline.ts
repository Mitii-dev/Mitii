import {
  applyDiscoveredPlanDraft,
  applyPlanWorkingSets,
  compactPlan,
  compileDiscoveryBrief,
  draftPlan,
  draftPlanFromDiscovery,
  resolvePlanStrategy,
  validatePlan,
} from "../actions";
import { PLANNING_SCHEMA_VERSION } from "../constants";
import {
  PlanningError,
  planningInputSchema,
  planningResultSchema,
} from "../contracts";
import type {
  DiscoveryBrief,
  DiscoveryObservation,
  PlanStrategyDecision,
  PlanningInput,
  PlanningLlmPort,
  PlanningParsedInput,
  PlanningReasonCode,
  PlanningResult,
} from "../contracts";
import { isThinDiscoveryBrief } from "../internal/discoveredPlanPrompt";
import type { z } from "zod";

export interface PlanStrategyResolution {
  decision: PlanStrategyDecision;
  warnings: string[];
  reasonCodes: PlanningReasonCode[];
}

/**
 * Planning facade.
 *
 * Flow:
 *   validate input
 *   → if planningDepth is none, return blocked/empty guidance
 *   → resolve strategy (rules only; engine may supply strategyOverride)
 *   → draft generic PlanArtifact from dimensions (+ optional skills/hints)
 *   → discover_and_plan only: one model draft call over discovery evidence
 *   → validate required sections
 *   → follow_evidence / discover_and_plan: compile hop-1 mustRead/affected onto Change steps
 *   → compact to budget
 *   → return planning result
 *
 * Does not execute tools or own run state. Engine decides when to call this
 * and whether to suspend for plan approval.
 */
export class PlanningPipeline {
  constructor(private readonly deps: { llm?: PlanningLlmPort } = {}) {}

  /**
   * Classify plan strategy without drafting. Test/host helper — normal runs
   * let Engine call the same rules directly (see `resolvePlanStrategyRules`)
   * before deciding whether to run discovery.
   */
  public async resolveStrategy(
    input: PlanningInput,
  ): Promise<PlanStrategyResolution> {
    const parsed = this.parseInput(input);
    const strategy = resolvePlanStrategy({ input: parsed });
    return {
      decision: strategy.decision,
      warnings: strategy.warnings,
      reasonCodes: strategy.reasonCodes,
    };
  }

  /**
   * Compile read-only discovery observations into a validated DiscoveryBrief.
   */
  public compileDiscovery(input: DiscoveryObservation): DiscoveryBrief {
    return compileDiscoveryBrief(input);
  }

  public async plan(input: PlanningInput): Promise<PlanningResult> {
    const startedMs = Date.now();
    const parsed = this.parseInput(input);

    if (parsed.planningDepth === "none") {
      return planningResultSchema.parse({
        schemaVersion: PLANNING_SCHEMA_VERSION,
        status: "blocked",
        warnings: [],
        reasonCodes: ["plan_depth_none"],
        usedTokens: 0,
        budgetTokens: parsed.budgetTokens,
        durationMs: Date.now() - startedMs,
      });
    }

    const strategy = resolvePlanStrategy({ input: parsed });
    const draftInput = prepareDraftInput(parsed, strategy.decision);
    let drafted = draftPlan({
      ...draftInput,
      strategy: strategy.decision,
    });

    const draftWarnings: string[] = [];
    const draftReasonCodes: PlanningReasonCode[] = [];
    if (
      strategy.decision.strategy === "discover_and_plan" &&
      parsed.discoveryBrief &&
      this.deps.llm
    ) {
      if (isThinDiscoveryBrief(parsed.discoveryBrief)) {
        draftReasonCodes.push("plan_discovery_draft_skipped_thin_brief");
        draftWarnings.push(
          "Discovery evidence was thin; kept the deterministic plan skeleton instead of a model draft.",
        );
      } else {
        const discovered = await draftPlanFromDiscovery({
          input: parsed,
          discoveryBrief: parsed.discoveryBrief,
          llm: this.deps.llm,
        });
        if (discovered.ok) {
          drafted = applyDiscoveredPlanDraft({
            skeleton: drafted,
            draft: discovered.draft,
            input: parsed,
          });
          draftReasonCodes.push("plan_drafted_from_discovery");
        } else {
          draftWarnings.push(discovered.warning);
          draftReasonCodes.push("plan_discovery_draft_failed_fallback");
        }
      }
    }

    const validated = validatePlan({
      plan: drafted,
      input: parsed,
      strategy: strategy.decision,
    });
    if (!validated.ok) {
      return planningResultSchema.parse({
        schemaVersion: PLANNING_SCHEMA_VERSION,
        status: "blocked",
        warnings: [...strategy.warnings, ...draftWarnings, ...validated.warnings],
        reasonCodes: unique([
          ...strategy.reasonCodes,
          ...draftReasonCodes,
          ...validated.reasonCodes,
        ]),
        usedTokens: 0,
        budgetTokens: parsed.budgetTokens,
        durationMs: Date.now() - startedMs,
        strategy: strategy.decision,
      });
    }

    const annotated = applyPlanWorkingSets({
      plan: validated.plan,
      input: parsed,
      strategy: strategy.decision,
    });

    const compacted = compactPlan({
      plan: annotated.plan,
      budgetTokens: parsed.budgetTokens,
    });

    const reasonCodes = unique([
      "plan_drafted",
      ...strategy.reasonCodes,
      ...draftReasonCodes,
      ...validated.reasonCodes,
      ...annotated.reasonCodes,
      ...compacted.reasonCodes,
    ]);

    const status = compacted.compacted ? "compacted" : "validated";

    return planningResultSchema.parse({
      schemaVersion: PLANNING_SCHEMA_VERSION,
      status,
      plan: compacted.plan,
      warnings: [...strategy.warnings, ...draftWarnings, ...validated.warnings],
      reasonCodes,
      usedTokens: compacted.usedTokens,
      budgetTokens: parsed.budgetTokens,
      durationMs: Date.now() - startedMs,
      strategy: strategy.decision,
    });
  }

  private parseInput(input: PlanningInput): z.infer<typeof planningInputSchema> {
    try {
      return planningInputSchema.parse(input);
    } catch (error) {
      throw new PlanningError(
        "invalid_input",
        "Planning input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

export {
  compileDiscoveryBrief,
  collectDiscoveryImpactSeedPaths,
  formatPlanAsAnswer,
  inferPlanStrategyFromArtifact,
  serializePlanForPrompt,
  serializePlanText,
} from "../actions";

/**
 * When discovery evidence is thin, drop process skills so they cannot invent
 * README/docs steps without file evidence.
 */
function prepareDraftInput(
  parsed: PlanningParsedInput,
  strategy: PlanStrategyDecision,
): PlanningParsedInput {
  if (
    strategy.strategy === "discover_and_plan" &&
    parsed.discoveryBrief &&
    isThinDiscoveryBrief(parsed.discoveryBrief)
  ) {
    return {
      ...parsed,
      skills: [],
    };
  }
  return parsed;
}

function unique(codes: readonly PlanningReasonCode[]): PlanningReasonCode[] {
  return [...new Set(codes)];
}
