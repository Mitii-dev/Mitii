import type {
  DecisionPolicyInput,
} from "../../../modules/decision-policy";
import {
  DECISION_POLICY_SCHEMA_VERSION,
  toolGrantsEquivalent,
} from "../../../modules/decision-policy";
import type {
  ModelMessage,
} from "../../../modules/model-gateway";
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import {
  PLANNING_SCHEMA_VERSION,
  collectDiscoveryImpactSeedPaths,
  formatPlanAsAnswer,
  inferPlanStrategyFromArtifact,
  planningInputSchema,
  resolvePlanStrategyRules,
  serializePlanForPrompt,
} from "../../../modules/planning";
import type {
  PlanArtifact,
  PlanStrategyDecision,
  PlanningInput,
} from "../../../modules/planning";
import {
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
} from "../../../modules/prompt-construction";
import type {
  PromptInstructions,
  PromptRepositoryContext,
} from "../../../modules/prompt-construction";
import type {
  RepositoryStateReference,
} from "../../../modules/repository-state";
import {
  deriveContextSelectionBudget,
} from "../../../modules/repository-context";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
import { SKILLS_SCHEMA_VERSION } from "../../../modules/skills";
import type {
  RepoBuildState,
  VerificationRecord,
} from "../../../modules/verification";

import {
  annotateMutationToolDefinitions,
  buildClarificationPayload,
  applyExplorationSignal,
  clampRunBudget,
  toRunUsage,
  extractMemoryFileTargets,
  filterToolDefinitions,
  collectPlanningImpactReports,
  mapContextToPromptSlice,
  mapUnderstandingToPlanningEvidence,
  mapUnderstandingToSkillEvidence,
  mergePromptInstructions,
  shouldCaptureUnconditionalAgentPreflight,
  amendMessageWithPriorConversation,
  buildDiagnosticSummary,
  extractMentionedPaths,
  buildPlanningQuery,
  buildScopedRepoMapForPlanning,
  collectPreferredPlanningPaths,
  extractPriorPathHints,
  toPlanningBuildEvidence,
  CONTEXT_READY_VERBOSE_WARNING_CODES,
  CONTEXT_READY_WARNING_CODES,
  deriveContextFocusFromUnderstanding,
  scopeDiscoveredContextPaths,
  createInitialRunEvidence,
  finalizeRunEvidence,
  recordDiscoveryEvidence,
  recordPlanEvidence,
  formatSkillPromptContent,
} from "../actions";
import { applyPlanModeDiscoveryContract } from "../actions/planDiscoveryContract";
import type {
  EstablishedFact,
} from "../actions";
import { ToolCallCache } from "../internal/ToolCallCache";
import { AGENT_ENGINE_SCHEMA_VERSION } from "../constants";
import {
  agentRunBudgetSchema,
  agentRunResultSchema,
} from "../contracts";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  logVerbosityAtLeast,
} from "../internal/logVerbosity";
import {
  attachTaskListTool,
  type TaskListRef,
} from "../internal/taskListRuntime";
import {
  DEFAULT_TOOL_DEFINITIONS,
  PHASE8_SUPPORTED_ROUTES,
} from "../policy";
import { resolveLoopPolicyThresholds } from "../actions/resolveLoopPolicyThresholds";

import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";

import { runModelToolLoop } from "./modelToolLoop";
import {
  finishAfterLoop,
  persistVerificationArtifact,
  tryLoadVerificationRetry,
} from "./verification";
import {
  capturePreflightBuildState,
  resolveAndPinState,
  runDiscoveryPass,
} from "./pinAndDiscovery";

export async function executeStart(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  signal: AbortSignal;
  getCancelReason: () => string | undefined;
  /** Previously approved/edited plan (plan-approval resume or host carry). */
  approvedPlan?: PlanArtifact;
  /** Strategy for an approved/carried plan; inferred from the artifact when omitted. */
  approvedPlanStrategy?: PlanStrategyDecision;
  /** Skip plan-gate suspension (after user approved/edited the plan). */
  skipPlanGate?: boolean;
  /** How an approved plan entered this run (affects reason codes). */
  planSource?: "host_carry" | "resume_approval";
}): Promise<AgentRunResult> {
  const {
    runId,
    input,
    bus,
    signal,
    getCancelReason,
    approvedPlan,
    approvedPlanStrategy,
    skipPlanGate = false,
    planSource,
  } = params;
  const startedMs = Date.now();
  const windowPolicy = runtime.resolveWindowPolicy(input);
  const runBudgetClamp = clampRunBudget(
    agentRunBudgetSchema.parse(input.budget ?? {}),
    windowPolicy,
  );
  const budget = new RunBudgetTracker(runBudgetClamp.budget, startedMs);
  const reasonCodes: AgentReasonCode[] = ["run_started"];
  const warnings: string[] = [];
  if (
    runBudgetClamp.clamped.length > 0 &&
    logVerbosityAtLeast(input.logVerbosity, "standard")
  ) {
    for (const field of runBudgetClamp.clamped) {
      runtime.emit(bus, {
        type: "warning",
        runId,
        message: `Run budget "${field.field}" reduced from ${field.requested} to ${field.effective} by the window policy.`,
        code: "run_budget_clamped",
        data: {
          field: field.field,
          requested: field.requested,
          effective: field.effective,
        },
        at: runtime.isoNow(),
      });
    }
  }
  let pinnedState: RepositoryStateReference | undefined;
  let requestId = input.request.requestId ?? runId;
  let route: AgentRunResult["route"];
  let planningDepth: AgentRunResult["planningDepth"];
  let runPlan: PlanArtifact | undefined;
  let runPlanStrategy: PlanStrategyDecision | undefined;
  let repoBuildStateBefore: RepoBuildState | undefined;
  let repoBuildStateAfter: RepoBuildState | undefined;
  let verificationRecord: VerificationRecord | undefined;
  const runEvidence = createInitialRunEvidence(input.request.userMessage);
  const taskListRef: TaskListRef = {
    current:
      input.request.mode === "ask" || planSource === "resume_approval"
        ? undefined
        : input.taskList,
    maxTasks: windowPolicy.taskList.maxTasks,
    completedPlanStepIds: [],
  };
  let taskListSynced = false;
  const syncTaskListOnce = () => {
    const replacingDiscovery =
      taskListRef.current?.purpose === "discovery" ||
      taskListRef.current?.source === "discovery";
    if (taskListSynced && !replacingDiscovery) return;
    taskListSynced = true;
    runtime.syncTaskList({
      mode: input.request.mode,
      plan: runPlan,
      planningDepth,
      planSource,
      taskListRef,
      runId,
      bus,
      reasonCodes,
      resetExisting: planSource === "resume_approval" || replacingDiscovery,
    });
  };

  const finish = (
    partial: Omit<
      AgentRunResult,
      | "schemaVersion"
      | "runId"
      | "requestId"
      | "usage"
      | "durationMs"
      | "warnings"
      | "reasonCodes"
    > & {
      reasonCodes?: AgentReasonCode[];
      warnings?: string[];
    },
  ): AgentRunResult => {
    const usageSnap = budget.snapshot();
    const finalReasonCodes = [...(partial.reasonCodes ?? reasonCodes)];
    const finalWarnings = [...warnings, ...(partial.warnings ?? [])];
    applyExplorationSignal(usageSnap, finalReasonCodes, finalWarnings);
    const result = agentRunResultSchema.parse({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId,
      requestId,
      status: partial.status,
      route: partial.route ?? route,
      planningDepth: partial.planningDepth ?? planningDepth,
      answer: partial.answer,
      plan: partial.plan ?? runPlan,
      ...(partial.planStrategy ?? runPlanStrategy
        ? { planStrategy: partial.planStrategy ?? runPlanStrategy }
        : {}),
      ...(input.request.mode !== "ask" &&
      (partial.taskList ?? taskListRef.current)
        ? { taskList: partial.taskList ?? taskListRef.current }
        : {}),
      repoBuildStateBefore,
      repoBuildStateAfter,
      ...(verificationRecord ? { verificationRecord } : {}),
      evidence: finalizeRunEvidence({
        evidence: runEvidence,
        status: partial.status,
        reasonCodes: finalReasonCodes,
      }),
      suspension: partial.suspension,
      pinnedState: partial.pinnedState ?? pinnedState,
      reasonCodes: finalReasonCodes,
      warnings: finalWarnings,
      usage: toRunUsage(usageSnap),
      durationMs: Date.now() - startedMs,
      error: partial.error,
    });

    runtime.emit(bus, {
      type: "terminal",
      runId,
      status: result.status,
      result,
      at: runtime.isoNow(),
    });

    return result;
  };

  const cancelledResult = async (): Promise<AgentRunResult> => {
    verificationRecord =
      (await persistVerificationArtifact(runtime, {
        runId,
        requestId,
        workspaceId: resolveWorkspaceId(input),
        bus,
        reasonCodes,
        warnings,
        status: "cancelled",
        before: repoBuildStateBefore,
        after: repoBuildStateAfter,
        previous: verificationRecord,
        logVerbosity: input.logVerbosity,
      })) ?? verificationRecord;
    return finish({
      status: "cancelled",
      reasonCodes: [...reasonCodes, "cancelled"],
      error: {
        code: "cancelled",
        message: getCancelReason() ?? "Run cancelled.",
      },
    });
  };

  try {
    if (signal.aborted) {
      return await cancelledResult();
    }

    // --- Intake ---
    runtime.emitStage(bus, runId, "received", "started");
    const envelope = runtime.deps.intake.intake(input.request);
    requestId = envelope.requestId;
    reasonCodes.push("intake_complete");
    runtime.emitStage(bus, runId, "received", "completed", ["intake_complete"]);

    if (signal.aborted) {
      return await cancelledResult();
    }

    // --- Pin ---
    // Ahead of Decide/Understand now: pin whenever a workspace is
    // resolvable so an Agent-execute preflight snapshot (below) can run
    // before understanding, and so errors can inform classification.
    pinnedState = await resolveAndPinState(runtime, {
      runId,
      envelope,
      input,
      bus,
      reasonCodes,
      warnings,
    });

    if (signal.aborted) {
      await runtime.safeUnpin(runId, pinnedState);
      return await cancelledResult();
    }

    // --- Agent-execute preflight snapshot (before Understand) ---
    // Repair/mutation asks only. Status questions and "run the tests"
    // must not launch discovered e2e/WDIO scripts before the model runs.
    // Plan mode keeps its repair-intent-gated capture further down, once
    // understanding/decision exist.
    if (
      envelope.mode === "agent" &&
      shouldCaptureUnconditionalAgentPreflight(envelope.message)
    ) {
      const retryRecord = await tryLoadVerificationRetry(runtime, {
        workspaceId: resolveWorkspaceId(input),
        userMessage: extractPrimaryUserMessage(envelope.message),
        runId,
        bus,
        warnings,
        logVerbosity: input.logVerbosity,
      });
      if (retryRecord) {
        repoBuildStateBefore = retryRecord.after ?? retryRecord.before;
        verificationRecord = retryRecord;
        reasonCodes.push("verification_retry_loaded");
        if (repoBuildStateBefore) {
          runtime.emitRepoBuildStateCaptured(bus, runId, repoBuildStateBefore);
        }
      } else {
        repoBuildStateBefore = await capturePreflightBuildState(runtime, {
          runId,
          input,
          pinnedState,
          contextPaths: [],
          bus,
          signal,
          reasonCodes,
          warnings,
          unconditional: true,
          mentionedPaths: extractMentionedPaths(
            extractPrimaryUserMessage(envelope.message),
          ),
        });
        if (repoBuildStateBefore) {
          runtime.emitRepoBuildStateCaptured(bus, runId, repoBuildStateBefore);
          verificationRecord =
            (await persistVerificationArtifact(runtime, {
              runId,
              requestId,
              workspaceId: resolveWorkspaceId(input),
              bus,
              reasonCodes,
              warnings,
              status: "captured_before",
              before: repoBuildStateBefore,
              previous: verificationRecord,
              logVerbosity: input.logVerbosity,
            })) ?? verificationRecord;
        }
      }
    }

    if (signal.aborted) {
      await runtime.safeUnpin(runId, pinnedState);
      return await cancelledResult();
    }

    // --- Understand ---
    // Module facade re-validates: message may be conversation-amended here.
    runtime.emitStage(bus, runId, "understood", "started");
    const understandingEnvelope: UserRequestEnvelope =
      input.conversation.length > 0
        ? {
            ...envelope,
            message: amendMessageWithPriorConversation(
              envelope.message,
              input.conversation,
              extractPrimaryUserMessage,
            ),
          }
        : envelope;
    const diagnosticSummary = repoBuildStateBefore
      ? buildDiagnosticSummary(
          repoBuildStateBefore,
          extractPrimaryUserMessage(understandingEnvelope.message),
        )
      : undefined;
    const understanding = await runtime.deps.understanding.understand(
      understandingEnvelope,
      diagnosticSummary,
    );
    reasonCodes.push("understanding_complete");
    runtime.emitStage(bus, runId, "understood", "completed", [
      "understanding_complete",
    ]);

    if (signal.aborted) {
      await runtime.safeUnpin(runId, pinnedState);
      return await cancelledResult();
    }

    // --- Decide ---
    // Validates composed DecisionPolicyInput at its boundary (not a second
    // intake). Uses the original intake envelope, not the amended message.
    runtime.emitStage(bus, runId, "decided", "started");
    let decision = runtime.deps.decision.decide({
      schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
      // Hand-written envelope types use readonly arrays; Zod infer is mutable.
      envelope: envelope as DecisionPolicyInput["envelope"],
      understanding,
      repositoryState: input.repositoryState,
      approvalMode: input.approvalMode,
      planApproval: input.planApproval,
      hostCapabilities: {
        webSearch: runtime.deps.tools?.hasSearchPort?.() === true,
      },
      windowPolicy,
    });
    route = decision.route;
    planningDepth = decision.planningDepth;
    reasonCodes.push("decision_complete");
    runtime.emit(bus, {
      type: "decision_made",
      runId,
      route: decision.route,
      runDisposition: decision.runDisposition,
      maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
      approvalMode: decision.toolGrant.approvalMode,
      pathScopes: decision.toolGrant.pathScopes.slice(0, 20),
      trace: decision.trace,
      at: runtime.isoNow(),
    });
    runtime.emitStage(bus, runId, "decided", "completed", ["decision_complete"]);

    if (signal.aborted) {
      return await cancelledResult();
    }

    // Clarification suspends without model/tools.
    if (
      decision.runDisposition === "clarification_required" ||
      decision.route === "clarify"
    ) {
      reasonCodes.push("clarification_suspended");
      const rationale =
        decision.rationale ||
        "Material clarification is required before continuing.";
      const clarification = buildClarificationPayload(
        understanding,
        rationale,
      );
      if (runtime.deps.checkpointStore) {
        await runtime.deps.checkpointStore.save({
          runId,
          requestId,
          suspensionKind: "clarification_required",
          input,
          decision,
          pinnedState: undefined,
          messages: [],
          toolCacheEntries: [],
          pendingApproval: undefined,
          changedFiles: [],
          mutationCheckpointIds: [],
          reasonCodes,
          warnings,
          usage: budget.snapshot(),
          startedAtMs: startedMs,
          repoBuildStateBefore,
          repoBuildStateAfter,
          ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
          ...(taskListRef.completedPlanStepIds &&
          taskListRef.completedPlanStepIds.length > 0
            ? { completedPlanStepIds: [...taskListRef.completedPlanStepIds] }
            : {}),
        });
      }
      runtime.emit(bus, {
        type: "suspended",
        runId,
        kind: "clarification_required",
        rationale,
        at: runtime.isoNow(),
      });
      // Clarification doesn't need repository context; release the pin
      // taken above rather than leak it (checkpoint intentionally omits
      // pinnedState — a clarification resume re-pins on its own path).
      await runtime.safeUnpin(runId, pinnedState);
      return finish({
        status: "suspended",
        route: decision.route,
        planningDepth: decision.planningDepth,
        suspension: {
          kind: "clarification_required",
          rationale,
          clarificationPrompt: clarification.clarificationPrompt,
          clarificationOptions:
            clarification.clarificationOptions.length > 0
              ? clarification.clarificationOptions
              : undefined,
        },
        reasonCodes,
      });
    }

    // All Phase 8 routes are supported; this only guards against a
    // future/unregistered route reaching the Engine unchanged.
    if (
      !(PHASE8_SUPPORTED_ROUTES as readonly string[]).includes(decision.route)
    ) {
      reasonCodes.push("misconfigured");
      await runtime.safeUnpin(runId, pinnedState);
      return finish({
        status: "failed",
        route: decision.route,
        planningDepth: decision.planningDepth,
        reasonCodes,
        error: {
          code: "misconfigured",
          message: `Unsupported execution route: ${decision.route}.`,
        },
      });
    }

    // --- Context ---
    // Pin already resolved above; only repository-context retrieval left.
    let repositoryContext: PromptRepositoryContext | undefined;
    let contextPaths: string[] = [];

    if (decision.repositoryContextRequired) {
      if (!runtime.deps.repositoryContext || !pinnedState) {
        reasonCodes.push("state_unavailable");
        await runtime.safeUnpin(runId, pinnedState);
        return finish({
          status: "failed",
          reasonCodes,
          error: {
            code: "state_unavailable",
            message:
              "Repository context is required but state/context ports are unavailable.",
          },
        });
      }

      runtime.emitStage(bus, runId, "context_ready", "started");
      const contextQuery = extractPrimaryUserMessage(envelope.message);
      const contextFocus = deriveContextFocusFromUnderstanding(understanding);
      const contextResult = await runtime.deps.repositoryContext.execute({
        state: pinnedState,
        query: contextQuery,
        mode: envelope.mode,
        selectionBudget: deriveContextSelectionBudget(
          runtime.deps.llm.capabilities.contextWindowTokens,
          { maximumTokens: windowPolicy.sections.repositoryTokens },
        ),
        ...(contextFocus.folderPrefix
          ? { folderPrefix: contextFocus.folderPrefix }
          : {}),
        ...(contextFocus.filePaths.length > 0
          ? { filePaths: contextFocus.filePaths }
          : {}),
        ...(contextFocus.kinds.length > 0
          ? { kinds: contextFocus.kinds }
          : {}),
        ...(contextFocus.references
          ? { references: contextFocus.references }
          : {}),
        abortSignal: signal,
      });

      if (signal.aborted || contextResult.status === "cancelled") {
        await runtime.safeUnpin(runId, pinnedState);
        return await cancelledResult();
      }

      if (contextResult.status === "failed") {
        reasonCodes.push("context_failed");
        await runtime.safeUnpin(runId, pinnedState);
        return finish({
          status: "failed",
          reasonCodes,
          error: {
            code: "context_failed",
            message: "Repository context retrieval failed.",
          },
        });
      }

      repositoryContext = mapContextToPromptSlice(contextResult);
      reasonCodes.push("context_retrieved");
      contextPaths = scopeDiscoveredContextPaths(
        contextResult.assembly.blocks
          .map((block) => block.relativePath)
          .filter((path): path is string => Boolean(path?.trim())),
        contextFocus,
      );
      runtime.emit(bus, {
        type: "context_ready",
        runId,
        stateToken: contextResult.stateToken,
        blockCount: contextResult.assembly.blocks.length,
        retrievedCandidates: contextResult.statistics.retrievedCandidates,
        selectedItems: contextResult.statistics.selectedItems,
        droppedBlocks: contextResult.statistics.droppedBlocks,
        status: contextResult.status,
        ...(contextPaths.length > 0 ? { paths: contextPaths } : {}),
        ...(contextResult.retrieval?.sourceReports &&
        contextResult.retrieval.sourceReports.length > 0
          ? {
              retrievalSources: contextResult.retrieval.sourceReports
                .slice(0, 8)
                .map((report) => ({
                  sourceId: report.sourceId,
                  status: report.status,
                  candidateCount: report.candidateCount,
                  ...(report.status === "failed" && report.error
                    ? { error: report.error.slice(0, 300) }
                    : {}),
                })),
            }
          : {}),
        at: runtime.isoNow(),
      });
      for (const warning of contextResult.warnings) {
        const standard = CONTEXT_READY_WARNING_CODES.has(warning.code);
        const verboseOnly = CONTEXT_READY_VERBOSE_WARNING_CODES.has(
          warning.code,
        );
        if (!standard && !verboseOnly) continue;
        if (!logVerbosityAtLeast(input.logVerbosity, standard ? "standard" : "verbose")) {
          continue;
        }
        runtime.emit(bus, {
          type: "warning",
          runId,
          message: warning.message,
          code: warning.code,
          stage: "context_ready",
          at: runtime.isoNow(),
        });
      }
      runtime.emitStage(bus, runId, "context_ready", "completed", [
        "context_retrieved",
      ]);
    } else {
      reasonCodes.push("context_skipped");
    }

    if (signal.aborted) {
      await runtime.safeUnpin(runId, pinnedState);
      return await cancelledResult();
    }

    if (runtime.deps.decision.narrow) {
      const narrowed = runtime.deps.decision.narrow({
        previous: decision,
        discoveredPaths: contextPaths,
        residualRisk: understanding.taskAnalysis.risk,
      });
      if (
        !toolGrantsEquivalent(decision.toolGrant, narrowed.toolGrant)
      ) {
        decision = narrowed;
        reasonCodes.push("grant_narrowed");
        runtime.emit(bus, {
          type: "grant_narrowed",
          runId,
          maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
          approvalMode: decision.toolGrant.approvalMode,
          pathScopes: decision.toolGrant.pathScopes.slice(0, 20),
          reasonCodes: decision.reasonCodes.slice(-8),
          truncated:
            decision.toolGrant.pathScopes.length > 20 ||
            decision.reasonCodes.length > 8
              ? true
              : undefined,
          at: runtime.isoNow(),
        });
      }
    }

    // Agent mode already captured this for repair/mutation asks before
    // Understand. Only Plan mode (repair-intent-gated) reaches this when
    // the early snapshot was skipped.
    if (!repoBuildStateBefore) {
      repoBuildStateBefore = await capturePreflightBuildState(runtime, {
        runId,
        decision,
        understanding,
        input,
        pinnedState,
        contextPaths,
        bus,
        signal,
        reasonCodes,
        warnings,
        mentionedPaths: extractMentionedPaths(
          extractPrimaryUserMessage(envelope.message),
        ),
      });
      if (repoBuildStateBefore) {
        runtime.emitRepoBuildStateCaptured(bus, runId, repoBuildStateBefore);
        verificationRecord =
          (await persistVerificationArtifact(runtime, {
            runId,
            requestId,
            workspaceId: resolveWorkspaceId(input),
            bus,
            reasonCodes,
            warnings,
            status: "captured_before",
            before: repoBuildStateBefore,
            previous: verificationRecord,
            logVerbosity: input.logVerbosity,
          })) ?? verificationRecord;
      }
    }

    // --- Skills (optional) ---
    let selectedSkills: PromptInstructions["skills"];
    if (runtime.deps.skills) {
      runtime.emitStage(bus, runId, "skills_ready", "started");
      const understandingSkillEvidence = mapUnderstandingToSkillEvidence(
        understanding,
        {
          projects: input.projects,
          extraPaths: [...(input.dirtyPaths ?? []), ...contextPaths],
        },
      );
      const skillEvidencePaths = [
        ...new Set(understandingSkillEvidence.paths),
      ]
        .filter((path) => path.trim().length > 0)
        .slice(0, 50);
      const skillsResult = await runtime.deps.skills.select({
        schemaVersion: SKILLS_SCHEMA_VERSION,
        query: extractPrimaryUserMessage(envelope.message),
        mode: envelope.mode,
        route: decision.route,
        budgetTokens: windowPolicy.skills.budgetTokens,
        maxSkills: windowPolicy.skills.maxSkills,
        evidence: {
          ...understandingSkillEvidence,
          paths: skillEvidencePaths,
        },
      });
      selectedSkills = skillsResult.instructions.map((block) => ({
        id: block.id,
        title: block.title,
        content: formatSkillPromptContent(block),
        priority: block.priority,
      }));
      if (skillsResult.warnings.length > 0 && logVerbosityAtLeast(input.logVerbosity, "verbose")) {
        warnings.push(...skillsResult.warnings);
      }
      reasonCodes.push(
        skillsResult.instructions.length > 0
          ? "skills_selected"
          : "skills_skipped",
      );
      runtime.emit(bus, {
        type: "skills_ready",
        runId,
        selectedCount: skillsResult.instructions.length,
        omittedCount: skillsResult.omissions.length,
        status: skillsResult.status,
        selected: skillsResult.instructions
          .map((block) => block.id)
          .filter((id) => id.trim().length > 0)
          .slice(0, 20),
        omitted: skillsResult.omissions
          .map((omission) => omission.skillId)
          .filter((id) => id.trim().length > 0)
          .slice(0, 20),
        omittedDetails: skillsResult.omissions
          .map((omission) => ({
            id: omission.skillId,
            reason: omission.reason,
            ...(typeof omission.tokens === "number"
              ? { tokens: omission.tokens }
              : {}),
          }))
          .slice(0, 20),
        at: runtime.isoNow(),
      });
      runtime.emitStage(bus, runId, "skills_ready", "completed", [
        skillsResult.instructions.length > 0
          ? "skills_selected"
          : "skills_skipped",
      ]);
    } else {
      reasonCodes.push("skills_skipped");
    }

    if (signal.aborted) {
      await runtime.safeUnpin(runId, pinnedState);
      return await cancelledResult();
    }

    // --- Memory (optional) ---
    let selectedMemory: PromptInstructions["memory"];
    const workspaceId = envelope.workspace?.workspaceId;
    if (runtime.deps.memory && workspaceId) {
      runtime.emitStage(bus, runId, "memory_ready", "started");
      const memoryFileTargets = extractMemoryFileTargets(understanding);
      const memoryResult = await runtime.deps.memory.retrieve({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        query: extractPrimaryUserMessage(envelope.message),
        scope: { kind: "workspace", workspaceId },
        now: runtime.isoNow(),
        ...(memoryFileTargets.length > 0
          ? { fileTargets: memoryFileTargets }
          : {}),
      });
      selectedMemory = memoryResult.instructions.map((block) => ({
        id: block.id,
        title: block.title,
        content: block.content,
        priority: block.priority,
      }));
      reasonCodes.push(
        memoryResult.instructions.length > 0
          ? "memory_retrieved"
          : memoryResult.status === "empty"
            ? "memory_empty"
            : "memory_skipped",
      );
      runtime.emit(bus, {
        type: "memory_ready",
        runId,
        selectedCount: memoryResult.instructions.length,
        omittedCount: memoryResult.omissions.length,
        status: memoryResult.status,
        at: runtime.isoNow(),
      });
      runtime.emitStage(bus, runId, "memory_ready", "completed", [
        memoryResult.instructions.length > 0
          ? "memory_retrieved"
          : memoryResult.status === "empty"
            ? "memory_empty"
            : "memory_skipped",
      ]);
    } else {
      reasonCodes.push("memory_skipped");
    }

    if (signal.aborted) {
      await runtime.safeUnpin(runId, pinnedState);
      return await cancelledResult();
    }

    // --- Planning (optional) ---
    let planText: string | undefined;
    if (approvedPlan) {
      runPlan = approvedPlan;
      runPlanStrategy =
        approvedPlanStrategy ?? inferPlanStrategyFromArtifact(approvedPlan);
      planText = serializePlanForPrompt(approvedPlan, runPlanStrategy);
      recordPlanEvidence(runEvidence, approvedPlan);
      runtime.emitEvidenceUpdated(bus, runId, runEvidence);
      if (planSource === "host_carry") {
        reasonCodes.push("plan_drafted", "plan_carried");
      } else {
        reasonCodes.push("plan_drafted", "plan_approved");
      }
    } else if (runtime.deps.planning && decision.planningDepth !== "none") {
      runtime.emitStage(bus, runId, "plan_ready", "started");
      const contextReviewed = (repositoryContext?.blocks ?? [])
        .slice(0, 20)
        .map((block) => ({
          kind: "file" as const,
          ref: block.relativePath,
        }));
      const planningEvidence = mapUnderstandingToPlanningEvidence(understanding);
      const priorPathHints = extractPriorPathHints(input.conversation);
      const knownPathHints = collectPreferredPlanningPaths({
        evidenceTargets: planningEvidence.targets,
        contextPaths,
        priorPathHints,
        query: buildPlanningQuery(
          extractPrimaryUserMessage(envelope.message),
          input.conversation,
        ),
      });
      const planningInputCandidate: PlanningInput = {
        schemaVersion: PLANNING_SCHEMA_VERSION,
        query: buildPlanningQuery(
          extractPrimaryUserMessage(envelope.message),
          input.conversation,
        ),
        mode: envelope.mode,
        route: decision.route,
        planningDepth: decision.planningDepth,
        explorationDepth: input.explorationDepth,
        evidence: planningEvidence,
        scopedRepoMap: buildScopedRepoMapForPlanning(contextPaths),
        buildEvidence: repoBuildStateBefore
          ? toPlanningBuildEvidence(repoBuildStateBefore)
          : undefined,
        skills: selectedSkills?.map((block) => ({
          id: block.id,
          title: block.title,
          content: block.content,
          priority: block.priority,
        })),
        // Reserved: process profiles / skill-derived hints. Empty for now.
        processHints: [],
        contextReviewed:
          contextReviewed.length > 0 ? contextReviewed : undefined,
        ...(knownPathHints.length > 0 ? { knownPathHints } : {}),
        budgetTokens: windowPolicy.planning.budgetTokens,
        maxDiagnosticSteps: windowPolicy.planning.maxDiagnosticSteps,
        maxFilesPerBatch: windowPolicy.mutation.preferredBatchSize,
      };
      const planningInput = planningInputSchema.parse(planningInputCandidate);

      // Engine owns strategy — rules only, no strategy LLM. Planning just
      // drafts against whatever strategyOverride Engine hands it.
      const strategyDecision = resolvePlanStrategyRules(planningInput);
      const planContract = applyPlanModeDiscoveryContract({
        mode: envelope.mode,
        explorationDepth: input.explorationDepth,
        query: planningInput.query,
        conversation: input.conversation ?? [],
        strategy: strategyDecision,
      });
      let strategyOverride: PlanStrategyDecision = planContract.strategy;
      if (planContract.applied) {
        reasonCodes.push("plan_mode_discovery_required");
      }
      let discoveryBrief = planningInput.discoveryBrief;
      // Use the post-contract strategy — Plan mode may have upgraded
      // clarify/plan_from_ask to discover_and_plan.
      if (strategyOverride.strategy === "discover_and_plan") {
        const discovery = await runDiscoveryPass(runtime, {
          runId,
          query: planningInput.query,
          objective:
            planningInput.evidence.requestedOutcomes?.[0] ??
            planningInput.query,
          evidence: planningInput.evidence,
          decision,
          pinnedState,
          workspaceRoot: input.workspaceRoot,
          bus,
          signal,
          budget,
          reasonCodes,
          warnings,
          taskListRef,
          windowPolicy,
          preferredPaths: knownPathHints,
        });
        discoveryBrief = discovery.brief;
        recordDiscoveryEvidence(runEvidence, {
          brief: discovery.brief,
          collector: discovery.collector,
          failed: discovery.failed,
        });
        runtime.emitEvidenceUpdated(bus, runId, runEvidence);
        // Discovery already looked; Planning must not run a second
        // Discover phase. Keep the selected strategy's rationale/confidence.
        strategyOverride = { ...strategyOverride, skipDiscover: true };
      }

      let impactReports = planningInput.impactReports;
      const impactSeedPaths =
        strategyOverride.strategy === "follow_evidence"
          ? (planningInput.buildEvidence?.diagnostics ?? [])
              .filter((diagnostic) => diagnostic.severity === "error")
              .map((diagnostic) => diagnostic.path)
          : strategyOverride.strategy === "discover_and_plan" && discoveryBrief
            ? collectDiscoveryImpactSeedPaths(discoveryBrief)
            : [];
      if (impactSeedPaths.length > 0) {
        impactReports = await collectPlanningImpactReports({
          repoGraphs: runtime.deps.repoGraphs,
          seedPaths: impactSeedPaths,
        });
      }

      const planningResult = await runtime.deps.planning.plan({
        ...planningInput,
        discoveryBrief,
        strategyOverride,
        ...(impactReports && impactReports.length > 0
          ? { impactReports }
          : {}),
      });

      if (planningResult.plan) {
        runPlan = planningResult.plan;
        runPlanStrategy = planningResult.strategy;
        recordPlanEvidence(runEvidence, planningResult.plan);
        planText = serializePlanForPrompt(
          planningResult.plan,
          planningResult.strategy,
        );
        reasonCodes.push("plan_drafted");
        runtime.emit(bus, {
          type: "plan_ready",
          runId,
          planningDepth: decision.planningDepth,
          phaseCount: planningResult.plan.phases.length,
          approvalRequired: planningResult.plan.approvalRequired,
          plan: planningResult.plan,
          at: runtime.isoNow(),
        });
        runtime.emitEvidenceUpdated(bus, runId, runEvidence);
        runtime.emitStage(bus, runId, "plan_ready", "completed", [
          "plan_drafted",
        ]);
        syncTaskListOnce();

        if (
          !skipPlanGate &&
          decision.planGate === "required_before_execute"
        ) {
          reasonCodes.push("plan_approval_suspended");
          const rationale =
            "A reviewable plan is required before mutation. Approve, edit, or reject the plan to continue.";
          if (runtime.deps.checkpointStore) {
            await runtime.deps.checkpointStore.save({
              runId,
              requestId,
              suspensionKind: "plan_approval_required",
              input,
              decision,
              pinnedState,
              messages: [],
              toolCacheEntries: [],
              pendingApproval: undefined,
              plan: planningResult.plan,
              ...(planningResult.strategy
                ? { planStrategy: planningResult.strategy }
                : {}),
              changedFiles: [],
              mutationCheckpointIds: [],
              reasonCodes,
              warnings,
              usage: budget.snapshot(),
              startedAtMs: startedMs,
              repoBuildStateBefore,
              repoBuildStateAfter,
              ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
              ...(taskListRef.completedPlanStepIds &&
              taskListRef.completedPlanStepIds.length > 0
                ? {
                    completedPlanStepIds: [
                      ...taskListRef.completedPlanStepIds,
                    ],
                  }
                : {}),
            });
          }
          runtime.emit(bus, {
            type: "suspended",
            runId,
            kind: "plan_approval_required",
            rationale,
            at: runtime.isoNow(),
          });
          return finish({
            status: "suspended",
            route: decision.route,
            planningDepth: decision.planningDepth,
            plan: planningResult.plan,
            answer: formatPlanAsAnswer(planningResult.plan),
            suspension: {
              kind: "plan_approval_required",
              rationale,
              plan: planningResult.plan,
            },
            reasonCodes,
          });
        }

        // Plan mode deliverable: structured plan is the terminal answer.
        // Skip the model/tool loop — it does not revise PlanArtifact today.
        if (envelope.mode === "plan") {
          reasonCodes.push("plan_mode_completed", "answer_produced");
          await runtime.safeUnpin(runId, pinnedState);
          return finish({
            status: "completed",
            route: decision.route,
            planningDepth: decision.planningDepth,
            plan: planningResult.plan,
            answer: formatPlanAsAnswer(planningResult.plan),
            reasonCodes,
          });
        }
      } else {
        reasonCodes.push("plan_skipped");
        warnings.push(...planningResult.warnings);
        if (planningResult.status === "blocked") {
          // Distinguish "planning wasn't needed" from "planning ran and was
          // rejected" — both used to collapse into the same "plan_skipped".
          if (logVerbosityAtLeast(input.logVerbosity, "standard")) {
            runtime.emit(bus, {
              type: "warning",
              runId,
              message:
                planningResult.warnings[0] ??
                "Plan draft was rejected by validation.",
              code: "plan_blocked_invalid",
              stage: "plan_ready",
              data: { reasonCodes: planningResult.reasonCodes.join(",") },
              at: runtime.isoNow(),
            });
          }
        }
        runtime.emitStage(bus, runId, "plan_ready", "completed", [
          "plan_skipped",
        ]);
      }
    } else {
      reasonCodes.push("plan_skipped");
    }

    syncTaskListOnce();

    if (signal.aborted) {
      await runtime.safeUnpin(runId, pinnedState);
      return await cancelledResult();
    }

    // --- Prompt ---
    const tools = annotateMutationToolDefinitions(
      attachTaskListTool({
        mode: envelope.mode,
        tools: filterToolDefinitions({
          grant: decision.toolGrant,
          definitions:
            input.tools ?? runtime.deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS,
          supportsTools: runtime.deps.llm.capabilities.supportsTools,
        }),
      }),
      decision.toolGrant.mutationBudget,
    );

    const projectRules = [...(input.instructions?.projectRules ?? [])];
    const hostInstructions: PromptInstructions | undefined =
      projectRules.length > 0
        ? {
            ...input.instructions,
            projectRules,
          }
        : input.instructions;

    const instructions = mergePromptInstructions({
      host: hostInstructions,
      skills: selectedSkills,
      memory: selectedMemory,
    });

    const promptResult = runtime.deps.prompt.construct({
      schemaVersion: PROMPT_CONSTRUCTION_SCHEMA_VERSION,
      decision,
      userMessage: envelope.message,
      conversation: input.conversation,
      repositoryContext,
      instructions,
      planText,
      tools,
      capabilities: runtime.deps.llm.capabilities,
      model: input.model,
      temperature: input.temperature,
      stream: input.stream,
      outputReserveTokens: windowPolicy.maximumOutputTokens,
    });

    if (promptResult.status === "blocked") {
      reasonCodes.push("prompt_blocked");
      await runtime.safeUnpin(runId, pinnedState);
      return finish({
        status: "failed",
        reasonCodes,
        warnings: promptResult.warnings,
        error: {
          code: "prompt_blocked",
          message: "Prompt construction blocked the request.",
        },
      });
    }

    reasonCodes.push("prompt_constructed");
    if (promptResult.warnings.length > 0) {
      warnings.push(...promptResult.warnings);
    }
    if (logVerbosityAtLeast(input.logVerbosity, "standard")) {
      runtime.emit(bus, {
        type: "prompt_ready",
        runId,
        status: promptResult.status,
        totalOmittedTokens: promptResult.budget.totalOmittedTokens,
        totalTruncatedTokens: promptResult.budget.totalTruncatedTokens,
        ...(promptResult.omissions.length > 0
          ? {
              omissions: promptResult.omissions.slice(0, 20).map((omission) => ({
                section: omission.section,
                reason: omission.reason,
                ...(typeof omission.tokens === "number"
                  ? { tokens: omission.tokens }
                  : {}),
              })),
            }
          : {}),
        ...(promptResult.warnings.length > 0
          ? { warnings: promptResult.warnings.slice(0, 20) }
          : {}),
        at: runtime.isoNow(),
      });
    }

    // --- Model / tool loop ---
    const messages: ModelMessage[] = [...promptResult.request.messages];
    const toolCache = new ToolCallCache();
    const changedFiles: string[] = [];
    const mutationCheckpointIds: string[] = [];
    const establishedFacts: EstablishedFact[] = [];
    const memoryFacts = selectedMemory?.map((block) => ({
      id: block.id,
      content: block.content,
    }));
    const thresholds = resolveLoopPolicyThresholds({
      contextWindowTokens: windowPolicy.contextWindowTokens,
      overrides: input.loopPolicy?.thresholds,
    }).thresholds;

    const loopOutcome = await runModelToolLoop(runtime, {
      runId,
      request: promptResult.request,
      decision,
      understanding,
      skillsQuery: extractPrimaryUserMessage(envelope.message),
      mode: envelope.mode,
      projects: input.projects,
      dirtyPaths: input.dirtyPaths,
      pinnedState,
      workspaceRoot: input.workspaceRoot,
      bus,
      signal,
      budget,
      reasonCodes,
      warnings,
      messages,
      toolCache,
      changedFiles,
      mutationCheckpointIds,
      taskListRef,
      memoryFacts,
      establishedFacts,
      selectedSkillIds: selectedSkills?.map((block) => block.id) ?? [],
      evidence: runEvidence,
      windowPolicy,
      repoBuildStateBefore,
      logVerbosity: input.logVerbosity,
      reserveVerificationRepairModelCalls: true,
      plan: runPlan,
      thresholds,
    });

    return await finishAfterLoop(runtime, {
      runId,
      requestId,
      input,
      request: promptResult.request,
      decision,
      bus,
      signal,
      pinnedState,
      dirtyPaths: input.dirtyPaths,
      loopOutcome,
      reasonCodes,
      warnings,
      budget,
      startedAtMs: startedMs,
      finish,
      cancelledResult,
      taskListRef,
      repoBuildStateBefore,
      repoBuildStateAfter,
      evidence: runEvidence,
      onRepoBuildStateAfter: (state) => {
        repoBuildStateAfter = state;
      },
      onVerificationRecord: (record) => {
        verificationRecord = record;
      },
      windowPolicy,
      loopContext: {
        understanding,
        skillsQuery: extractPrimaryUserMessage(envelope.message),
        mode: envelope.mode,
        projects: input.projects,
        memoryFacts,
        selectedSkillIds: selectedSkills?.map((block) => block.id) ?? [],
        establishedFacts,
        plan: runPlan,
      },
    });
  } catch (error) {
    await runtime.safeUnpin(runId, pinnedState);
    if (signal.aborted) {
      return await cancelledResult();
    }
    return finish({
      status: "failed",
      reasonCodes: [...reasonCodes, "provider_failed"],
      error: {
        code: "execution_failed",
        message:
          error instanceof Error ? error.message : "Agent run failed.",
      },
    });
  }
}
