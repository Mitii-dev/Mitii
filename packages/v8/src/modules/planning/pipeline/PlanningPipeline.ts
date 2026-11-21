import {
  applyDiscoveredPlanDraft,
  applyPlanWorkingSets,
  compactPlan,
  compileDiscoveryBrief,
  draftClarifyFromDiscovery,
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
  PlanClarifyDraft,
  PlanStrategyDecision,
  PlanningInput,
  PlanningLlmPort,
  PlanningParsedInput,
  PlanningReasonCode,
  PlanningResult,
} from "../contracts";
import { isThinDiscoveryBrief } from "../internal/discoveredPlanPrompt";
import {
  clarifyStrategyAfterFailedDiscoveryDraft,
  isGenericDiscoverySkeletonPlan,
  requiresNonSkeletonDiscoveryDraft,
} from "../internal/discoveryDraftQuality";
import { thinDiscoveryBriefForClarify } from "../thinDiscoveryBriefForClarify";
import { askNeedsPlanScopeFork } from "../internal/askNeedsPlanScopeFork";
import { hasResolvedPlanScopeChoice } from "../internal/planScopeChoice";
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
    let strategyDecision = strategy.decision;
    const draftInput = prepareDraftInput(parsed, strategyDecision);
    let drafted = draftPlan({
      ...draftInput,
      strategy: strategyDecision,
    });

    const draftWarnings: string[] = [];
    const draftReasonCodes: PlanningReasonCode[] = [];
    const requireModelDraft = requiresNonSkeletonDiscoveryDraft({
      input: parsed,
      strategy: strategyDecision,
    });
    let draftedFromDiscovery = false;

    if (
      strategyDecision.strategy === "discover_and_plan" &&
      parsed.discoveryBrief
    ) {
      if (isThinDiscoveryBrief(parsed.discoveryBrief)) {
        draftReasonCodes.push("plan_discovery_draft_skipped_thin_brief");
        draftWarnings.push(
          "Discovery evidence was thin; kept the deterministic plan skeleton instead of a model draft.",
        );
      } else if (this.deps.llm) {
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
          draftedFromDiscovery = true;
          draftReasonCodes.push("plan_drafted_from_discovery");
        } else {
          draftWarnings.push(discovered.warning);
          draftReasonCodes.push("plan_discovery_draft_failed_fallback");
        }
      } else if (requireModelDraft) {
        draftReasonCodes.push("plan_discovery_draft_required_clarify");
        draftWarnings.push(
          "Plan requires a discovery model draft but no planning LLM is configured; clarifying instead of a hollow skeleton.",
        );
      }
    }

    // Medium+/multi-item Plan: never ship the generic discovery skeleton.
    // If the user already picked A/B/C scope, keep drafting — do not re-clarify.
    // Clear single-outcome feature/bugfix asks also keep drafting — harness
    // A/B/C chips are wrong for those (askNeedsPlanScopeFork).
    const scopeAlreadyChosen = hasResolvedPlanScopeChoice({
      query: parsed.query,
    });
    const needsScopeFork = askNeedsPlanScopeFork({
      clarity: parsed.evidence.clarity,
      primaryIntent: parsed.evidence.primaryIntent,
      requestedOutcomes: parsed.evidence.requestedOutcomes,
      query: parsed.query,
    });
    if (
      requireModelDraft &&
      (!draftedFromDiscovery || isGenericDiscoverySkeletonPlan(drafted)) &&
      !scopeAlreadyChosen &&
      needsScopeFork
    ) {
      strategyDecision = clarifyStrategyAfterFailedDiscoveryDraft(
        strategyDecision,
      );
      drafted = draftPlan({
        ...prepareDraftInput(
          {
            ...parsed,
            discoveryBrief: thinDiscoveryBriefForClarify(parsed.discoveryBrief, [
              "Which concrete files, symbols, and verify commands should each improvement cover?",
            ]),
          },
          strategyDecision,
        ),
        strategy: strategyDecision,
      });
      draftReasonCodes.push("plan_discovery_draft_required_clarify");
      draftWarnings.push(
        "Rejected hollow discovery skeleton for Plan; drafted clarifying open questions instead.",
      );
    } else if (
      requireModelDraft &&
      (!draftedFromDiscovery || isGenericDiscoverySkeletonPlan(drafted)) &&
      !scopeAlreadyChosen &&
      !needsScopeFork
    ) {
      draftWarnings.push(
        "Kept discovery-grounded plan for a clear single-outcome ask instead of forcing harness A/B/C clarify.",
      );
    }

    let clarifyDraft: PlanClarifyDraft | undefined;
    if (strategyDecision.strategy === "clarify" && needsScopeFork) {
      const clarifyInput = prepareDraftInput(parsed, strategyDecision);
      const clarified = await draftClarifyFromDiscovery({
        input: parsed,
        discoveryBrief: clarifyInput.discoveryBrief,
        llm: this.deps.llm,
      });
      clarifyDraft = clarified.draft;
      if (clarified.ok && clarified.source === "model") {
        draftReasonCodes.push("plan_clarify_drafted");
      } else {
        draftReasonCodes.push("plan_clarify_draft_fallback");
        if (!clarified.ok) {
          draftWarnings.push(clarified.warning);
        }
      }
    }

    const validated = validatePlan({
      plan: drafted,
      input: parsed,
      strategy: strategyDecision,
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
        strategy: strategyDecision,
        ...(clarifyDraft ? { clarifyDraft } : {}),
      });
    }

    const annotated = applyPlanWorkingSets({
      plan: validated.plan,
      input: parsed,
      strategy: strategyDecision,
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
      strategy: strategyDecision,
      ...(clarifyDraft ? { clarifyDraft } : {}),
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
  formatClarifyAsAnswer,
  formatPlanAsAnswer,
  formatPlanSummaryAnswer,
  inferPlanStrategyFromArtifact,
  serializePlanForPrompt,
  serializePlanText,
} from "../actions";

/**
 * When discovery evidence is thin or strategy is clarify, drop process skills
 * (and strip change surfaces on clarify) so drafting cannot invent file work.
 */
function prepareDraftInput(
  parsed: PlanningParsedInput,
  strategy: PlanStrategyDecision,
): PlanningParsedInput {
  if (strategy.strategy === "clarify") {
    return {
      ...parsed,
      skills: [],
      discoveryBrief: thinDiscoveryBriefForClarify(parsed.discoveryBrief),
    };
  }
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
