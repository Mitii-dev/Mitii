import {
  PLANNING_MESSAGES,
  PLANNING_SCHEMA_VERSION,
  PLANNING_STAGES,
} from "../constants";
import {
  PlanningError,
  planningInputSchema,
  planningResultSchema,
} from "../contracts";
import type {
  DiscoveryBrief,
  DiscoveryObservation,
  PlanningInput,
  PlanningParsedInput,
  PlanningReasonCode,
  PlanningResult,
  PlanStrategyDecision,
} from "../contracts";
import { compileDiscoveryBrief } from "../helpers/CompileDiscoveryBrief";
import { resolvePlanStrategy } from "../helpers/ResolvePlanStrategy";
import {
  noopModuleLogger,
  type ModuleLoggerPort,
} from "../ports/ModuleLoggerPort";
import type { PlanningLlmPort } from "../ports/PlanningLlmPort";
import { resolveStrategyStep } from "./steps/1-resolve-strategy";
import { draftSkeletonStep } from "./steps/2-draft-skeleton";
import { applyDiscoveryDraftStep } from "./steps/3-apply-discovery-draft";
import { enforceDiscoveryQualityStep } from "./steps/4-enforce-discovery-quality";
import { draftClarifyStep } from "./steps/5-draft-clarify";
import { validatePlanStep } from "./steps/6-validate-plan";
import { applyWorkingSetsStep } from "./steps/7-apply-working-sets";
import { compactPlanStep } from "./steps/8-compact-plan";
import { finalizeResultStep } from "./steps/9-finalize-result";
import type { PlanFlowState } from "./types";

export interface PlanStrategyResolution {
  decision: PlanStrategyDecision;
  warnings: string[];
  reasonCodes: PlanningReasonCode[];
}

export type PlanningPipelineDependencies = {
  llm?: PlanningLlmPort;
  log?: ModuleLoggerPort;
};

/**
 * Planning facade.
 *
 * Flow (plan):
 *   1-resolve-strategy → 2-draft-skeleton → 3-apply-discovery-draft (LLM)
 *   → 4-enforce-discovery-quality → 5-draft-clarify (LLM)
 *   → 6-validate-plan → 7-apply-working-sets → 8-compact-plan → 9-finalize-result
 *
 * Does not execute tools or own run state. Engine decides when to call this
 * and whether to suspend for plan approval.
 */
export class PlanningPipeline {
  private readonly llm: PlanningLlmPort | undefined;
  private readonly log: ModuleLoggerPort;

  constructor(deps: PlanningPipelineDependencies = {}) {
    this.llm = deps.llm;
    this.log = deps.log ?? noopModuleLogger;
  }

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

    const seed: PlanFlowState = {
      parsed,
      strategyDecision: {
        schemaVersion: PLANNING_SCHEMA_VERSION,
        strategy: "plan_from_ask",
        rationale: "seed",
        skipDiscover: true,
        useBuildEvidence: false,
      },
      strategyWarnings: [],
      strategyReasonCodes: [],
      drafted: {
        schemaVersion: PLANNING_SCHEMA_VERSION,
        objective: "seed",
        assumptions: [],
        openQuestions: [],
        contextReviewed: [],
        constraints: [],
        dimensions: {
          scope: "file",
          risk: "low",
          clarity: "clear",
          complexity: "trivial",
          changeImpact: [],
        },
        phases: [
          {
            id: "phase-seed",
            name: "Change",
            purpose: "seed",
            steps: [
              {
                id: "step-seed",
                intent: "seed",
                actionSummary: "seed",
                targetRefs: [],
                expectedOutcome: "seed",
                riskLevel: "low",
              },
            ],
            dependencies: [],
            successCriteria: [],
          },
        ],
        risks: [],
        alternatives: [],
        verification: { checks: [], manualQa: [], commands: [] },
        approvalRequired: false,
        processHintsApplied: [],
      },
      draftWarnings: [],
      draftReasonCodes: [],
      draftedFromDiscovery: false,
      needsScopeFork: false,
    };

    let stageStartedMs = Date.now();
    const strategyPart = resolveStrategyStep(seed);
    let state: PlanFlowState = { ...seed, ...strategyPart };
    this.log.stage({
      module: "planning",
      stage: PLANNING_STAGES.resolveStrategy,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: state.strategyReasonCodes,
      outputSummary: { strategy: state.strategyDecision.strategy },
    });

    stageStartedMs = Date.now();
    state = { ...state, ...draftSkeletonStep(state) };
    this.log.stage({
      module: "planning",
      stage: PLANNING_STAGES.draftSkeleton,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { phaseCount: state.drafted.phases.length },
    });

    stageStartedMs = Date.now();
    state = {
      ...state,
      ...(await applyDiscoveryDraftStep({ state, llm: this.llm })),
    };
    this.log.stage({
      module: "planning",
      stage: PLANNING_STAGES.applyDiscoveryDraft,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: state.draftReasonCodes,
      outputSummary: {
        draftedFromDiscovery: state.draftedFromDiscovery,
        llmConfigured: Boolean(this.llm),
        warnings: state.draftWarnings.slice(-3),
      },
    });

    stageStartedMs = Date.now();
    state = { ...state, ...enforceDiscoveryQualityStep(state) };
    this.log.stage({
      module: "planning",
      stage: PLANNING_STAGES.enforceDiscoveryQuality,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: state.draftReasonCodes,
      outputSummary: {
        strategy: state.strategyDecision.strategy,
        needsScopeFork: state.needsScopeFork,
      },
    });

    stageStartedMs = Date.now();
    state = {
      ...state,
      ...(await draftClarifyStep({ state, llm: this.llm })),
    };
    this.log.stage({
      module: "planning",
      stage: PLANNING_STAGES.draftClarify,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: state.draftReasonCodes,
      outputSummary: {
        hasClarifyDraft: Boolean(state.clarifyDraft),
        llmConfigured: Boolean(this.llm),
        warnings: state.draftWarnings.slice(-3),
      },
    });

    stageStartedMs = Date.now();
    state = { ...state, ...validatePlanStep(state) };
    this.log.stage({
      module: "planning",
      stage: PLANNING_STAGES.validatePlan,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: state.draftReasonCodes,
      outputSummary: { blocked: Boolean(state.blocked) },
    });

    if (state.blocked) {
      return finalizeResultStep({ state, startedMs });
    }

    stageStartedMs = Date.now();
    state = { ...state, ...applyWorkingSetsStep(state) };
    this.log.stage({
      module: "planning",
      stage: PLANNING_STAGES.applyWorkingSets,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: state.draftReasonCodes,
      outputSummary: {},
    });

    stageStartedMs = Date.now();
    state = { ...state, ...compactPlanStep(state) };
    this.log.stage({
      module: "planning",
      stage: PLANNING_STAGES.compactPlan,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: state.draftReasonCodes,
      outputSummary: {
        status: state.status,
        usedTokens: state.usedTokens,
      },
    });

    stageStartedMs = Date.now();
    const result = finalizeResultStep({ state, startedMs });
    this.log.stage({
      module: "planning",
      stage: PLANNING_STAGES.finalizeResult,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: result.reasonCodes,
      outputSummary: { status: result.status },
    });
    return result;
  }

  private parseInput(input: PlanningInput): PlanningParsedInput {
    try {
      return planningInputSchema.parse(input);
    } catch (error) {
      throw new PlanningError(
        "invalid_input",
        PLANNING_MESSAGES.inputInvalid,
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
} from "../helpers";
