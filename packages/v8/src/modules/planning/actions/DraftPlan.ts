import type {
  PlanArtifact,
  PlanStrategyDecision,
  PlanningParsedInput,
} from "../contracts";
import { PLANNING_SCHEMA_VERSION } from "../constants";
import { filterBuildEvidenceToAskScope } from "../internal/evidenceScope";
import { thinDiscoveryBriefForClarify } from "../thinDiscoveryBriefForClarify";
import {
  buildAlternatives,
  buildAssumptions,
  buildObjective,
  buildOpenQuestions,
  buildRisks,
  buildRollback,
  buildVerification,
  mergeContextReviewed,
  resolveChangeImpact,
  resolveTargetRefs,
} from "./draftPlanEvidence";
import { buildPhases } from "./draftPlanPhases";
import { uniqueStrings } from "./draftPlanShared";
import { extractSkillPhaseHints } from "./draftSkillHints";


/**
 * Draft a generic PlanArtifact from task dimensions and optional hints.
 * Not plan-type-driven — phases come from scope/risk/clarity/impact signals.
 */
export function draftPlan(
  input: PlanningParsedInput & { strategy?: PlanStrategyDecision },
): PlanArtifact {
  if (input.priorPlan) {
    return {
      ...input.priorPlan,
      processHintsApplied: uniqueStrings([
        ...input.priorPlan.processHintsApplied,
        ...(input.processHints ?? []),
      ]),
    };
  }

  const clarify = input.strategy?.strategy === "clarify";
  // Clarify must never draft Change surfaces from partial discovery.
  const discoveryBrief = clarify
    ? thinDiscoveryBriefForClarify(input.discoveryBrief)
    : input.discoveryBrief;

  const { evidence } = input;
  const changeImpact = resolveChangeImpact(evidence);
  const approvalRequired =
    evidence.risk === "high" ||
    evidence.risk === "critical";
  const targetRefs = clarify
    ? []
    : resolveTargetRefs(evidence, discoveryBrief);
  const objective = buildObjective(input.query, evidence);
  const openQuestions = buildOpenQuestions(
    evidence,
    input.processHints,
    discoveryBrief,
    clarify,
  );
  const skillPhaseHints = clarify
    ? []
    : extractSkillPhaseHints(input.skills ?? []);
  const scopedBuildEvidence =
    !clarify && input.strategy?.useBuildEvidence
      ? filterBuildEvidenceToAskScope({
          buildEvidence: input.buildEvidence,
          targets: evidence.targets,
          query: input.query,
        })
      : undefined;
  const phases = buildPhases({
    evidence,
    objective,
    targetRefs,
    changeImpact,
    processHints: input.processHints ?? [],
    skillPhaseHints,
    buildEvidence: scopedBuildEvidence,
    skipDiscover: clarify ? true : (input.strategy?.skipDiscover ?? false),
    discoveryBrief,
    maxFilesPerBatch: input.maxFilesPerBatch,
    clarify,
  });

  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective,
    assumptions: buildAssumptions(evidence),
    openQuestions,
    contextReviewed: mergeContextReviewed(
      input.contextReviewed,
      input.scopedRepoMap,
      discoveryBrief?.filesRead.map((file) => ({
        kind: "file" as const,
        ref: file.path,
        note: file.reason,
      })),
    ),
    constraints: uniqueStrings([
      ...evidence.constraints,
      ...(discoveryBrief?.discoveredConstraints ?? []),
    ]),
    dimensions: {
      scope: evidence.scope,
      risk: evidence.risk,
      clarity: evidence.clarity,
      complexity: evidence.complexity,
      changeImpact,
    },
    phases,
    risks: buildRisks(evidence, changeImpact),
    alternatives: buildAlternatives(evidence),
    verification: buildVerification(evidence),
    rollback: buildRollback(evidence, changeImpact),
    approvalRequired,
    processHintsApplied: [...(input.processHints ?? [])],
  };
}
