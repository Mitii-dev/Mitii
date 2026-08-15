import {
  DECISION_POLICY_PATTERNS,
  isRepairIntentTaxonomy,
} from "../../decision-policy";
import type {
  PlanStrategyDecision,
  PlanningParsedInput,
  PlanningReasonCode,
} from "../contracts";
import { countInScopeErrorDiagnostics } from "../internal/evidenceScope";

export type PlanStrategySource = "rules" | "override";

export interface ResolvePlanStrategyResult {
  decision: PlanStrategyDecision;
  source: PlanStrategySource;
  warnings: string[];
  reasonCodes: PlanningReasonCode[];
}

/**
 * Resolve plan strategy. Deterministic rules only — no model call.
 * A host/test-supplied `strategyOverride` always wins (sanitized).
 */
export function resolvePlanStrategy(params: {
  input: PlanningParsedInput;
}): ResolvePlanStrategyResult {
  if (params.input.strategyOverride) {
    const decision = sanitizeStrategy(params.input.strategyOverride, params.input);
    return {
      decision,
      source: "override",
      warnings: [],
      reasonCodes: [
        strategyReasonCode(decision.strategy),
        "plan_strategy_override",
      ],
    };
  }

  const decision = resolvePlanStrategyRules(params.input);
  return {
    decision,
    source: "rules",
    warnings: [],
    reasonCodes: [
      strategyReasonCode(decision.strategy),
      "plan_strategy_rules",
      ...(hasOutOfScopeBuildEvidence(params.input, decision)
        ? (["plan_build_evidence_out_of_scope"] as const)
        : []),
    ],
  };
}

/**
 * The single strategy rule table. Always resolves — no LLM, no fallback.
 *
 *   clarity unclear/ambiguous                 -> clarify
 *   repair intent AND in-scope errors >= 1     -> follow_evidence
 *   repair + "fix all …" / wide package scope  -> follow_evidence
 *   explorationDepth === "quick"               -> plan_from_ask
 *   deep/auto AND wide scope/complexity        -> discover_and_plan
 *   else                                       -> plan_from_ask
 */
export function resolvePlanStrategyRules(
  input: PlanningParsedInput,
): PlanStrategyDecision {
  if (
    input.evidence.clarity === "unclear" ||
    input.evidence.clarity === "ambiguous"
  ) {
    return sanitizeStrategy(
      {
        schemaVersion: 1,
        strategy: "clarify",
        rationale: "Ask clarity is insufficient for a concrete execution plan.",
        skipDiscover: true,
        useBuildEvidence: false,
      },
      input,
    );
  }

  const inScopeErrorCount = countInScopeErrorDiagnostics({
    buildEvidence: input.buildEvidence,
    targets: input.evidence.targets,
    query: input.query,
  });
  const repair = isRepairIntent(input);

  if (repair && inScopeErrorCount >= 1) {
    return sanitizeStrategy(
      {
        schemaVersion: 1,
        strategy: "follow_evidence",
        rationale: "In-scope preflight diagnostics match a repair ask.",
        skipDiscover: true,
        useBuildEvidence: true,
        confidence: 0.95,
      },
      input,
    );
  }

  // "fix all ts errors in this package" must not fall through to discovery
  // just because the first snapshot had empty or project-relative paths.
  if (repair && isBroadPackageRepair(input)) {
    return sanitizeStrategy(
      {
        schemaVersion: 1,
        strategy: "follow_evidence",
        rationale:
          "Broad package repair should drive remaining diagnostics to zero, not rediscover.",
        skipDiscover: true,
        useBuildEvidence: inScopeErrorCount >= 1 || hasAnyErrorDiagnostics(input),
        confidence: 0.85,
      },
      input,
    );
  }

  if (input.explorationDepth === "quick") {
    return sanitizeStrategy(
      {
        schemaVersion: 1,
        strategy: "plan_from_ask",
        rationale: "Quick exploration depth plans directly from the ask.",
        skipDiscover: true,
        useBuildEvidence: false,
      },
      input,
    );
  }

  if (hasWideScope(input)) {
    return sanitizeStrategy(
      {
        schemaVersion: 1,
        strategy: "discover_and_plan",
        rationale: "Scope or complexity benefits from discovery before mutation.",
        skipDiscover: false,
        useBuildEvidence: false,
      },
      input,
    );
  }

  return sanitizeStrategy(
    {
      schemaVersion: 1,
      strategy: "plan_from_ask",
      rationale: "Request is concrete enough to draft from the ask.",
      skipDiscover: true,
      useBuildEvidence: false,
    },
    input,
  );
}

export function sanitizeStrategy(
  decision: PlanStrategyDecision,
  input: PlanningParsedInput,
): PlanStrategyDecision {
  const inScopeErrors = countInScopeErrorDiagnostics({
    buildEvidence: input.buildEvidence,
    targets: input.evidence.targets,
    query: input.query,
  });
  const hasBuildDiagnostics = (input.buildEvidence?.diagnostics?.length ?? 0) > 0;

  if (decision.strategy === "clarify") {
    return {
      ...decision,
      skipDiscover: true,
      useBuildEvidence: false,
    };
  }

  if (decision.strategy === "follow_evidence") {
    return {
      ...decision,
      skipDiscover: true,
      useBuildEvidence: inScopeErrors > 0 || hasAnyErrorDiagnostics(input),
    };
  }

  if (!hasBuildDiagnostics || inScopeErrors === 0) {
    return {
      ...decision,
      useBuildEvidence: false,
    };
  }

  return {
    ...decision,
    useBuildEvidence:
      decision.strategy === "discover_and_plan" ? decision.useBuildEvidence : false,
  };
}

function isBroadPackageRepair(input: PlanningParsedInput): boolean {
  return (
    hasWideScope(input) &&
    (DECISION_POLICY_PATTERNS.broadRepairRequest.test(input.query) ||
      input.evidence.recommendsVerification === true)
  );
}

function hasAnyErrorDiagnostics(input: PlanningParsedInput): boolean {
  return (input.buildEvidence?.diagnostics ?? []).some(
    (diagnostic) => diagnostic.severity === "error",
  );
}

function hasWideScope(input: PlanningParsedInput): boolean {
  return (
    input.evidence.scope === "package" ||
    input.evidence.scope === "repository" ||
    input.evidence.scope === "workspace" ||
    input.evidence.scope === "multi_file" ||
    input.evidence.complexity === "complex" ||
    input.evidence.complexity === "very_complex" ||
    input.evidence.recommendsPlanning === true
  );
}

/** Thin wrapper over the shared decision-policy repair-intent predicate. */
export function isRepairIntent(input: PlanningParsedInput): boolean {
  return isRepairIntentTaxonomy([
    input.evidence.primaryIntent,
    ...input.evidence.secondaryIntents,
  ]);
}

function hasOutOfScopeBuildEvidence(
  input: PlanningParsedInput,
  decision: PlanStrategyDecision,
): boolean {
  return (
    decision.useBuildEvidence === false &&
    (input.buildEvidence?.diagnostics?.some(
      (diagnostic) => diagnostic.severity === "error",
    ) ?? false)
  );
}

function strategyReasonCode(
  strategy: PlanStrategyDecision["strategy"],
): PlanningReasonCode {
  return `plan_strategy_${strategy}` as PlanningReasonCode;
}
