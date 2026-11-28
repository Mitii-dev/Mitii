/**
 * Build mutate-readiness / change-impact / tool-loop session state for runV8ModelLoop.
 */
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import { createLoopFileReadTracker } from "../actions";
import { ReadLedger } from "../internal/ReadLedger";
import type { ContextEpoch } from "../internal/context-epoch";
import { InMemorySessionHistoryArchive } from "../internal/session-history";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import type { AgentEngineRuntime } from "./runtime";
import type { SteeringCriticMode } from "../legacy/steeringFlags";
import { resolveV8LoopPolicyThresholds } from "../policy/bands";
import { ToolLoopGuard } from "../modules/tool-loop-guard";
import {
  hasPlanDraftedThisRun,
  requiresMutation,
  resolveReadonlyTurnsBeforeMutationNudge,
} from "../modules/mutation-nudge";
import {
  evaluateActiveStepMutateReadiness,
  resolveMutateReadinessBudget,
  resolveStepReadonlyTurnsBeforeGate,
  type MutateReadinessBudget,
} from "../modules/mutate-readiness";
import { isExecutionSeedTrusted } from "../modules/execution-seed";
import { pickV8ThresholdOverrides } from "./modelLoopSupport";
import type { V8ModelLoopParams } from "./modelLoopTypes";
import type { LoopFileReadTracker } from "../actions";
import type { AgentReasonCode } from "../contracts";

export type ModelLoopSession = {
  decision: V8ModelLoopParams["decision"];
  answer: string;
  truncationRecoveriesUsed: number;
  reasoningAbortRecoveriesUsed: number;
  readOnlyTurnsWithoutMutation: number;
  unfulfilledExecuteRecoveries: number;
  rejectedMutationRecoveries: number;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  lastPromptCacheClass: PromptCacheClass | undefined;
  contextEpoch: ContextEpoch | undefined;
  sessionHistoryArchive: InMemorySessionHistoryArchive;
  logVerbosity: AgentLogVerbosity;
  memoryFacts: { id: string; content: string }[] | undefined;
  continueOverrideCount: number;
  forceFinalOnly: boolean;
  awaitingAnswerOnly: boolean;
  awaitingMutateOnly: boolean;
  mutateLockAllowTargetedReads: boolean;
  consecutiveSameToolTurns: number;
  lastUniformToolName: string | undefined;
  diagnoseAnswerNudges: number;
  incompleteAnswerRecoveries: number;
  softMutationNudges: number;
  evidenceGateNudges: number;
  evidenceRecoveryUsed: boolean;
  readonlyTurnsOnActiveStep: number;
  lastActiveStepId: string | undefined;
  mutationNeeded: boolean;
  vcsHistoryRewrite: boolean;
  gitWriteSucceeded: boolean;
  wallTimeNudged: boolean;
  seedTrusted: boolean;
  seedPaths: readonly string[];
  readLedger: ReadLedger;
  thresholds: ReturnType<typeof resolveV8LoopPolicyThresholds>["thresholds"];
  planDraftedThisRun: boolean;
  mutateReadinessBudget: MutateReadinessBudget;
  stepReadonlyTurnsBeforeGate: number;
  readonlyTurnsBeforeMutationNudge: number;
  mustReadNudgeBudget: { remaining: number };
  changeImpactGate: {
    required: boolean;
    satisfied: boolean;
  };
  changeImpactNudgeBudget: { remaining: number };
  loopFileReads: LoopFileReadTracker;
  evaluateStepReadiness: () => ReturnType<typeof evaluateActiveStepMutateReadiness>;
  criticMode: SteeringCriticMode;
  toolLoopGuard: ToolLoopGuard;
};

export function initModelLoopSession(params: {
  runtime: AgentEngineRuntime;
  loop: V8ModelLoopParams;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
}): ModelLoopSession {
  const { runtime, loop, reasonCodes, warnings } = params;
  const runId = loop.runId;
  const decision = loop.decision;
  const mutationNeeded = requiresMutation(decision);
  const vcsHistoryRewrite = decision.reasonCodes.includes("vcs_history_rewrite");
  const executionSeed = loop.executionSeed;
  const seedTrusted = isExecutionSeedTrusted(executionSeed);
  const seedPaths = executionSeed?.paths ?? [];
  const thresholds = resolveV8LoopPolicyThresholds({
    contextWindowTokens: loop.windowPolicy.contextWindowTokens,
    overrides: pickV8ThresholdOverrides(loop.thresholdOverrides),
  }).thresholds;
  const planDraftedThisRun = hasPlanDraftedThisRun({
    planningDepth: decision.planningDepth,
    reasonCodes,
  });
  const taskSize =
    loop.understanding?.taskAnalysis?.taskSize ??
    (planDraftedThisRun ? "medium" : "small");
  const mutateReadinessBudget = resolveMutateReadinessBudget(
    taskSize,
    loop.windowPolicy.contextWindowTokens,
  );
  const stepReadonlyTurnsBeforeGate = resolveStepReadonlyTurnsBeforeGate({
    taskSize,
    hasPlan: planDraftedThisRun,
    maxReadOnlyTurnsBeforeMutationNudgeAfterPlan:
      thresholds.maxReadOnlyTurnsBeforeMutationNudgeAfterPlan,
    windowBandOrTokens: loop.windowPolicy.contextWindowTokens,
    seedTrusted,
  });
  const readonlyTurnsBeforeMutationNudge = seedTrusted
    ? stepReadonlyTurnsBeforeGate
    : resolveReadonlyTurnsBeforeMutationNudge({
        hasPlan: planDraftedThisRun,
        maxReadOnlyTurnsBeforeMutationNudge:
          thresholds.maxReadOnlyTurnsBeforeMutationNudge,
        maxReadOnlyTurnsBeforeMutationNudgeAfterPlan:
          thresholds.maxReadOnlyTurnsBeforeMutationNudgeAfterPlan,
      });
  const changeImpactRecommended = decision.reasonCodes.includes(
    "change_impact_recommended",
  );
  const changeImpactAlreadyObserved = reasonCodes.includes(
    "change_impact_observed",
  );
  const changeImpactGate = {
    required:
      changeImpactRecommended &&
      decision.toolGrant.maximumWorkspaceEffect === "write",
    satisfied:
      changeImpactAlreadyObserved ||
      !(
        changeImpactRecommended &&
        decision.toolGrant.maximumWorkspaceEffect === "write"
      ),
  };
  const awaitingMutateOnly = loop.armMutateLockOnStart === true;
  const mutateLockAllowTargetedReads = !(loop.armMutateLockOnStart === true);
  if (awaitingMutateOnly) {
    reasonCodes.push("step_mutate_lock_armed");
    warnings.push(
      "Mutate lock re-armed on Continue; discovery stripped until apply_patch lands.",
    );
  }

  const establishedFacts = loop.establishedFacts;
  const taskListRef = loop.taskListRef;
  const loopFileReads = createLoopFileReadTracker();

  return {
    decision,
    answer: "",
    truncationRecoveriesUsed: 0,
    reasoningAbortRecoveriesUsed: 0,
    readOnlyTurnsWithoutMutation: 0,
    unfulfilledExecuteRecoveries: 0,
    rejectedMutationRecoveries: 0,
    emittedLoopPressureWarning: false,
    emittedLoopCompactionWarning: false,
    lastPromptCacheClass: undefined,
    contextEpoch: runtime.contextEpochs.get(runId),
    sessionHistoryArchive: new InMemorySessionHistoryArchive(),
    logVerbosity: loop.logVerbosity ?? "standard",
    memoryFacts: loop.memoryFacts ? [...loop.memoryFacts] : undefined,
    continueOverrideCount: loop.continueOverrideCount ?? 0,
    forceFinalOnly: false,
    awaitingAnswerOnly: false,
    awaitingMutateOnly,
    mutateLockAllowTargetedReads,
    consecutiveSameToolTurns: 0,
    lastUniformToolName: undefined,
    diagnoseAnswerNudges: 0,
    incompleteAnswerRecoveries: 0,
    softMutationNudges: 0,
    evidenceGateNudges: 0,
    evidenceRecoveryUsed: false,
    readonlyTurnsOnActiveStep: 0,
    lastActiveStepId: undefined,
    mutationNeeded,
    vcsHistoryRewrite,
    gitWriteSucceeded: false,
    wallTimeNudged: false,
    seedTrusted,
    seedPaths,
    readLedger: new ReadLedger(),
    thresholds,
    planDraftedThisRun,
    mutateReadinessBudget,
    stepReadonlyTurnsBeforeGate,
    readonlyTurnsBeforeMutationNudge,
    mustReadNudgeBudget: { remaining: thresholds.maxMustReadNudges },
    changeImpactGate,
    changeImpactNudgeBudget: {
      remaining:
        changeImpactGate.required && !changeImpactGate.satisfied
          ? thresholds.maxChangeImpactNudges
          : 0,
    },
    loopFileReads,
    evaluateStepReadiness: () =>
      evaluateActiveStepMutateReadiness({
        taskList: taskListRef.current,
        loopFileReads,
        establishedFacts,
        maxEvidencePaths: mutateReadinessBudget.maxEvidencePaths,
        mutationRequired: mutationNeeded,
        seedPaths,
        seedTrusted,
      }),
    criticMode: loop.criticMode ?? "off",
    toolLoopGuard: new ToolLoopGuard({
      softIdenticalLimit: thresholds.toolLoopSoftIdentical,
      hardIdenticalLimit: thresholds.toolLoopHardIdentical,
      identicalCallAndResultLimit: thresholds.toolLoopIdenticalCallAndResult,
      forcedRejectLimit: thresholds.toolLoopForcedRejectLimit,
    }),
  };
}
