import type {
  DecisionPolicyInput,
  ExecutionDecision,
  ToolGrant,
} from "../../../modules/decision-policy";
import {
  DECISION_POLICY_SCHEMA_VERSION,
  READ_ONLY_TOOL_IDS,
  buildVerificationGrant,
  toolGrantsEquivalent,
} from "../../../modules/decision-policy";
import type {
  LlmPort,
  ModelEvent,
  ModelMessage,
  ModelRequest,
  ModelToolCall,
  ModelToolCallDelta,
} from "../../../modules/model-gateway";
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import type { MemoryCommitInput } from "../../../modules/memory";
import {
  DEFAULT_PLAN_CHARACTERS_PER_TOKEN,
  PLANNING_SCHEMA_VERSION,
  compileDiscoveryBrief,
  collectDiscoveryImpactSeedPaths,
  formatPlanAsAnswer,
  inferPlanStrategyFromArtifact,
  planningInputSchema,
  resolvePlanStrategyRules,
  serializePlanForPrompt,
} from "../../../modules/planning";
import type {
  DiscoveryBrief,
  DiscoveryTarget,
  PlanArtifact,
  PlanStrategyDecision,
  PlanningInput,
} from "../../../modules/planning";
import type { TaskList } from "../../../modules/task-list";
import {
  CharacterTokenEstimator,
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
} from "../../../modules/prompt-construction";
import type {
  PromptInstructions,
  PromptRepositoryContext,
  TokenEstimatorPort,
} from "../../../modules/prompt-construction";
import type {
  ProjectDescriptor,
  RepositoryStateReference,
} from "../../../modules/repository-state";
import {
  deriveContextSelectionBudget,
  pathMatchesFolderPrefix,
} from "../../../modules/repository-context";
import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
  resolveGenerationCeiling,
} from "../../../modules/window-budget";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type {
  DiagnosticSummary,
  RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
import { SKILLS_SCHEMA_VERSION } from "../../../modules/skills";
import {
  TOOL_RUNTIME_SCHEMA_VERSION,
  fingerprintToolCall,
  isPatchTargetedDiscoveryReason,
  toolResultSchema,
} from "../../tool-runtime";
import type { ToolApprovalToken, ToolResult } from "../../tool-runtime";
import {
  VERIFICATION_SCHEMA_VERSION,
  buildVerificationRecord,
  buildVerificationUserSummary,
} from "../../../modules/verification";
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationInput,
  VerificationRecord,
  VerificationRecordStatus,
  VerificationResult,
} from "../../../modules/verification";

import {
  amendMessageWithClarification,
  assembleToolCalls,
  annotateMutationToolDefinitions,
  buildClarificationPayload,
  buildExplorationStallNudge,
  buildIncompleteAnswerRecoveryMessage,
  buildOutputTruncationRecovery,
  buildPreflightDiagnosticRepairInstruction,
  buildVerificationRepairPrompt,
  clampTurnMaximumOutputTokens,
  compactModelLoopMessages,
  stubToolResultsForCompletedPaths,
  decideVerificationGate,
  estimateModelMessagesTokens,
  dropEstablishedFactsForPaths,
  extractEstablishedFact,
  extractFileReadPaths,
  extractMutationTargetPaths,
  missingMustReadPaths,
  buildMustReadNudgeMessage,
  extractMemoryFileTargets,
  filterToolDefinitions,
  isExplorationRereadHeavy,
  createLoopFileReadTracker,
  recordLoopFileReads,
  resetLoopFileReadTracker,
  snapshotLoopFileReads,
  upsertEstablishedFact,
  isEmptyAssistantTurn,
  isTransitionalAssistantAnswer,
  compactRecoveredAssistantContent,
  collectPlanningImpactReports,
  selectUserFacingLoopAnswer,
  mapContextToPromptSlice,
  mapUnderstandingToPlanningEvidence,
  mapUnderstandingToSkillEvidence,
  mergePromptInstructions,
  serializeToolResultForModel,
  shouldRecoverIncompleteAssistantTurn,
  synthesizeFallbackAnswer,
  amendMessageWithPriorConversation,
  resolveLoopTurnOutcome,
  requiresMutationForExecute,
  buildUnfulfilledExecuteRecoveryMessage,
  shouldContinueVerificationRepair,
  nextStalledRepairCount,
  reservedVerificationRepairModelCalls,
  recoverLeakedToolCallsFromMarkup,
} from "../actions";
import type {
  EstablishedFact,
  LoopFileReadTracker,
  VerificationGateDecision,
} from "../actions";
import { ToolCallCache, rebaseToolResult } from "../internal/ToolCallCache";
import { AGENT_ENGINE_SCHEMA_VERSION } from "../constants";
import {
  agentEngineResumeInputSchema,
  agentEngineStartInputSchema,
  agentRunBudgetSchema,
  agentRunResultSchema,
  AgentEngineError,
} from "../contracts";
import type {
  AgentActiveStage,
  AgentEngineDependencies,
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunHandle,
  AgentRunResult,
  AgentRunStatus,
  RunEvidence,
  RunEvent,
} from "../contracts";
import {
  DISCOVERY_PASS_POLICY,
  buildDiscoveryPrompt,
  createDiscoveryGrant,
  createDiscoveryObservationCollector,
  createDiscoveryTaskList,
  discoveryBudgetRemaining,
  isDiscoveryToolAllowed,
  recordDiscoveryToolUse,
  toDiscoveryObservation,
} from "../internal/discoveryPass";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import { describeCaughtError } from "../internal/describeCaughtError";
import type { PendingApprovalState } from "../internal/RunCheckpoint";
import {
  applyUpdateTodosArguments,
  attachTaskListTool,
  buildUpdateTodosToolResult,
  canonicalizeUpdateTodosToolName,
  isUpdateTodosTool,
  maybeAutoAdvanceTaskList,
  maybeRefillTaskListFromPlan,
  prepareRepairWorkingSet,
  progressOf,
  seedTaskListFromPlan,
  upsertTrailingWorkingSet,
  collectCompletedTaskPaths,
  type TaskListRef,
} from "../internal/taskListRuntime";
import {
  AGENT_ENGINE_THRESHOLDS,
  DEFAULT_MUTATION_TOOL_DEFINITIONS,
  DEFAULT_TOOL_DEFINITIONS,
  PHASE8_SUPPORTED_ROUTES,
} from "../policy";

export type AgentEnginePipelineDependencies = AgentEngineDependencies;

const DEFAULT_MUTATING_TOOL_NAMES = new Set(
  DEFAULT_MUTATION_TOOL_DEFINITIONS.map((tool) => tool.name),
);
const TARGETED_REJECTED_MUTATION_DISCOVERY_TOOLS = new Set([
  "analyze_change_impact",
  "file_metadata",
  "glob_files",
  "list_directory",
  "read_file",
  "read_many_files",
  "search_files",
]);

type ToolCallOutcome =
  | { kind: "message"; message: ModelMessage }
  | {
      kind: "approval_required";
      toolName: string;
      callId: string;
      fingerprint: string;
      arguments: unknown;
      paths: string[];
    };

type ToolLoopOutcome =
  | {
      kind: "completed";
      answer: string;
      changedFiles: string[];
      mutationCheckpointIds: string[];
      messages: ModelMessage[];
      toolCache: ToolCallCache;
      /** Authority as of the end of the loop — may have been refreshed mid-run. */
      decision: ExecutionDecision;
    }
  | {
      kind: "approval_required";
      messages: ModelMessage[];
      toolCache: ToolCallCache;
      pendingApproval: PendingApprovalState;
      changedFiles: string[];
      mutationCheckpointIds: string[];
      answer?: string;
      /** Authority as of the end of the loop — may have been refreshed mid-run. */
      decision: ExecutionDecision;
    }
  | { kind: "cancelled" }
  | {
      kind: "budget_exhausted";
      answer?: string;
      message: string;
      changedFiles: string[];
      mutationCheckpointIds: string[];
    }
  | {
      kind: "failed";
      answer?: string;
      extraReasons: AgentReasonCode[];
      error: { code: string; message: string };
    };

type VerificationGateOutcome =
  | {
      kind: "ok";
      acceptKind: Extract<
        VerificationGateDecision,
        { action: "accept" }
      >["acceptKind"];
      verification?: VerificationResult;
      comparison?: RepoBuildStateComparison;
    }
  | {
      kind: "failed";
      repairable: boolean;
      /** Distinguishes a repairable failure from a hard block/cancel/infra-unavailable reject. */
      rejectKind: Extract<
        VerificationGateDecision,
        { action: "reject" }
      >["rejectKind"];
      error: { code: string; message: string };
      verification?: VerificationResult;
      /** Before/after diagnostic diff, when a saved before-state exists. */
      comparison?: RepoBuildStateComparison;
    };

/**
 * Agent Engine facade (Phase 8 mutation + Phase 9 optional Skills/Memory).
 *
 * Flow:
 *   Intake → Understand → Decide → pin Repository State
 *   → select Skills (optional) → retrieve Memory (optional)
 *   → retrieve Context → construct Prompt → invoke Model
 *   → execute authorized Tools (read-only or mutating) as needed
 *   → verify changes → produce Result
 *
 * Mutation tool calls that require approval suspend the run with a
 * persisted checkpoint; `resume()` continues without replaying completed
 * tool callIds. Does not implement understanding, policy, retrieval,
 * prompting, tool enforcement, skills/memory selection, or verification.
 */
export class AgentEnginePipeline {
  private readonly deps: Required<
    Pick<
      AgentEngineDependencies,
      | "intake"
      | "understanding"
      | "decision"
      | "prompt"
      | "llm"
      | "clock"
      | "idGenerator"
    >
  > &
    Pick<
      AgentEngineDependencies,
      | "skills"
      | "memory"
      | "planning"
      | "repositoryState"
      | "repositoryContext"
      | "tools"
      | "verification"
      | "checkpointStore"
      | "toolDefinitions"
      | "taskListAutoAdvance"
      | "repoGraphs"
    >;

  constructor(dependencies: AgentEngineDependencies) {
    if (
      !dependencies.intake ||
      !dependencies.understanding ||
      !dependencies.decision ||
      !dependencies.prompt ||
      !dependencies.llm
    ) {
      throw new AgentEngineError(
        "misconfigured_ports",
        "AgentEnginePipeline requires intake, understanding, decision, prompt, and llm.",
      );
    }

    this.deps = {
      intake: dependencies.intake,
      understanding: dependencies.understanding,
      decision: dependencies.decision,
      prompt: dependencies.prompt,
      llm: dependencies.llm,
      skills: dependencies.skills,
      memory: dependencies.memory,
      planning: dependencies.planning,
      repositoryState: dependencies.repositoryState,
      repositoryContext: dependencies.repositoryContext,
      tools: dependencies.tools,
      verification: dependencies.verification,
      checkpointStore: dependencies.checkpointStore,
      repoGraphs: dependencies.repoGraphs,
      toolDefinitions: dependencies.toolDefinitions,
      taskListAutoAdvance: dependencies.taskListAutoAdvance,
      clock: dependencies.clock ?? { now: () => new Date() },
      idGenerator: dependencies.idGenerator ?? {
        next: (prefix: string) =>
          `${prefix}_${Math.random().toString(36).slice(2, 10)}`,
      },
    };
  }

  private readonly tokenEstimator: TokenEstimatorPort =
    new CharacterTokenEstimator();

  public start(input: AgentEngineStartInput): AgentRunHandle {
    let parsed: AgentEngineStartInput;
    try {
      parsed = agentEngineStartInputSchema.parse(input);
    } catch (error) {
      throw new AgentEngineError(
        "invalid_input",
        "Agent Engine start input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const runId = this.deps.idGenerator.next("run");
    const carriedPlan = parsed.approvedPlan;
    return this.createRunHandle(runId, (bus, signal, getCancelReason) =>
      this.executeRun({
        runId,
        input: parsed,
        bus,
        signal,
        getCancelReason,
        approvedPlan: carriedPlan,
        approvedPlanStrategy: parsed.approvedPlanStrategy,
        skipPlanGate: Boolean(carriedPlan),
        planSource: carriedPlan ? "host_carry" : undefined,
      }),
    );
  }

  /**
   * Resume a suspended run after clarification or approval.
   * Continues from the persisted checkpoint; does not replay completed
   * tool callIds.
   */
  public resume(input: AgentEngineResumeInput): AgentRunHandle {
    let parsed: AgentEngineResumeInput;
    try {
      parsed = agentEngineResumeInputSchema.parse(input);
    } catch (error) {
      throw new AgentEngineError(
        "invalid_input",
        "Agent Engine resume input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    return this.createRunHandle(parsed.runId, (bus, signal, getCancelReason) =>
      this.executeResume({ input: parsed, bus, signal, getCancelReason }),
    );
  }

  private createRunHandle(
    runId: string,
    execute: (
      bus: EventBus,
      signal: AbortSignal,
      getCancelReason: () => string | undefined,
    ) => Promise<AgentRunResult>,
  ): AgentRunHandle {
    const bus = new EventBus();
    const abort = new AbortController();
    let cancelReason: string | undefined;

    const resultPromise = execute(bus, abort.signal, () => cancelReason).finally(
      () => {
        bus.end();
      },
    );

    return {
      runId,
      events: bus.asIterable(),
      result: resultPromise,
      cancel: (reason?: string) => {
        cancelReason = reason ?? "cancelled_by_caller";
        abort.abort();
      },
    };
  }

  private async executeRun(params: {
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
    const windowPolicy = this.resolveWindowPolicy(input);
    const runBudgetClamp = this.clampRunBudget(
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
        this.emit(bus, {
          type: "warning",
          runId,
          message: `Run budget "${field.field}" reduced from ${field.requested} to ${field.effective} by the window policy.`,
          code: "run_budget_clamped",
          data: {
            field: field.field,
            requested: field.requested,
            effective: field.effective,
          },
          at: this.isoNow(),
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
    };
    let taskListSynced = false;
    const syncTaskListOnce = () => {
      const replacingDiscovery =
        taskListRef.current?.purpose === "discovery" ||
        taskListRef.current?.source === "discovery";
      if (taskListSynced && !replacingDiscovery) return;
      taskListSynced = true;
      this.syncTaskList({
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
      this.applyExplorationSignal(usageSnap, finalReasonCodes, finalWarnings);
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
        usage: this.toRunUsage(usageSnap),
        durationMs: Date.now() - startedMs,
        error: partial.error,
      });

      this.emit(bus, {
        type: "terminal",
        runId,
        status: result.status,
        result,
        at: this.isoNow(),
      });

      return result;
    };

    const cancelledResult = async (): Promise<AgentRunResult> => {
      verificationRecord =
        (await this.persistVerificationArtifact({
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
      this.emitStage(bus, runId, "received", "started");
      const envelope = this.deps.intake.intake(input.request);
      requestId = envelope.requestId;
      reasonCodes.push("intake_complete");
      this.emitStage(bus, runId, "received", "completed", ["intake_complete"]);

      if (signal.aborted) {
        return await cancelledResult();
      }

      // --- Pin ---
      // Ahead of Decide/Understand now: pin whenever a workspace is
      // resolvable so an Agent-execute preflight snapshot (below) can run
      // before understanding, and so errors can inform classification.
      pinnedState = await this.resolveAndPinState({
        runId,
        envelope,
        input,
        bus,
        reasonCodes,
        warnings,
      });

      if (signal.aborted) {
        await this.safeUnpin(runId, pinnedState);
        return await cancelledResult();
      }

      // --- Agent-execute preflight snapshot (before Understand) ---
      // Unconditional for Agent mode: no repair-intent gate, no Decision
      // Policy grant yet (uses a conservative synthesized read-only grant).
      // Plan mode keeps its repair-intent-gated capture further down, once
      // understanding/decision exist.
      if (envelope.mode === "agent") {
        const retryRecord = await this.tryLoadVerificationRetry({
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
            this.emitRepoBuildStateCaptured(bus, runId, repoBuildStateBefore);
          }
        } else {
          repoBuildStateBefore = await this.capturePreflightBuildState({
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
            this.emitRepoBuildStateCaptured(bus, runId, repoBuildStateBefore);
            verificationRecord =
              (await this.persistVerificationArtifact({
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
        await this.safeUnpin(runId, pinnedState);
        return await cancelledResult();
      }

      // --- Understand ---
      // Module facade re-validates: message may be conversation-amended here.
      this.emitStage(bus, runId, "understood", "started");
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
      const understanding = await this.deps.understanding.understand(
        understandingEnvelope,
        diagnosticSummary,
      );
      reasonCodes.push("understanding_complete");
      this.emitStage(bus, runId, "understood", "completed", [
        "understanding_complete",
      ]);

      if (signal.aborted) {
        await this.safeUnpin(runId, pinnedState);
        return await cancelledResult();
      }

      // --- Decide ---
      // Validates composed DecisionPolicyInput at its boundary (not a second
      // intake). Uses the original intake envelope, not the amended message.
      this.emitStage(bus, runId, "decided", "started");
      let decision = this.deps.decision.decide({
        schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
        // Hand-written envelope types use readonly arrays; Zod infer is mutable.
        envelope: envelope as DecisionPolicyInput["envelope"],
        understanding,
        repositoryState: input.repositoryState,
        approvalMode: input.approvalMode,
        planApproval: input.planApproval,
        hostCapabilities: {
          webSearch: this.deps.tools?.hasSearchPort?.() === true,
        },
        windowPolicy,
      });
      route = decision.route;
      planningDepth = decision.planningDepth;
      reasonCodes.push("decision_complete");
      this.emit(bus, {
        type: "decision_made",
        runId,
        route: decision.route,
        runDisposition: decision.runDisposition,
        maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
        approvalMode: decision.toolGrant.approvalMode,
        pathScopes: decision.toolGrant.pathScopes.slice(0, 20),
        trace: decision.trace,
        at: this.isoNow(),
      });
      this.emitStage(bus, runId, "decided", "completed", ["decision_complete"]);

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
        if (this.deps.checkpointStore) {
          await this.deps.checkpointStore.save({
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
          });
        }
        this.emit(bus, {
          type: "suspended",
          runId,
          kind: "clarification_required",
          rationale,
          at: this.isoNow(),
        });
        // Clarification doesn't need repository context; release the pin
        // taken above rather than leak it (checkpoint intentionally omits
        // pinnedState — a clarification resume re-pins on its own path).
        await this.safeUnpin(runId, pinnedState);
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
        await this.safeUnpin(runId, pinnedState);
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
        if (!this.deps.repositoryContext || !pinnedState) {
          reasonCodes.push("state_unavailable");
          await this.safeUnpin(runId, pinnedState);
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

        this.emitStage(bus, runId, "context_ready", "started");
        const contextQuery = extractPrimaryUserMessage(envelope.message);
        const contextFocus = deriveContextFocusFromUnderstanding(understanding);
        const contextResult = await this.deps.repositoryContext.execute({
          state: pinnedState,
          query: contextQuery,
          mode: envelope.mode,
          selectionBudget: deriveContextSelectionBudget(
            this.deps.llm.capabilities.contextWindowTokens,
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
          await this.safeUnpin(runId, pinnedState);
          return await cancelledResult();
        }

        if (contextResult.status === "failed") {
          reasonCodes.push("context_failed");
          await this.safeUnpin(runId, pinnedState);
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
        this.emit(bus, {
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
          at: this.isoNow(),
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
          this.emit(bus, {
            type: "warning",
            runId,
            message: warning.message,
            code: warning.code,
            stage: "context_ready",
            at: this.isoNow(),
          });
        }
        this.emitStage(bus, runId, "context_ready", "completed", [
          "context_retrieved",
        ]);
      } else {
        reasonCodes.push("context_skipped");
      }

      if (signal.aborted) {
        await this.safeUnpin(runId, pinnedState);
        return await cancelledResult();
      }

      if (this.deps.decision.narrow) {
        const narrowed = this.deps.decision.narrow({
          previous: decision,
          discoveredPaths: contextPaths,
          residualRisk: understanding.taskAnalysis.risk,
        });
        if (
          !toolGrantsEquivalent(decision.toolGrant, narrowed.toolGrant)
        ) {
          decision = narrowed;
          reasonCodes.push("grant_narrowed");
          this.emit(bus, {
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
            at: this.isoNow(),
          });
        }
      }

      // Agent mode already captured this unconditionally before Understand.
      // Only Plan mode (repair-intent-gated) reaches this.
      if (!repoBuildStateBefore) {
        repoBuildStateBefore = await this.capturePreflightBuildState({
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
          this.emitRepoBuildStateCaptured(bus, runId, repoBuildStateBefore);
          verificationRecord =
            (await this.persistVerificationArtifact({
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
      if (this.deps.skills) {
        this.emitStage(bus, runId, "skills_ready", "started");
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
        const skillsResult = await this.deps.skills.select({
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
        this.emit(bus, {
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
          at: this.isoNow(),
        });
        this.emitStage(bus, runId, "skills_ready", "completed", [
          skillsResult.instructions.length > 0
            ? "skills_selected"
            : "skills_skipped",
        ]);
      } else {
        reasonCodes.push("skills_skipped");
      }

      if (signal.aborted) {
        await this.safeUnpin(runId, pinnedState);
        return await cancelledResult();
      }

      // --- Memory (optional) ---
      let selectedMemory: PromptInstructions["memory"];
      const workspaceId = envelope.workspace?.workspaceId;
      if (this.deps.memory && workspaceId) {
        this.emitStage(bus, runId, "memory_ready", "started");
        const memoryFileTargets = extractMemoryFileTargets(understanding);
        const memoryResult = await this.deps.memory.retrieve({
          schemaVersion: MEMORY_SCHEMA_VERSION,
          query: extractPrimaryUserMessage(envelope.message),
          scope: { kind: "workspace", workspaceId },
          now: this.isoNow(),
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
        this.emit(bus, {
          type: "memory_ready",
          runId,
          selectedCount: memoryResult.instructions.length,
          omittedCount: memoryResult.omissions.length,
          status: memoryResult.status,
          at: this.isoNow(),
        });
        this.emitStage(bus, runId, "memory_ready", "completed", [
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
        await this.safeUnpin(runId, pinnedState);
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
        this.emitEvidenceUpdated(bus, runId, runEvidence);
        if (planSource === "host_carry") {
          reasonCodes.push("plan_drafted", "plan_carried");
        } else {
          reasonCodes.push("plan_drafted", "plan_approved");
        }
      } else if (this.deps.planning && decision.planningDepth !== "none") {
        this.emitStage(bus, runId, "plan_ready", "started");
        const contextReviewed = (repositoryContext?.blocks ?? [])
          .slice(0, 20)
          .map((block) => ({
            kind: "file" as const,
            ref: block.relativePath,
          }));
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
          evidence: mapUnderstandingToPlanningEvidence(understanding),
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
          budgetTokens: windowPolicy.planning.budgetTokens,
          maxDiagnosticSteps: windowPolicy.planning.maxDiagnosticSteps,
          maxFilesPerBatch: windowPolicy.mutation.preferredBatchSize,
        };
        const planningInput = planningInputSchema.parse(planningInputCandidate);

        // Engine owns strategy — rules only, no strategy LLM. Planning just
        // drafts against whatever strategyOverride Engine hands it.
        const strategyDecision = resolvePlanStrategyRules(planningInput);
        let strategyOverride: PlanStrategyDecision = strategyDecision;
        let discoveryBrief = planningInput.discoveryBrief;
        if (strategyDecision.strategy === "discover_and_plan") {
          const discovery = await this.runDiscoveryPass({
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
          });
          discoveryBrief = discovery.brief;
          recordDiscoveryEvidence(runEvidence, {
            brief: discovery.brief,
            collector: discovery.collector,
            failed: discovery.failed,
          });
          this.emitEvidenceUpdated(bus, runId, runEvidence);
          // Discovery already looked; Planning must not run a second
          // Discover phase. Keep the rules' own rationale/confidence.
          strategyOverride = { ...strategyDecision, skipDiscover: true };
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
            repoGraphs: this.deps.repoGraphs,
            seedPaths: impactSeedPaths,
          });
        }

        const planningResult = await this.deps.planning.plan({
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
          this.emit(bus, {
            type: "plan_ready",
            runId,
            planningDepth: decision.planningDepth,
            phaseCount: planningResult.plan.phases.length,
            approvalRequired: planningResult.plan.approvalRequired,
            plan: planningResult.plan,
            at: this.isoNow(),
          });
          this.emitEvidenceUpdated(bus, runId, runEvidence);
          this.emitStage(bus, runId, "plan_ready", "completed", [
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
            if (this.deps.checkpointStore) {
              await this.deps.checkpointStore.save({
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
              });
            }
            this.emit(bus, {
              type: "suspended",
              runId,
              kind: "plan_approval_required",
              rationale,
              at: this.isoNow(),
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
            await this.safeUnpin(runId, pinnedState);
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
              this.emit(bus, {
                type: "warning",
                runId,
                message:
                  planningResult.warnings[0] ??
                  "Plan draft was rejected by validation.",
                code: "plan_blocked_invalid",
                stage: "plan_ready",
                data: { reasonCodes: planningResult.reasonCodes.join(",") },
                at: this.isoNow(),
              });
            }
          }
          this.emitStage(bus, runId, "plan_ready", "completed", [
            "plan_skipped",
          ]);
        }
      } else {
        reasonCodes.push("plan_skipped");
      }

      syncTaskListOnce();

      if (signal.aborted) {
        await this.safeUnpin(runId, pinnedState);
        return await cancelledResult();
      }

      // --- Prompt ---
      const tools = annotateMutationToolDefinitions(
        attachTaskListTool({
          mode: envelope.mode,
          tools: filterToolDefinitions({
            grant: decision.toolGrant,
            definitions:
              input.tools ?? this.deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS,
            supportsTools: this.deps.llm.capabilities.supportsTools,
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

      const promptResult = this.deps.prompt.construct({
        schemaVersion: PROMPT_CONSTRUCTION_SCHEMA_VERSION,
        decision,
        userMessage: envelope.message,
        conversation: input.conversation,
        repositoryContext,
        instructions,
        planText,
        tools,
        capabilities: this.deps.llm.capabilities,
        model: input.model,
        temperature: input.temperature,
        stream: input.stream,
        outputReserveTokens: windowPolicy.maximumOutputTokens,
      });

      if (promptResult.status === "blocked") {
        reasonCodes.push("prompt_blocked");
        await this.safeUnpin(runId, pinnedState);
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
        this.emit(bus, {
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
          at: this.isoNow(),
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

      const loopOutcome = await this.runModelToolLoop({
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
      });

      return await this.finishAfterLoop({
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
      await this.safeUnpin(runId, pinnedState);
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

  private async executeResume(params: {
    input: AgentEngineResumeInput;
    bus: EventBus;
    signal: AbortSignal;
    getCancelReason: () => string | undefined;
  }): Promise<AgentRunResult> {
    const { input, bus, signal, getCancelReason } = params;
    const runId = input.runId;

    if (!this.deps.checkpointStore) {
      throw new AgentEngineError(
        "misconfigured_ports",
        "Resume requires a checkpoint store.",
      );
    }

    const checkpoint = await this.deps.checkpointStore.load(runId);
    if (!checkpoint) {
      throw new AgentEngineError(
        "invalid_input",
        `No suspended run checkpoint found for run "${runId}".`,
      );
    }

    const requestId = checkpoint.requestId;
    const decision = input.approvalMode
      ? {
          ...checkpoint.decision,
          toolGrant: {
            ...checkpoint.decision.toolGrant,
            approvalMode: input.approvalMode,
          },
        }
      : checkpoint.decision;
    const startInput = input.approvalMode
      ? { ...checkpoint.input, approvalMode: input.approvalMode }
      : checkpoint.input;
    const windowPolicy = this.resolveWindowPolicy(startInput);
    const taskListRef: TaskListRef = {
      current: checkpoint.taskList,
      maxTasks: windowPolicy.taskList.maxTasks,
    };
    const pinnedState = checkpoint.pinnedState;
    const reasonCodes: AgentReasonCode[] = [...checkpoint.reasonCodes];
    const warnings: string[] = [...checkpoint.warnings];
    let repoBuildStateAfter = checkpoint.repoBuildStateAfter;
    let verificationRecord: VerificationRecord | undefined;
    const resumedAtMs = Date.now();
    const suspensionWaitMs =
      checkpoint.suspendedAtMs !== undefined
        ? Math.max(0, resumedAtMs - checkpoint.suspendedAtMs)
        : 0;
    const excludedWaitMs =
      (checkpoint.excludedWaitMs ?? 0) + suspensionWaitMs;
    const resumeBudgetClamp = this.clampRunBudget(
      agentRunBudgetSchema.parse(startInput.budget ?? {}),
      windowPolicy,
    );
    const budget = new RunBudgetTracker(
      resumeBudgetClamp.budget,
      checkpoint.startedAtMs,
      checkpoint.usage,
      excludedWaitMs,
    );
    if (
      resumeBudgetClamp.clamped.length > 0 &&
      logVerbosityAtLeast(startInput.logVerbosity, "standard")
    ) {
      for (const field of resumeBudgetClamp.clamped) {
        this.emit(bus, {
          type: "warning",
          runId,
          message: `Run budget "${field.field}" reduced from ${field.requested} to ${field.effective} by the window policy.`,
          code: "run_budget_clamped",
          data: {
            field: field.field,
            requested: field.requested,
            effective: field.effective,
          },
          at: this.isoNow(),
        });
      }
    }

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
      this.applyExplorationSignal(usageSnap, finalReasonCodes, finalWarnings);
      const result = agentRunResultSchema.parse({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId,
        requestId,
        status: partial.status,
        route: partial.route ?? decision.route,
        planningDepth: partial.planningDepth ?? decision.planningDepth,
        answer: partial.answer,
        plan: partial.plan ?? checkpoint.plan,
        ...(partial.planStrategy ?? checkpoint.planStrategy
          ? {
              planStrategy: partial.planStrategy ?? checkpoint.planStrategy,
            }
          : {}),
        ...(startInput.request.mode !== "ask" &&
        (partial.taskList ?? taskListRef.current)
          ? { taskList: partial.taskList ?? taskListRef.current }
          : {}),
        repoBuildStateBefore: checkpoint.repoBuildStateBefore,
        repoBuildStateAfter,
        ...(verificationRecord ? { verificationRecord } : {}),
        suspension: partial.suspension,
        pinnedState: partial.pinnedState ?? pinnedState,
        reasonCodes: finalReasonCodes,
        warnings: finalWarnings,
        usage: this.toRunUsage(usageSnap),
        durationMs: Date.now() - checkpoint.startedAtMs,
        error: partial.error,
      });

      this.emit(bus, {
        type: "terminal",
        runId,
        status: result.status,
        result,
        at: this.isoNow(),
      });

      return result;
    };

    const cancelledResult = async (): Promise<AgentRunResult> => {
      verificationRecord =
        (await this.persistVerificationArtifact({
          runId,
          requestId,
          workspaceId: resolveWorkspaceId(startInput),
          bus,
          reasonCodes,
          warnings,
          status: "cancelled",
          before: checkpoint.repoBuildStateBefore,
          after: repoBuildStateAfter,
          previous: verificationRecord,
          logVerbosity: startInput.logVerbosity,
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

      if (checkpoint.suspensionKind === "clarification_required") {
        if (!input.clarificationAnswer) {
          throw new AgentEngineError(
            "invalid_input",
            "Resuming a clarification-required run requires clarificationAnswer.",
          );
        }
        await this.deps.checkpointStore.delete(runId);
        reasonCodes.push("resume_complete");
        const clarifiedMessage = amendMessageWithClarification(
          startInput.request.userMessage,
          input.clarificationAnswer,
        );
        const amendedInput: AgentEngineStartInput = {
          ...startInput,
          request: {
            ...startInput.request,
            userMessage: clarifiedMessage,
          },
          conversation: [
            ...startInput.conversation,
            { role: "user", content: input.clarificationAnswer },
          ],
        };
        return this.executeRun({
          runId,
          input: amendedInput,
          bus,
          signal,
          getCancelReason,
        });
      }

      if (checkpoint.suspensionKind === "plan_approval_required") {
        if (!input.planDecision) {
          throw new AgentEngineError(
            "invalid_input",
            "Resuming a plan-approval-required run requires planDecision.",
          );
        }

        if (input.planDecision.decision === "rejected") {
          await this.deps.checkpointStore.delete(runId);
          await this.safeUnpin(runId, pinnedState);
          reasonCodes.push("plan_rejected", "resume_complete");
          return finish({
            status: "cancelled",
            plan: checkpoint.plan,
            answer: checkpoint.plan
              ? formatPlanAsAnswer(checkpoint.plan)
              : undefined,
            reasonCodes,
            error: {
              code: "plan_rejected",
              message: "The proposed plan was rejected.",
            },
          });
        }

        const nextPlan =
          input.planDecision.plan ??
          checkpoint.plan;
        if (!nextPlan) {
          throw new AgentEngineError(
            "invalid_input",
            "Plan approval resume is missing a plan artifact.",
          );
        }

        await this.deps.checkpointStore.delete(runId);
        reasonCodes.push(
          input.planDecision.decision === "edited"
            ? "plan_edited"
            : "plan_approved",
          "resume_complete",
        );
        return this.executeRun({
          runId,
          input: startInput,
          bus,
          signal,
          getCancelReason,
          approvedPlan: nextPlan,
          approvedPlanStrategy:
            input.planDecision.decision === "edited"
              ? inferPlanStrategyFromArtifact(nextPlan)
              : checkpoint.planStrategy ?? inferPlanStrategyFromArtifact(nextPlan),
          skipPlanGate: true,
          planSource: "resume_approval",
        });
      }

      // suspensionKind === "approval_required"
      if (!input.approval) {
        throw new AgentEngineError(
          "invalid_input",
          "Resuming an approval-required run requires an approval decision.",
        );
      }
      const pending = checkpoint.pendingApproval;
      if (!pending || pending.approvalId !== input.approval.approvalId) {
        throw new AgentEngineError(
          "invalid_input",
          "Approval id does not match the pending checkpoint.",
        );
      }

      if (input.approval.decision === "denied") {
        await this.deps.checkpointStore.delete(runId);
        await this.safeUnpin(runId, pinnedState);
        reasonCodes.push("approval_denied");
        return finish({
          status: "approval_denied",
          reasonCodes,
          error: {
            code: "approval_denied",
            message: "The requested mutation was denied.",
          },
        });
      }

      reasonCodes.push("approval_granted", "resume_complete");

      if (!this.deps.tools) {
        await this.safeUnpin(runId, pinnedState);
        return finish({
          status: "failed",
          reasonCodes: [...reasonCodes, "misconfigured"],
          error: {
            code: "misconfigured",
            message: "Model requested tools but Tool Runtime is not configured.",
          },
        });
      }
      if (!startInput.workspaceRoot) {
        await this.safeUnpin(runId, pinnedState);
        return finish({
          status: "failed",
          reasonCodes: [...reasonCodes, "misconfigured"],
          error: {
            code: "misconfigured",
            message: "workspaceRoot is required to resume a mutation.",
          },
        });
      }

      const messages: ModelMessage[] = [...checkpoint.messages];
      const toolCache = ToolCallCache.fromEntries(checkpoint.toolCacheEntries);
      const changedFiles = [...checkpoint.changedFiles];
      const mutationCheckpointIds = [...checkpoint.mutationCheckpointIds];
      const establishedFacts: EstablishedFact[] = [];

      const approvalToken: ToolApprovalToken = {
        approvalId: pending.approvalId,
        fingerprint: pending.fingerprint,
        decision: "approved",
      };
      const pendingToolCall: ModelToolCall = {
        id: pending.callId,
        name: pending.toolName,
        arguments: JSON.stringify(pending.arguments ?? {}),
      };

      const toolOutcome = await this.executeOneTool({
        runId,
        toolCall: pendingToolCall,
        grant: decision.toolGrant,
        pinnedState,
        workspaceRoot: startInput.workspaceRoot,
        bus,
        signal,
        toolCache,
        budget,
        warnings,
        reasonCodes,
        dirtyPaths: startInput.dirtyPaths,
        changedFiles,
        mutationCheckpointIds,
        approvalToken,
        taskListRef,
        taskListAutoAdvance: this.deps.taskListAutoAdvance === true,
        taskListAutoAdvanceBudget: {
          remaining: this.deps.taskListAutoAdvance === true ? 1 : 0,
        },
        mutatingToolNames: DEFAULT_MUTATING_TOOL_NAMES,
        // Approval resume already passed any pre-mutation gates.
        changeImpactGate: { required: false, satisfied: true },
        windowPolicy,
        plan: checkpoint.plan,
      });

      if (toolOutcome.kind === "approval_required") {
        // Tool Runtime did not accept the approval token (mismatch/expired).
        await this.safeUnpin(runId, pinnedState);
        await this.deps.checkpointStore.delete(runId);
        return finish({
          status: "failed",
          reasonCodes: [...reasonCodes, "misconfigured"],
          error: {
            code: "approval_required",
            message: "Approval was not accepted for the pending mutation.",
          },
        });
      }

      messages.push(toolOutcome.message);
      await this.deps.checkpointStore.delete(runId);

      const toolDefinitions = annotateMutationToolDefinitions(
        attachTaskListTool({
          mode: startInput.request.mode,
          tools: filterToolDefinitions({
            grant: decision.toolGrant,
            definitions:
              startInput.tools ??
              this.deps.toolDefinitions ??
              DEFAULT_TOOL_DEFINITIONS,
            supportsTools: this.deps.llm.capabilities.supportsTools,
          }),
        }),
        decision.toolGrant.mutationBudget,
      );

      const loopOutcome = await this.runModelToolLoop({
        runId,
        request: {
          messages: [...messages],
          model: startInput.model,
          temperature: startInput.temperature,
          stream: startInput.stream,
          tools: toolDefinitions,
        },
        decision,
        dirtyPaths: startInput.dirtyPaths,
        pinnedState,
        workspaceRoot: startInput.workspaceRoot,
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
        establishedFacts,
        windowPolicy,
        repoBuildStateBefore: checkpoint.repoBuildStateBefore,
        logVerbosity: startInput.logVerbosity,
        reserveVerificationRepairModelCalls: true,
        plan: checkpoint.plan,
      });

      return await this.finishAfterLoop({
        runId,
        requestId,
        input: startInput,
        request: {
          messages: [...messages],
          model: startInput.model,
          temperature: startInput.temperature,
          stream: startInput.stream,
          tools: toolDefinitions,
        },
        decision,
        bus,
        signal,
        pinnedState,
        dirtyPaths: startInput.dirtyPaths,
        loopOutcome,
        reasonCodes,
        warnings,
        budget,
        startedAtMs: checkpoint.startedAtMs,
        finish,
        cancelledResult,
        taskListRef,
        repoBuildStateBefore: checkpoint.repoBuildStateBefore,
        repoBuildStateAfter,
        onRepoBuildStateAfter: (state) => {
          repoBuildStateAfter = state;
        },
        onVerificationRecord: (record) => {
          verificationRecord = record;
        },
        windowPolicy,
        loopContext: {
          establishedFacts,
          plan: checkpoint.plan,
        },
      });
    } catch (error) {
      if (error instanceof AgentEngineError) {
        throw error;
      }
      await this.safeUnpin(runId, pinnedState);
      if (signal.aborted) {
        return await cancelledResult();
      }
      return finish({
        status: "failed",
        reasonCodes: [...reasonCodes, "provider_failed"],
        error: {
          code: "execution_failed",
          message:
            error instanceof Error ? error.message : "Agent resume failed.",
        },
      });
    }
  }

  /**
   * Shared tail for start() and resume(): interpret the model/tool loop
   * outcome, suspend for approval, gate on verification, and unpin state.
   */
  private async finishAfterLoop(params: {
    runId: string;
    requestId: string;
    input: AgentEngineStartInput;
    request: ModelRequest;
    decision: ExecutionDecision;
    bus: EventBus;
    signal: AbortSignal;
    pinnedState: RepositoryStateReference | undefined;
    dirtyPaths: readonly string[] | undefined;
    loopOutcome: ToolLoopOutcome;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    budget: RunBudgetTracker;
    startedAtMs: number;
    finish: (partial: {
      status: AgentRunStatus;
      route?: AgentRunResult["route"];
      planningDepth?: AgentRunResult["planningDepth"];
      answer?: string;
      suspension?: AgentRunResult["suspension"];
      pinnedState?: RepositoryStateReference;
      reasonCodes?: AgentReasonCode[];
      warnings?: string[];
      error?: { code: string; message: string };
    }) => AgentRunResult;
    cancelledResult: () => Promise<AgentRunResult>;
    taskListRef: TaskListRef;
    repoBuildStateBefore?: RepoBuildState;
    repoBuildStateAfter?: RepoBuildState;
    evidence?: RunEvidence;
    onRepoBuildStateAfter?: (state: RepoBuildState) => void;
    onVerificationRecord?: (record: VerificationRecord) => void;
    windowPolicy: WindowPolicy;
    loopContext?: {
      understanding?: RequestUnderstandingResult;
      skillsQuery?: string;
      mode?: "ask" | "plan" | "agent";
      projects?: readonly ProjectDescriptor[];
      memoryFacts?: readonly { id: string; content: string }[];
      selectedSkillIds?: string[];
      establishedFacts: EstablishedFact[];
      plan?: PlanArtifact;
    };
  }): Promise<AgentRunResult> {
    const {
      runId,
      requestId,
      input,
      bus,
      signal,
      pinnedState,
      loopOutcome,
      reasonCodes,
      warnings,
      budget,
      startedAtMs,
      finish,
      cancelledResult,
      taskListRef,
      repoBuildStateBefore,
      evidence,
      windowPolicy,
    } = params;

    let currentOutcome = loopOutcome;
    // Authority may have been refreshed mid-loop (e.g. after approval or
    // escalation); prefer whatever the loop last resolved over the pre-loop
    // decision so verification and any repair rerun use live authority.
    let decision =
      currentOutcome.kind === "completed" ||
      currentOutcome.kind === "approval_required"
        ? currentOutcome.decision
        : params.decision;
    let afterState = params.repoBuildStateAfter;
    let repairAttempts = 0;
    let previousAfterErrorCount: number | undefined;
    let consecutiveStalledRepairs = 0;

    while (true) {
      if (currentOutcome.kind === "approval_required") {
        if (!this.deps.checkpointStore) {
          await this.safeUnpin(runId, pinnedState);
          reasonCodes.push("misconfigured");
          return finish({
            status: "failed",
            reasonCodes,
            error: {
              code: "misconfigured",
              message: "Approval suspend requires a checkpoint store.",
            },
          });
        }

        reasonCodes.push("approval_suspended");
        await this.deps.checkpointStore.save({
          runId,
          requestId,
          suspensionKind: "approval_required",
          input,
          decision,
          pinnedState,
          messages: currentOutcome.messages,
          toolCacheEntries: currentOutcome.toolCache.entries(),
          pendingApproval: currentOutcome.pendingApproval,
          changedFiles: currentOutcome.changedFiles,
          mutationCheckpointIds: currentOutcome.mutationCheckpointIds,
          reasonCodes,
          warnings,
          usage: budget.snapshot(),
          startedAtMs,
          excludedWaitMs: budget.getExcludedWaitMs(),
          suspendedAtMs: Date.now(),
          repoBuildStateBefore,
          repoBuildStateAfter: params.repoBuildStateAfter,
          ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
        });

        const rationale = `Approval required for "${currentOutcome.pendingApproval.toolName}".`;
        this.emit(bus, {
          type: "suspended",
          runId,
          kind: "approval_required",
          rationale,
          at: this.isoNow(),
        });

        // Keep the repository state pinned across suspension so resume can
        // continue against the same pinned snapshot.
        return finish({
          status: "suspended",
          route: decision.route,
          planningDepth: decision.planningDepth,
          suspension: {
            kind: "approval_required",
            rationale,
            approval: {
              approvalId: currentOutcome.pendingApproval.approvalId,
              fingerprint: currentOutcome.pendingApproval.fingerprint,
              toolName: currentOutcome.pendingApproval.toolName,
              callId: currentOutcome.pendingApproval.callId,
              paths: currentOutcome.pendingApproval.paths,
              arguments: currentOutcome.pendingApproval.arguments,
            },
          },
          reasonCodes,
        });
      }

      if (currentOutcome.kind === "cancelled") {
        await this.safeUnpin(runId, pinnedState);
        return await cancelledResult();
      }

      if (currentOutcome.kind === "budget_exhausted") {
        if (currentOutcome.changedFiles.length > 0) {
          const verificationOutcome = await this.runVerificationGate({
            runId,
            bus,
            decision,
            primaryTaskIntent:
              params.loopContext?.understanding?.intent.classification
                .primaryTaskIntent,
            input,
            pinnedState,
            changedFiles: currentOutcome.changedFiles,
            mutationCheckpointIds: currentOutcome.mutationCheckpointIds,
            reasonCodes,
            warnings,
            repoBuildStateBefore,
            onRepoBuildStateAfter: (state) => {
              afterState = state;
              params.onRepoBuildStateAfter?.(state);
            },
            evidence,
            windowPolicy,
          });
          this.commitMutations(currentOutcome.mutationCheckpointIds, {
            runId,
            bus,
            warnings,
            logVerbosity: input.logVerbosity,
          });
          const record = await this.persistVerificationArtifact({
            runId,
            requestId,
            workspaceId: resolveWorkspaceId(input),
            bus,
            reasonCodes,
            warnings,
            status:
              verificationOutcome.kind === "ok" &&
              verificationOutcome.acceptKind === "verified_success"
                ? "passed"
                : "incomplete",
            before: repoBuildStateBefore,
            after: afterState,
            comparison: verificationOutcome.comparison,
            verification: verificationOutcome.verification,
            changedFiles: currentOutcome.changedFiles,
            logVerbosity: input.logVerbosity,
          });
          if (record) {
            params.onVerificationRecord?.(record);
          }
        }
        await this.safeUnpin(runId, pinnedState);
        reasonCodes.push("budget_exhausted");
        return finish({
          status: "budget_exhausted",
          answer: selectUserFacingLoopAnswer({
            loopAnswer: currentOutcome.answer,
            changedFiles: currentOutcome.changedFiles,
          }),
          reasonCodes,
          error: {
            code: "budget_exhausted",
            message: currentOutcome.message,
          },
        });
      }

      if (currentOutcome.kind === "failed") {
        await this.safeUnpin(runId, pinnedState);
        return finish({
          status: "failed",
          answer: currentOutcome.answer,
          reasonCodes: [...reasonCodes, ...currentOutcome.extraReasons],
          error: currentOutcome.error,
        });
      }

      if (currentOutcome.kind !== "completed") {
        await this.safeUnpin(runId, pinnedState);
        return finish({
          status: "failed",
          reasonCodes: [...reasonCodes, "misconfigured"],
          error: {
            code: "misconfigured",
            message: "Verification gate expected a completed model/tool loop.",
          },
        });
      }

      const loopChangedFiles = currentOutcome.changedFiles;
      const loopMutationIds = currentOutcome.mutationCheckpointIds;
      const loopAnswer = currentOutcome.answer;

      const verificationOutcome = await this.runVerificationGate({
        runId,
        bus,
        decision,
        primaryTaskIntent:
          params.loopContext?.understanding?.intent.classification
            .primaryTaskIntent,
        input,
        pinnedState,
        changedFiles: loopChangedFiles,
        mutationCheckpointIds: loopMutationIds,
        reasonCodes,
        warnings,
        repoBuildStateBefore,
        onRepoBuildStateAfter: (state) => {
          afterState = state;
          params.onRepoBuildStateAfter?.(state);
        },
        evidence,
        windowPolicy,
      });

      const recordStatus: VerificationRecordStatus =
        verificationOutcome.kind === "ok" &&
        verificationOutcome.acceptKind === "verified_success"
          ? "passed"
          : verificationOutcome.kind === "ok"
            ? "compared"
            : "incomplete";
      const record = await this.persistVerificationArtifact({
        runId,
        requestId,
        workspaceId: resolveWorkspaceId(input),
        bus,
        reasonCodes,
        warnings,
        status: recordStatus,
        before: repoBuildStateBefore,
        after: afterState,
        comparison: verificationOutcome.comparison,
        verification: verificationOutcome.verification,
        changedFiles: loopChangedFiles,
        logVerbosity: input.logVerbosity,
      });
      if (record) {
        params.onVerificationRecord?.(record);
      }

      if (verificationOutcome.kind === "ok") {
        if (repairAttempts > 0) {
          reasonCodes.push("verification_repair_succeeded");
        }
        await this.safeUnpin(runId, pinnedState);
        reasonCodes.push("answer_produced");
        return finish({
          status: "completed",
          answer: loopAnswer,
          reasonCodes,
        });
      }

      const currentAfterErrorCount =
        verificationOutcome.comparison?.afterErrorCount ??
        verificationOutcome.verification?.diagnostics.filter(
          (diagnostic) => diagnostic.severity === "error",
        ).length ??
        0;
      consecutiveStalledRepairs = nextStalledRepairCount({
        previousAfterErrorCount,
        currentAfterErrorCount,
        consecutiveStalledRepairs,
      });
      previousAfterErrorCount = currentAfterErrorCount;

      const repairDecision = shouldContinueVerificationRepair({
        repairAttempts,
        explorationDepth: input.explorationDepth,
        consecutiveStalledRepairs,
        canStartModelCall: budget.canStartModelCall(),
        maxAttempts: windowPolicy.run.maxVerificationRepairs,
      });
      const canRepair =
        verificationOutcome.repairable &&
        repairDecision.continue &&
        currentOutcome.kind === "completed";
      if (canRepair) {
        repairAttempts += 1;
        reasonCodes.push("verification_repair_attempted");
        const repairPrep = prepareRepairWorkingSet({
          current: taskListRef.current,
          plan: params.loopContext?.plan,
          maxTasks: taskListRef.maxTasks,
        });
        if (repairPrep.refilled) {
          reasonCodes.push("task_list_refilled");
        }
        if (repairPrep.taskList) {
          taskListRef.current = repairPrep.taskList;
          if (repairPrep.refilled || repairPrep.activated) {
            reasonCodes.push("task_list_updated");
          }
          if (repairPrep.activated) {
            reasonCodes.push("verification_repair_batch_activated");
          }
          this.emitTaskListUpdated(bus, runId, repairPrep.taskList);
        }
        currentOutcome.messages.push({
          role: "user",
          content: buildVerificationRepairPrompt({
            verification: verificationOutcome.verification,
            comparison: verificationOutcome.comparison,
            changedFiles: loopChangedFiles,
            mutationBudget: decision.toolGrant.mutationBudget,
            ...(repairPrep.activeItem
              ? {
                  activeBatch: {
                    title: repairPrep.activeItem.title,
                    write: repairPrep.activeItem.write,
                    mustRead: repairPrep.activeItem.mustRead,
                    affected: repairPrep.activeItem.affected,
                  },
                }
              : {}),
          }),
        });
        currentOutcome = await this.runModelToolLoop({
          runId,
          request: params.request,
          decision,
          understanding: params.loopContext?.understanding,
          skillsQuery: params.loopContext?.skillsQuery,
          mode: params.loopContext?.mode,
          projects: params.loopContext?.projects,
          dirtyPaths: params.dirtyPaths,
          pinnedState,
          workspaceRoot: input.workspaceRoot,
          bus,
          signal,
          budget,
          reasonCodes,
          warnings,
          messages: currentOutcome.messages,
          toolCache: currentOutcome.toolCache,
          changedFiles: loopChangedFiles,
          mutationCheckpointIds: loopMutationIds,
          taskListRef,
          memoryFacts: params.loopContext?.memoryFacts,
          establishedFacts: params.loopContext?.establishedFacts ?? [],
          selectedSkillIds: params.loopContext?.selectedSkillIds,
          evidence,
          windowPolicy,
          logVerbosity: input.logVerbosity,
          plan: params.loopContext?.plan,
        });
        if (
          currentOutcome.kind === "completed" ||
          currentOutcome.kind === "approval_required"
        ) {
          decision = currentOutcome.decision;
          continue;
        }
        if (currentOutcome.kind === "cancelled") {
          await this.safeUnpin(runId, pinnedState);
          return await cancelledResult();
        }
        if (currentOutcome.kind === "failed") {
          await this.safeUnpin(runId, pinnedState);
          return finish({
            status: "failed",
            answer: currentOutcome.answer,
            reasonCodes: [...reasonCodes, ...currentOutcome.extraReasons],
            error: currentOutcome.error,
          });
        }
        reasonCodes.push("budget_exhausted");
      }

      // Verification did not pass (or remaining-error repairs stalled / capped).
      // Keep the edits, summarize the delta, and end the task.
      this.commitMutations(loopMutationIds, {
        runId,
        bus,
        warnings,
        logVerbosity: input.logVerbosity,
      });
      reasonCodes.push(
        "verification_kept_changes",
        "verification_incomplete",
        "verification_failed",
      );
      if (
        !verificationOutcome.repairable &&
        logVerbosityAtLeast(input.logVerbosity, "standard")
      ) {
        // The run's terminal status is still "completed" here — this is the
        // only signal that changes were kept despite a hard/blocked
        // verification rejection rather than a genuinely clean pass.
        reasonCodes.push("verification_rejected_kept");
        this.emit(bus, {
          type: "warning",
          runId,
          message: `Changes were kept despite a non-repairable verification rejection (${verificationOutcome.rejectKind}).`,
          code: "verification_rejected_kept",
          data: { rejectKind: verificationOutcome.rejectKind },
          at: this.isoNow(),
        });
      }
      const summary = await this.summarizeVerificationForUser({
        bus,
        runId,
        record,
        verification: verificationOutcome.verification,
        error: verificationOutcome.error,
        before: repoBuildStateBefore,
        after: afterState,
        comparison: verificationOutcome.comparison,
        changedFiles: loopChangedFiles,
        signal,
        logVerbosity: input.logVerbosity,
      });
      reasonCodes.push("verification_summary_produced");
      const summarized =
        (await this.persistVerificationArtifact({
          runId,
          requestId,
          workspaceId: resolveWorkspaceId(input),
          bus,
          reasonCodes,
          warnings,
          status: recordStatus,
          before: repoBuildStateBefore,
          after: afterState,
          comparison: verificationOutcome.comparison,
          verification: verificationOutcome.verification,
          changedFiles: loopChangedFiles,
          userSummary: summary,
          previous: record,
          logVerbosity: input.logVerbosity,
        })) ?? record;
      if (summarized) {
        params.onVerificationRecord?.(summarized);
      }
      await this.commitVerificationMemory({
        record: summarized,
        summary,
        workspaceId: resolveWorkspaceId(input),
        reasonCodes,
        warnings,
      });
      if (record?.retry) {
        reasonCodes.push("verification_retry_available");
        this.emit(bus, {
          type: "verification_retry_available",
          runId,
          recordId: record.recordId,
          at: this.isoNow(),
        });
      }
      await this.safeUnpin(runId, pinnedState);
      reasonCodes.push("answer_produced");
      return finish({
        status: "completed",
        answer: selectUserFacingLoopAnswer({
          loopAnswer:
            "answer" in currentOutcome ? currentOutcome.answer : loopAnswer,
          fallbackSummary: summary,
          changedFiles: loopChangedFiles,
        }),
        reasonCodes,
      });
    }
  }

  /**
   * Resolve + pin whenever a workspace reference exists — no longer gated
   * on `decision.repositoryContextRequired`, since pin now runs before
   * Decision Policy so an Agent-execute preflight snapshot can happen
   * before `understand()`.
   */
  private async resolveAndPinState(params: {
    runId: string;
    envelope: UserRequestEnvelope;
    input: AgentEngineStartInput;
    bus: EventBus;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
  }): Promise<RepositoryStateReference | undefined> {
    const { runId, envelope, input, bus, reasonCodes, warnings } = params;

    let reference = input.repositoryState?.reference;

    if (!reference && this.deps.repositoryState && envelope.workspace) {
      const latest = await this.deps.repositoryState.getLatest(
        envelope.workspace.workspaceId,
      );
      if (latest) {
        reference = {
          workspaceId: latest.workspaceId,
          stateToken: latest.stateToken,
        };
      }
    }

    if (!reference) {
      return undefined;
    }

    if (this.deps.repositoryState) {
      const pinResult = await this.deps.repositoryState.pin({
        state: reference,
        runId,
      });
      if (pinResult.status === "failed") {
        warnings.push(pinResult.message);
        reasonCodes.push("state_unavailable");
        if (logVerbosityAtLeast(input.logVerbosity, "standard")) {
          this.emit(bus, {
            type: "warning",
            runId,
            message: pinResult.message,
            code: "state_unavailable",
            stage: "received",
            at: this.isoNow(),
          });
        }
        return undefined;
      }
      reasonCodes.push("state_pinned");
      this.emit(bus, {
        type: "state_pinned",
        runId,
        state: reference,
        at: this.isoNow(),
      });
    }

    return reference;
  }

  /**
   * Capture a before-state build snapshot.
   *
   * Two callers:
   *  - Agent execute, `unconditional: true`, called before Decision Policy
   *    has run (no `decision`/`understanding` yet) — uses a conservative
   *    synthesized read-only grant so errors can inform classification.
   *  - Plan mode (repair intent), gated on `decision.reasonCodes` as before,
   *    using the real decision-derived grant. Skipped entirely when the
   *    unconditional Agent-mode capture already ran.
   */
  private async capturePreflightBuildState(params: {
    runId: string;
    decision?: ExecutionDecision;
    understanding?: RequestUnderstandingResult;
    input: AgentEngineStartInput;
    pinnedState: RepositoryStateReference | undefined;
    contextPaths: readonly string[];
    bus: EventBus;
    signal: AbortSignal;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    unconditional?: boolean;
    mentionedPaths?: readonly string[];
  }): Promise<RepoBuildState | undefined> {
    const {
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
      unconditional = false,
      mentionedPaths = [],
    } = params;

    if (
      !unconditional &&
      !decision?.reasonCodes.includes("preflight_build_recommended")
    ) {
      return undefined;
    }
    if (
      !this.deps.verification?.captureBuildState ||
      !pinnedState ||
      !input.workspaceRoot
    ) {
      if (!unconditional) {
        warnings.push(
          "Preflight build snapshot was recommended but verification infrastructure is unavailable.",
        );
      }
      return undefined;
    }

    this.emitStage(bus, runId, "verifying", "started");
    try {
      if (signal.aborted) {
        warnings.push("Preflight build snapshot was cancelled.");
        this.emitStage(bus, runId, "verifying", "completed", []);
        return undefined;
      }
      const verificationGrant = decision
        ? buildVerificationGrant(decision.toolGrant)
        : buildVerificationGrant(
            buildSyntheticPreflightGrant(input.workspaceRoot),
          );
      const buildState = await this.deps.verification.captureBuildState(
        buildPreflightVerificationInput({
          decision,
          understanding,
          input,
          pinnedState,
          verificationGrant,
          contextPaths,
          pathScopes: decision?.toolGrant.pathScopes ?? ["."],
          mentionedPaths,
        }),
        { phase: "before", capturedAt: this.isoNow() },
        { signal },
      );
      if (signal.aborted) {
        warnings.push("Preflight build snapshot was cancelled.");
        this.emitStage(bus, runId, "verifying", "completed", []);
        return undefined;
      }
      reasonCodes.push("repo_build_state_before_captured");
      this.emitStage(bus, runId, "verifying", "completed", [
        "repo_build_state_before_captured",
      ]);
      return buildState;
    } catch (error) {
      warnings.push(
        `Preflight build snapshot failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.emitStage(bus, runId, "verifying", "completed", []);
      return undefined;
    }
  }

  private captureBuildStateFromVerificationResult(params: {
    input: VerificationInput;
    result: VerificationResult;
    phase: "before" | "after";
  }): RepoBuildState | undefined {
    return this.deps.verification?.buildStateFromResult?.(
      params.input,
      params.result,
      {
        phase: params.phase,
        capturedAt: this.isoNow(),
      },
    );
  }

  private applyRepoBuildStateComparisonReasonCodes(params: {
    before?: RepoBuildState;
    after: RepoBuildState;
    reasonCodes: AgentReasonCode[];
  }): RepoBuildStateComparison | undefined {
    const comparison = this.deps.verification?.compareBuildStates?.({
      before: params.before,
      after: params.after,
    });
    if (!comparison) {
      return undefined;
    }
    if (comparison.reasonCodes.includes("errors_cleared")) {
      params.reasonCodes.push("repo_build_state_errors_cleared");
    }
    if (comparison.reasonCodes.includes("errors_remaining")) {
      params.reasonCodes.push("repo_build_state_errors_remaining");
    }
    if (comparison.reasonCodes.includes("new_errors_introduced")) {
      params.reasonCodes.push("repo_build_state_new_errors");
    }
    return comparison;
  }

  /**
   * Gate completion on Verification when the decision requires it and a
   * mutation changed files. Commits on accept; leaves rollback to the caller
   * on reject (after an optional repair pass for verification_failed only).
   */
  private async runVerificationGate(params: {
    runId: string;
    bus: EventBus;
    decision: ExecutionDecision;
    primaryTaskIntent?: string;
    input: AgentEngineStartInput;
    pinnedState: RepositoryStateReference | undefined;
    changedFiles: string[];
    mutationCheckpointIds: string[];
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    repoBuildStateBefore?: RepoBuildState;
    onRepoBuildStateAfter?: (state: RepoBuildState) => void;
    evidence?: RunEvidence;
    windowPolicy: WindowPolicy;
  }): Promise<VerificationGateOutcome> {
    const {
      runId,
      bus,
      decision,
      primaryTaskIntent,
      input,
      pinnedState,
      changedFiles,
      mutationCheckpointIds,
      reasonCodes,
      warnings,
      repoBuildStateBefore,
      onRepoBuildStateAfter,
      evidence,
      windowPolicy,
    } = params;

    const missingInfrastructure: string[] = [];
    if (this.deps.verification === undefined) {
      missingInfrastructure.push("verification port");
    }
    if (pinnedState === undefined) {
      missingInfrastructure.push("pinned state");
    }
    if (input.workspaceRoot === undefined) {
      missingInfrastructure.push("workspace root");
    }
    const canVerify = missingInfrastructure.length === 0;

    let verificationResult: VerificationResult | undefined;
    let comparison: RepoBuildStateComparison | undefined;
    const shouldRunVerificationChecks =
      changedFiles.length > 0 &&
      canVerify &&
      (decision.verification.required || Boolean(repoBuildStateBefore));
    if (shouldRunVerificationChecks) {
      this.emitStage(bus, runId, "verifying", "started");
      const verificationGrant = buildVerificationGrant(decision.toolGrant);
      const projects = resolveVerificationProjects(input);
      verificationResult = await this.deps.verification!.verify({
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        workspaceRoot: input.workspaceRoot!,
        pinnedState: pinnedState!,
        changedFiles,
        projects,
        verification: decision.verification.required
          ? decision.verification
          : {
              ...decision.verification,
              required: true,
              allowUnavailable: true,
            },
        grant: verificationGrant,
        changeScope: "localized",
        baselineDiagnostics: repoBuildStateBefore?.diagnostics,
        stateReadiness: input.repositoryState?.readiness ?? "ready",
        maxChecks: windowPolicy.maxVerificationChecks,
      });
      const afterState = this.captureBuildStateFromVerificationResult({
        input: {
          schemaVersion: VERIFICATION_SCHEMA_VERSION,
          workspaceRoot: input.workspaceRoot!,
          pinnedState: pinnedState!,
          changedFiles,
          projects,
          verification: decision.verification,
          grant: verificationGrant,
          changeScope: "localized",
          stateReadiness: input.repositoryState?.readiness ?? "ready",
          baselineDiagnostics: repoBuildStateBefore?.diagnostics,
        },
        result: verificationResult,
        phase: "after",
      });
      if (afterState) {
        onRepoBuildStateAfter?.(afterState);
        recordBuildStateDeltaEvidence(evidence, {
          before: repoBuildStateBefore,
          after: afterState,
        });
        reasonCodes.push("repo_build_state_after_captured");
        comparison = this.applyRepoBuildStateComparisonReasonCodes({
          before: repoBuildStateBefore,
          after: afterState,
          reasonCodes,
        });
      }
      recordVerificationEvidence(evidence, {
        verification: verificationResult,
        before: repoBuildStateBefore,
      });
      this.emitVerificationCompleted(bus, runId, verificationResult);
      this.emitEvidenceUpdated(bus, runId, evidence);
      if (afterState) {
        this.emitRepoBuildStateCaptured(bus, runId, afterState);
      }
      if (comparison) {
        this.emit(bus, {
          type: "verification_comparison",
          runId,
          beforeErrorCount: comparison.beforeErrorCount,
          afterErrorCount: comparison.afterErrorCount,
          clearedErrorCount: comparison.clearedErrorCount,
          newErrorCount: comparison.newErrorCount,
          remainingErrorCount: comparison.remainingErrorCount,
          newWarningCount: comparison.newWarningCount,
          clearedWarningCount: comparison.clearedWarningCount,
          failedCheckIdsAfter: comparison.failedCheckIdsAfter.slice(0, 16),
          reasonCodes: comparison.reasonCodes.slice(0, 16),
          at: this.isoNow(),
        });
      }
    }

    const decisionOutcome = decideVerificationGate({
        verificationRequired: decision.verification.required,
        allowUnavailable: decision.verification.allowUnavailable,
        changedFileCount: changedFiles.length,
        mutationRequired: requiresMutationForExecute({
          route: decision.route,
          maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
          primaryTaskIntent,
          reasonCodes: decision.reasonCodes,
        }),
        canVerify,
        missingInfrastructure,
        verification: verificationResult,
        comparison,
      });

    if (decisionOutcome.action === "accept") {
      this.applyVerificationAcceptSideEffects({
        bus,
        runId,
        acceptKind: decisionOutcome.acceptKind,
        verification: verificationResult,
        reasonCodes,
        warnings,
      });
      this.commitMutations(mutationCheckpointIds, {
        runId,
        bus,
        warnings,
        logVerbosity: input.logVerbosity,
      });
      recordStopEvidence(evidence, decisionOutcome.acceptKind);
      this.emitEvidenceUpdated(bus, runId, evidence);
      return {
        kind: "ok",
        acceptKind: decisionOutcome.acceptKind,
        verification: verificationResult,
        comparison,
      };
    }

    this.emitStage(bus, runId, "verifying", "completed", [
      "verification_failed",
    ]);
    return {
      kind: "failed",
      repairable: decisionOutcome.repairable,
      rejectKind: decisionOutcome.rejectKind,
      error: decisionOutcome.error,
      verification: decisionOutcome.verification,
      comparison,
    };
  }

  private applyVerificationAcceptSideEffects(params: {
    bus: EventBus;
    runId: string;
    acceptKind: Extract<VerificationGateDecision, { action: "accept" }>["acceptKind"];
    verification: VerificationResult | undefined;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
  }): void {
    const { bus, runId, acceptKind, verification, reasonCodes, warnings } =
      params;

    if (acceptKind === "skipped_not_required") {
      return;
    }

    if (acceptKind === "verified_success") {
      this.emitStage(bus, runId, "verifying", "completed", [
        "verification_passed",
      ]);
      reasonCodes.push("verification_passed");
      return;
    }

    // implemented_unverified | unavailable_allowed
    this.emitStage(bus, runId, "verifying", "completed", [
      "verification_skipped",
    ]);
    reasonCodes.push("verification_skipped");
    if (acceptKind === "implemented_unverified" && verification) {
      warnings.push(
        `Verification incomplete (status: ${verification.status}); implementation kept unverified.`,
      );
    } else if (acceptKind === "unavailable_allowed") {
      warnings.push(
        "Verification was required but unavailable; implementation kept unverified.",
      );
    }
  }

  private commitMutations(
    mutationCheckpointIds: readonly string[],
    context?: {
      runId: string;
      bus: EventBus;
      warnings: string[];
      logVerbosity: AgentLogVerbosity;
    },
  ): void {
    if (mutationCheckpointIds.length === 0 || !this.deps.tools?.commitMutation) {
      return;
    }
    for (const checkpointId of mutationCheckpointIds) {
      try {
        this.deps.tools.commitMutation(checkpointId);
      } catch (error) {
        // Best-effort: the mutation already applied to the workspace: a
        // failed checkpoint commit does not undo the edit, it only means the
        // checkpoint bookkeeping for that file may be stale.
        const message = `Failed to commit mutation checkpoint "${checkpointId}": ${describeCaughtError(error)}`;
        context?.warnings.push(message);
        if (context && logVerbosityAtLeast(context.logVerbosity, "standard")) {
          this.emit(context.bus, {
            type: "warning",
            runId: context.runId,
            message,
            code: "mutation_commit_failed",
            data: { checkpointId },
            at: this.isoNow(),
          });
        }
      }
    }
  }

  private emitVerificationCompleted(
    bus: EventBus,
    runId: string,
    verification: VerificationResult,
  ): void {
    this.emit(bus, {
      type: "verification_completed",
      runId,
      status: verification.status,
      reasonCodes: verification.reasonCodes,
      checks: verification.checks.slice(0, 20).map((check) => ({
        checkId: check.checkId,
        kind: check.kind,
        outcome: check.outcome,
        summary: this.truncateForEvent(check.summary, 500),
      })),
      diagnostics: verification.diagnostics.slice(0, 20).map((diag) => ({
        path: this.truncateForEvent(diag.path, 512),
        severity: diag.severity,
        message: this.truncateForEvent(diag.message, 500),
        startLine: diag.startLine,
        source: diag.source
          ? this.truncateForEvent(diag.source, 120)
          : undefined,
        code: diag.code ? this.truncateForEvent(diag.code, 120) : undefined,
      })),
      warnings: verification.warnings
        .slice(0, 20)
        .map((warning) => this.truncateForEvent(warning, 500)),
      truncated:
        verification.checks.length > 20 || verification.diagnostics.length > 20
          ? true
          : undefined,
      at: this.isoNow(),
    });
  }

  private emitRepoBuildStateCaptured(
    bus: EventBus,
    runId: string,
    state: RepoBuildState,
  ): void {
    this.emit(bus, {
      type: "repo_build_state_captured",
      runId,
      phase: state.phase,
      errorCount: state.summary.errorCount,
      warningCount: state.summary.warningCount,
      failedCheckIds: state.summary.failedCheckIds.slice(0, 16),
      projectIds: state.scope.projectIds.slice(0, 16),
      truncated:
        state.summary.failedCheckIds.length > 16 ||
        state.scope.projectIds.length > 16
          ? true
          : undefined,
      at: this.isoNow(),
    });
  }

  private async persistVerificationArtifact(params: {
    runId: string;
    requestId: string;
    workspaceId?: string;
    bus: EventBus;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    status: VerificationRecordStatus;
    before?: RepoBuildState;
    after?: RepoBuildState;
    comparison?: RepoBuildStateComparison;
    verification?: VerificationResult;
    changedFiles?: readonly string[];
    userSummary?: string;
    previous?: VerificationRecord;
    logVerbosity: AgentLogVerbosity;
  }): Promise<VerificationRecord | undefined> {
    if (!params.before && !params.after && !params.verification) {
      return params.previous;
    }
    let record: VerificationRecord;
    try {
      record = buildVerificationRecord({
        runId: params.runId,
        requestId: params.requestId,
        workspaceId: params.workspaceId,
        recordId: params.previous?.recordId ?? params.runId,
        capturedAt: params.previous?.capturedAt,
        status: params.status,
        before: params.before ?? params.previous?.before,
        after: params.after ?? params.previous?.after,
        comparison: params.comparison ?? params.previous?.comparison,
        verification: params.verification ?? params.previous?.verification,
        changedFiles: params.changedFiles ?? params.previous?.changedFiles,
        userSummary: params.userSummary ?? params.previous?.userSummary,
      });
    } catch (error) {
      const message = `Verification record could not be built: ${describeCaughtError(error)}`;
      params.warnings.push(message);
      params.reasonCodes.push("verification_record_build_failed");
      if (logVerbosityAtLeast(params.logVerbosity, "standard")) {
        this.emit(params.bus, {
          type: "warning",
          runId: params.runId,
          message,
          code: "verification_record_build_failed",
          at: this.isoNow(),
        });
      }
      return params.previous;
    }

    if (this.deps.verification?.persistRecord) {
      try {
        await this.deps.verification.persistRecord(record);
        params.reasonCodes.push("verification_record_saved");
        this.emit(params.bus, {
          type: "verification_record_saved",
          runId: params.runId,
          recordId: record.recordId,
          status: record.status,
          retryAvailable: Boolean(record.retry),
          at: this.isoNow(),
        });
      } catch (error) {
        params.warnings.push(
          `Verification record persist failed: ${describeCaughtError(error)}`,
        );
      }
    }

    return record;
  }

  private async summarizeVerificationForUser(params: {
    bus: EventBus;
    runId: string;
    record?: VerificationRecord;
    verification?: VerificationResult;
    error: { code: string; message: string };
    before?: RepoBuildState;
    after?: RepoBuildState;
    comparison?: RepoBuildStateComparison;
    changedFiles: readonly string[];
    signal: AbortSignal;
    logVerbosity: AgentLogVerbosity;
  }): Promise<string> {
    const fallback = params.record
      ? buildVerificationUserSummary(params.record)
      : this.formatVerificationFailureAnswer({
          error: params.error,
          verification: params.verification,
          changedFiles: params.changedFiles,
          rolledBack: false,
        });
    const narration = await this.tryNarrateVerificationSummary({
      record: params.record,
      fallback,
      signal: params.signal,
    });
    if (
      narration.skippedReason &&
      logVerbosityAtLeast(params.logVerbosity, "verbose")
    ) {
      // Not a run failure — the deterministic fallback summary is always
      // correct — but without this, "narration ran and was rejected" and
      // "narration wasn't attempted" are indistinguishable in logs.
      this.emit(params.bus, {
        type: "warning",
        runId: params.runId,
        message: `LLM verification-summary narration was skipped (${narration.skippedReason}); used the deterministic summary instead.`,
        code: "verification_narration_failed",
        data: { skippedReason: narration.skippedReason },
        at: this.isoNow(),
      });
    }
    const summary = narration.text ?? fallback;
    this.emit(params.bus, {
      type: "verification_summary_ready",
      runId: params.runId,
      summaryChars: summary.length,
      newErrorCount: params.comparison?.newErrorCount ??
        params.record?.comparison?.newErrorCount,
      remainingErrorCount:
        params.comparison?.remainingErrorCount ??
        params.record?.comparison?.remainingErrorCount,
      clearedErrorCount:
        params.comparison?.clearedErrorCount ??
        params.record?.comparison?.clearedErrorCount,
      at: this.isoNow(),
    });
    return summary;
  }

  private async tryNarrateVerificationSummary(params: {
    record?: VerificationRecord;
    fallback: string;
    signal: AbortSignal;
  }): Promise<
    | { text: string; skippedReason?: undefined }
    | { text?: undefined; skippedReason?: string }
  > {
    if (!params.record || params.signal.aborted) {
      return { skippedReason: undefined };
    }
    try {
      const request: ModelRequest = {
        messages: [
          {
            role: "system",
            content:
              "Write a short user-facing summary of a verification delta. Do not invent errors. Do not call tools. Keep the numeric counts from the evidence. Four to eight sentences.",
          },
          {
            role: "user",
            content: params.fallback,
          },
        ],
      };
      let text = "";
      let sawToolCall = false;
      for await (const event of this.deps.llm.complete(request, {
        abortSignal: params.signal,
      })) {
        if (event.type === "content_delta" && event.content) {
          text += event.content;
        }
        if (event.type === "tool_call_delta") {
          sawToolCall = true;
        }
        if (event.type === "failed" || event.type === "cancelled") {
          return { skippedReason: `llm_${event.type}` };
        }
      }
      const trimmed = text.trim();
      if (
        sawToolCall ||
        trimmed.length < 20 ||
        !/\b(error|verification|cleared|remaining|kept the edits)\b/i.test(
          trimmed,
        )
      ) {
        return { skippedReason: "rejected_quality_gate" };
      }
      return { text: trimmed.slice(0, 4_000) };
    } catch (error) {
      return { skippedReason: `llm_error:${describeCaughtError(error)}` };
    }
  }

  private async commitVerificationMemory(params: {
    record?: VerificationRecord;
    summary: string;
    workspaceId?: string;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
  }): Promise<void> {
    if (!this.deps.memory?.commit || !params.workspaceId || !params.record) {
      return;
    }
    const input: MemoryCommitInput = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      content: [
        `Verification leftover from run ${params.record.runId}.`,
        params.summary.slice(0, 1_200),
        `Retry handle: verification/${params.record.recordId}.`,
        `Say "fix the remaining verification errors" to continue.`,
      ].join(" "),
      scope: { kind: "workspace", workspaceId: params.workspaceId },
      tags: ["verification", "retry"],
      privacy: "private",
      source: "verification",
      type: "bug",
    };
    try {
      const result = await this.deps.memory.commit(input);
      if (result.status === "committed") {
        params.reasonCodes.push("memory_committed");
      }
    } catch (error) {
      params.warnings.push(
        `Verification memory commit failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async tryLoadVerificationRetry(params: {
    workspaceId?: string;
    userMessage: string;
    runId: string;
    bus: EventBus;
    warnings: string[];
    logVerbosity: AgentLogVerbosity;
  }): Promise<VerificationRecord | undefined> {
    if (
      !params.workspaceId ||
      !this.deps.verification?.loadLatestRecord ||
      !isVerificationRetryAsk(params.userMessage)
    ) {
      return undefined;
    }
    try {
      return await this.deps.verification.loadLatestRecord(params.workspaceId);
    } catch (error) {
      // Distinct from "no prior record" (a resolved undefined): the store
      // read itself failed, so the user's retry ask silently gets no record.
      const message = `Failed to load the prior verification record: ${describeCaughtError(error)}`;
      params.warnings.push(message);
      if (logVerbosityAtLeast(params.logVerbosity, "standard")) {
        this.emit(params.bus, {
          type: "warning",
          runId: params.runId,
          message,
          code: "verification_retry_load_failed",
          at: this.isoNow(),
        });
      }
      return undefined;
    }
  }

  private formatVerificationFailureAnswer(params: {
    error: { code: string; message: string };
    verification?: VerificationResult;
    changedFiles: readonly string[];
    rolledBack: boolean;
  }): string {
    const changed =
      params.changedFiles.length > 0
        ? ` Changed files: ${params.changedFiles.join(", ")}.`
        : "";
    const rollback = params.rolledBack
      ? " Any applied workspace changes were rolled back."
      : "";
    const evidence = params.verification
      ? ` Evidence: ${this.formatVerificationEvidence(params.verification)}`
      : "";
    return `I could not complete the change because required verification failed: ${params.error.message}.${rollback}${changed}${evidence}`;
  }

  private formatVerificationEvidence(verification: VerificationResult): string {
    const checks = verification.checks
      .slice(0, 6)
      .map(
        (check) =>
          `${check.kind}/${check.outcome}: ${this.truncateForEvent(
            check.summary,
            180,
          )}`,
      );
    const diagnostics = verification.diagnostics
      .slice(0, 5)
      .map((diag) => {
        const line = diag.startLine ? `:${diag.startLine}` : "";
        return `${diag.path}${line} ${diag.severity}: ${this.truncateForEvent(
          diag.message,
          220,
        )}`;
      });
    const warnings = verification.warnings
      .slice(0, 3)
      .map((warning) => `warning: ${this.truncateForEvent(warning, 180)}`);
    const parts = [
      `status=${verification.status}; reasons=${verification.reasonCodes.join(",")}`,
      ...checks,
      ...diagnostics,
      ...warnings,
    ];
    return parts.join("\n");
  }

  private truncateForEvent(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
  }

  private async runModelToolLoop(params: {
    runId: string;
    request: ModelRequest;
    decision: ExecutionDecision;
    understanding?: RequestUnderstandingResult;
    skillsQuery?: string;
    mode?: "ask" | "plan" | "agent";
    projects?: readonly ProjectDescriptor[];
    dirtyPaths: readonly string[] | undefined;
    pinnedState: RepositoryStateReference | undefined;
    workspaceRoot: string | undefined;
    bus: EventBus;
    signal: AbortSignal;
    budget: RunBudgetTracker;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    messages: ModelMessage[];
    toolCache: ToolCallCache;
    changedFiles: string[];
    mutationCheckpointIds: string[];
    memoryFacts?: readonly { id: string; content: string }[];
    establishedFacts?: EstablishedFact[];
    selectedSkillIds?: string[];
    taskListRef: TaskListRef;
    evidence?: RunEvidence;
    windowPolicy: WindowPolicy;
    repoBuildStateBefore?: RepoBuildState;
    logVerbosity: AgentLogVerbosity;
    /**
     * First mutate loop only: hold back window-effort repair calls so
     * remaining-error verification can start after a productive loop.
     */
    reserveVerificationRepairModelCalls?: boolean;
    plan?: PlanArtifact;
  }): Promise<ToolLoopOutcome> {
    const {
      runId,
      dirtyPaths,
      pinnedState,
      workspaceRoot,
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
      evidence,
      logVerbosity,
    } = params;
    let decision = params.decision;
    let grant = decision.toolGrant;
    let selectedSkillIds = [...(params.selectedSkillIds ?? [])];
    let answer = "";
    let truncationRecoveries = 0;
    let incompleteAnswerRecoveries = 0;
    let unfulfilledExecuteRecoveries = 0;
    let pendingTextContinuation = "";
    let emittedLoopPressureWarning = false;
    let emittedLoopCompactionWarning = false;
    let successfulVerificationAfterMutation = false;
    let explorationStallNudges = 0;
    const loopFileReads = createLoopFileReadTracker();
    let rejectedMutationRecoveries = 0;
    const mustReadNudgeBudget = {
      remaining: AGENT_ENGINE_THRESHOLDS.maxMustReadNudges,
    };
    let rejectedToolRecoveries = 0;
    let readOnlyToolTurnsWithoutMutation = 0;
    let readOnlyToolTurnsAfterMutation = 0;
    let afterMutationReadOnlyNudges = 0;
    let awaitingReadOnlyMutationRetry = false;
    let readOnlyMutationRetryAttempts = 0;
    let awaitingRejectedMutationRetry:
      | {
          allowTargetedDiscovery: boolean;
          targetedDiscoveryToolCallsUsed: number;
          maxTargetedDiscoveryToolCalls: number;
        }
      | undefined;
    const establishedFacts = params.establishedFacts ?? [];
    const isMutationRequired = () =>
      requiresMutationForExecute({
        route: decision.route,
        maximumWorkspaceEffect: grant.maximumWorkspaceEffect,
        primaryTaskIntent:
          params.understanding?.intent.classification.primaryTaskIntent,
        reasonCodes: decision.reasonCodes,
      });
    const currentPreflightDiagnosticRule = () =>
      params.repoBuildStateBefore && params.repoBuildStateBefore.summary.errorCount > 0
        ? buildPreflightDiagnosticRepairInstruction({
            diagnostics: params.repoBuildStateBefore.diagnostics,
            totalErrorCount: params.repoBuildStateBefore.summary.errorCount,
            pathScopes: grant.pathScopes,
            maxDiagnostics: params.windowPolicy.planning.maxDiagnosticSteps,
            maxChars:
              params.windowPolicy.sections.planTokens *
              DEFAULT_PLAN_CHARACTERS_PER_TOKEN,
          })
        : undefined;
    const changeImpactGate = {
      required:
        decision.reasonCodes.includes("change_impact_recommended") &&
        grant.allowedTools.includes("analyze_change_impact"),
      satisfied: false,
    };

    while (true) {
      if (signal.aborted) {
        return { kind: "cancelled" };
      }

      const exhausted = budget.isExhausted();
      if (exhausted) {
        return {
          kind: "budget_exhausted",
          answer: answer || undefined,
          message: `Run budget exhausted (${exhausted}).`,
          changedFiles,
          mutationCheckpointIds,
        };
      }

      const reservedRepairCalls =
        params.reserveVerificationRepairModelCalls === true
          ? reservedVerificationRepairModelCalls({
              maxModelCalls: budget.maxModelCalls(),
              maxVerificationRepairs:
                params.windowPolicy.run.maxVerificationRepairs,
            })
          : 0;
      const reserveForThisTurn =
        changedFiles.length > 0 ? reservedRepairCalls : 0;
      if (!budget.canStartModelCall(reserveForThisTurn)) {
        if (changedFiles.length > 0 && budget.canStartModelCall()) {
          reasonCodes.push("verification_repair_budget_reserved");
          warnings.push(
            "Leaving remaining model-call budget for verification repair after mutations.",
          );
          return {
            kind: "completed",
            answer,
            changedFiles,
            mutationCheckpointIds,
            messages,
            toolCache,
            decision,
          };
        }
        return {
          kind: "budget_exhausted",
          answer: answer || undefined,
          message: "Model call budget exhausted.",
          changedFiles,
          mutationCheckpointIds,
        };
      }

      budget.recordLoopIteration();
      budget.recordModelCall();
      this.emitStage(bus, runId, "model_running", "started");

      const loopInputBudgetTokens = this.calculateLoopInputBudgetTokens(
        params.request,
        params.windowPolicy,
      );
      const completedTaskPaths = collectCompletedTaskPaths(taskListRef.current);
      if (completedTaskPaths.length > 0) {
        const stubbed = stubToolResultsForCompletedPaths({
          messages,
          paths: completedTaskPaths,
          maxChars: params.windowPolicy.compaction.compactedToolResultChars,
        });
        if (stubbed.stubbed) {
          messages.splice(0, messages.length, ...stubbed.messages);
          reasonCodes.push("completed_task_results_stubbed");
        }
      }
      const compaction = compactModelLoopMessages({
        messages,
        estimator: this.tokenEstimator,
        budgetTokens: loopInputBudgetTokens,
        memoryFacts: params.memoryFacts,
        establishedFacts,
        maxEstablishedFactReinjectChars:
          params.windowPolicy.compaction.establishedFactReinjectChars,
        maxMemoryReinjectChars:
          params.windowPolicy.compaction.memoryReinjectChars,
        recentToolMessagesToKeepFull:
          params.windowPolicy.compaction.keepRecentToolResults,
        compactedToolResultChars:
          params.windowPolicy.compaction.compactedToolResultChars,
        compactedToolArgumentChars:
          params.windowPolicy.compaction.compactedToolArgumentChars,
        droppedTurnSummaryChars:
          params.windowPolicy.compaction.droppedTurnSummaryChars,
        warnRatio: params.windowPolicy.compaction.warnRatio,
        autoRatio: params.windowPolicy.compaction.autoRatio,
        hardRatio: params.windowPolicy.compaction.hardRatio,
        autoMaxTokens: params.windowPolicy.compaction.autoMaxTokens,
        hardMaxTokens: params.windowPolicy.compaction.hardMaxTokens,
        preservePrefix: true,
        skipEstablishedFactsReinject: true,
      });
      if (
        compaction.pressure === "warn" &&
        !emittedLoopPressureWarning &&
        !compaction.compacted
      ) {
        emittedLoopPressureWarning = true;
        this.emit(bus, {
          type: "warning",
          runId,
          message:
            "Model loop context is approaching the compaction threshold.",
          code: "compaction_pressure_warn",
          ...(logVerbosityAtLeast(logVerbosity, "standard")
            ? {
                data: {
                  usedTokens: compaction.usedTokens,
                  warnTokens: compaction.thresholds.warnTokens,
                  autoTokens: compaction.thresholds.autoTokens,
                  hardTokens: compaction.thresholds.hardTokens,
                },
              }
            : {}),
          at: this.isoNow(),
        });
      }
      if (compaction.compacted) {
        messages.splice(0, messages.length, ...compaction.messages);
        if (!emittedLoopCompactionWarning) {
          emittedLoopCompactionWarning = true;
          const extras = [
            compaction.summarizedDroppedTurns ? "summarized-dropped-turns" : null,
            compaction.reinjectedMemory ? "memory-reinjected" : null,
            compaction.reinjectedEstablishedFacts
              ? "established-facts-reinjected"
              : null,
          ].filter(Boolean);
          if (compaction.reinjectedEstablishedFacts) {
            reasonCodes.push("established_facts_reinjected");
          }
          warnings.push(
            "Compacted previous tool call history to keep follow-up model calls within the context budget.",
          );
          this.emit(bus, {
            type: "warning",
            runId,
            message: `Compacted previous tool call history before the next model call (pressure=${compaction.pressure}${
              extras.length > 0 ? `; ${extras.join(", ")}` : ""
            }).`,
            code: "compaction_applied",
            ...(logVerbosityAtLeast(logVerbosity, "standard")
              ? {
                  data: {
                    pressure: compaction.pressure,
                    usedTokens: compaction.usedTokens,
                    hardTokens: compaction.thresholds.hardTokens,
                    stillOverHardCeiling:
                      compaction.usedTokens > compaction.thresholds.hardTokens,
                  },
                }
              : {}),
            at: this.isoNow(),
          });
        }
      }

      upsertTrailingWorkingSet(messages, {
        taskList: taskListRef.current,
        mutationBudget: grant.mutationBudget,
        preflightDiagnostics: buildPreflightDiagnosticRepairInstruction({
          diagnostics: params.repoBuildStateBefore?.diagnostics ?? [],
          totalErrorCount:
            params.repoBuildStateBefore?.summary.errorCount ?? 0,
          pathScopes: grant.pathScopes,
          maxDiagnostics: params.windowPolicy.planning.maxDiagnosticSteps,
          maxChars: Math.min(
            params.windowPolicy.compaction.establishedFactReinjectChars,
            2_400,
          ),
        }),
        establishedFacts,
        maxEstablishedFactChars:
          params.windowPolicy.compaction.establishedFactReinjectChars,
      });

      const turnRequest: ModelRequest = {
        ...params.request,
        messages: [...messages],
      };
      const usedInputTokens =
        estimateModelMessagesTokens(turnRequest.messages, this.tokenEstimator) +
        (turnRequest.tools && turnRequest.tools.length > 0
          ? this.tokenEstimator.estimate(JSON.stringify(turnRequest.tools))
          : 0);
      const generationCeiling = resolveGenerationCeiling({
        contextWindowTokens: params.windowPolicy.contextWindowTokens,
        configuredOutputTokens: params.windowPolicy.maximumOutputTokens,
        reasonCodes: params.windowPolicy.reasonCodes,
      });
      const leftoverOutputTokens = clampTurnMaximumOutputTokens({
        reservedOutputTokens: generationCeiling,
        contextWindowTokens: params.windowPolicy.contextWindowTokens,
        usedInputTokens,
      });
      const previousOutputTokens =
        turnRequest.maximumOutputTokens ?? generationCeiling;
      turnRequest.maximumOutputTokens = leftoverOutputTokens;
      if (
        leftoverOutputTokens < previousOutputTokens &&
        logVerbosityAtLeast(logVerbosity, "standard")
      ) {
        this.emit(bus, {
          type: "warning",
          runId,
          message: `Turn output tokens reduced from ${previousOutputTokens} to ${leftoverOutputTokens} because leftover context was smaller than the generation ceiling.`,
          code: "output_tokens_clamped",
          data: {
            reservedOutputTokens: generationCeiling,
            clampedOutputTokens: leftoverOutputTokens,
            usedInputTokens,
            contextWindowTokens: params.windowPolicy.contextWindowTokens,
          },
          at: this.isoNow(),
        });
      }

      const turn = await this.consumeModelTurn({
        llm: this.deps.llm,
        request: turnRequest,
        runId,
        signal,
        bus,
      });

      if (turn.kind === "cancelled") {
        this.emitStage(bus, runId, "model_running", "completed", ["cancelled"]);
        return { kind: "cancelled" };
      }

      if (turn.kind === "failed") {
        reasonCodes.push("provider_failed");
        this.emitStage(bus, runId, "model_running", "completed", [
          "provider_failed",
        ]);
        return {
          kind: "failed",
          answer: turn.content || answer || undefined,
          extraReasons: ["provider_failed"],
          error: {
            code: turn.errorCode,
            message: turn.errorMessage,
          },
        };
      }

      if (turn.usage) {
        budget.addUsage(turn.usage);
      }

      const truncated = turn.finishReason === "length";
      this.emit(bus, {
        type: "model_turn",
        runId,
        turnIndex: Math.max(0, budget.snapshot().modelCalls - 1),
        inputTokens: turn.usage?.inputTokens,
        outputTokens: turn.usage?.outputTokens,
        cacheHitTokens: turn.usage?.cacheHitTokens,
        cacheMissTokens: turn.usage?.cacheMissTokens,
        finishReason: turn.finishReason,
        truncated: truncated || undefined,
        at: this.isoNow(),
      });

      if (truncated) {
        reasonCodes.push("output_truncated");
        warnings.push(
          "Model output stopped early because the output token limit was reached.",
        );
        this.emit(bus, {
          type: "warning",
          runId,
          message:
            "Response truncated: output token limit reached. Retrying with a smaller mutation batch when tools were incomplete; otherwise raise mitii.provider.maximumOutputTokens.",
          at: this.isoNow(),
        });
      }

      const recovery = buildOutputTruncationRecovery({
        finishReason: turn.finishReason,
        content: turn.content,
        toolCalls: turn.toolCalls,
        mutationBudget: grant.mutationBudget,
        recoveryAttempt: truncationRecoveries,
        requireMutation: requiresMutationForExecute({
          route: decision.route,
          maximumWorkspaceEffect: grant.maximumWorkspaceEffect,
          primaryTaskIntent:
            params.understanding?.intent.classification.primaryTaskIntent,
          reasonCodes: decision.reasonCodes,
        }),
      });

      if (recovery?.shouldRecover) {
        truncationRecoveries += 1;
        reasonCodes.push("output_truncation_recovered");
        if (recovery.recoveryKind === "text_continuation") {
          pendingTextContinuation = appendTextContinuation(
            pendingTextContinuation,
            recovery.assistantContent,
          );
          answer = pendingTextContinuation;
        }
        messages.push({
          role: "assistant",
          content: compactRecoveredAssistantContent(recovery.assistantContent),
        });
        messages.push(recovery.recoveryMessage);
        this.emit(bus, {
          type: "warning",
          runId,
          message:
            recovery.recoveryKind === "text_continuation"
              ? "Continuing truncated final answer after output token limit."
              : "Discarded incomplete truncated tool call(s); continuing with a smaller-batch instruction.",
          at: this.isoNow(),
        });
        this.emitStage(bus, runId, "model_running", "completed", [
          "model_completed",
          "output_truncated",
          "output_truncation_recovered",
        ]);
        continue;
      }

      reasonCodes.push("model_completed");
      this.emitStage(bus, runId, "model_running", "completed", [
        "model_completed",
        ...(truncated ? (["output_truncated"] as const) : []),
      ]);

      let toolCalls = turn.toolCalls;
      if (
        toolCalls.length === 0 &&
        turn.content.trim().length > 0 &&
        /<\s*(?:read_file|read_many_files|search_files|glob_files|list_directory|goto_definition|find_references|analyze_change_impact)\b/i.test(
          turn.content,
        )
      ) {
        const recovered = recoverLeakedToolCallsFromMarkup({
          content: turn.content,
          allowedToolNames: new Set(grant.allowedTools),
        });
        toolCalls = recovered.toolCalls;
        if (recovered.warnings.length > 0) {
          warnings.push(...recovered.warnings);
        }
      }

      if (toolCalls.length === 0) {
        if (turn.content.length > 0) {
          const turnAnswer = truncated
            ? `${turn.content}\n\n…(output truncated — token limit reached)`
            : turn.content;
          if (pendingTextContinuation.length > 0) {
            answer = appendTextContinuation(
              pendingTextContinuation,
              turnAnswer,
            );
            if (!truncated) {
              pendingTextContinuation = "";
            }
          } else {
            answer = turnAnswer;
          }
        }

        const incompleteAssistantTurn = shouldRecoverIncompleteAssistantTurn({
          content: turn.content,
          toolCallCount: 0,
          changedFileCount: changedFiles.length,
        });
        const loopOutcome = resolveLoopTurnOutcome({
          route: decision.route,
          maximumWorkspaceEffect: grant.maximumWorkspaceEffect,
          primaryTaskIntent:
            params.understanding?.intent.classification.primaryTaskIntent ?? "",
          toolCallCount: 0,
          changedFileCount: changedFiles.length,
          content: turn.content,
          finishReason: turn.finishReason,
          truncated,
          mutationBudget: grant.mutationBudget,
          recoveries: {
            truncation: truncationRecoveries,
            incompleteAnswer: incompleteAnswerRecoveries,
            unfulfilledExecute: unfulfilledExecuteRecoveries,
          },
        });
        if (
          incompleteAssistantTurn &&
          successfulVerificationAfterMutation &&
          changedFiles.length > 0
        ) {
          answer = synthesizeFallbackAnswer({
            priorAnswer: answer || turn.content,
            changedFiles,
          });
          reasonCodes.push("incomplete_answer_fallback");
          return {
            kind: "completed",
            answer,
            changedFiles,
            mutationCheckpointIds,
            messages,
            toolCache,
            decision,
          };
        }

        if (
          loopOutcome.disposition === "recover_unfulfilled_execute" &&
          unfulfilledExecuteRecoveries <
            AGENT_ENGINE_THRESHOLDS.maxUnfulfilledExecuteRecoveries &&
          budget.canStartModelCall()
        ) {
          unfulfilledExecuteRecoveries += 1;
          reasonCodes.push("unfulfilled_execute_recovered");
          if (turn.content.trim().length > 0) {
            messages.push({
              role: "assistant",
              content: compactRecoveredAssistantContent(turn.content),
            });
          }
          messages.push({
            role: "user",
            content:
              loopOutcome.recoveryMessage ??
              buildUnfulfilledExecuteRecoveryMessage(grant.mutationBudget),
          });
          warnings.push(
            "Execute route produced analysis with no workspace edits; requesting apply_patch.",
          );
          this.emit(bus, {
            type: "warning",
            runId,
            message:
              "Model ended on a diagnosis without apply_patch; continuing so the fix can be applied.",
            at: this.isoNow(),
          });
          continue;
        }

        if (loopOutcome.reasonCode === "unfulfilled_execute_exhausted") {
          reasonCodes.push("unfulfilled_execute_exhausted");
          return {
            kind: "failed",
            answer: answer || undefined,
            extraReasons: ["unfulfilled_execute_exhausted"],
            error: {
              code: "no_mutation_performed",
              message:
                "The model exhausted the recovery budget without applying workspace edits.",
            },
          };
        } else if (
          incompleteAssistantTurn &&
          incompleteAnswerRecoveries <
            AGENT_ENGINE_THRESHOLDS.maxIncompleteAnswerRecoveries &&
          budget.canStartModelCall()
        ) {
          incompleteAnswerRecoveries += 1;
          reasonCodes.push("incomplete_answer_recovered");
          const emptyTurn = isEmptyAssistantTurn({
            content: turn.content,
            toolCallCount: 0,
          });
          const recoveryContent = buildIncompleteAnswerRecoveryMessage({
            changedFiles,
            emptyTurn,
          });
          if (turn.content.trim().length > 0) {
            messages.push({
              role: "assistant",
              content: compactRecoveredAssistantContent(turn.content),
            });
          }
          messages.push({
            role: "user",
            content: recoveryContent,
          });
          warnings.push(
            emptyTurn
              ? "Empty model turn recovered; requesting a final answer or next tool call."
              : "Transitional narration recovered; requesting a final answer or next tool call.",
          );
          this.emit(bus, {
            type: "warning",
            runId,
            message: emptyTurn
              ? "Model returned an empty turn; continuing for a complete answer."
              : "Model ended on transitional narration; continuing for a complete answer.",
            at: this.isoNow(),
          });
          continue;
        }

        if (
          shouldRecoverIncompleteAssistantTurn({
            content: answer,
            toolCallCount: 0,
            changedFileCount: changedFiles.length,
          }) ||
          (changedFiles.length > 0 &&
            (answer.trim().length === 0 ||
              isTransitionalAssistantAnswer(answer)))
        ) {
          answer = synthesizeFallbackAnswer({
            priorAnswer: answer,
            changedFiles,
          });
          reasonCodes.push("incomplete_answer_fallback");
        }

        return {
          kind: "completed",
          answer,
          changedFiles,
          mutationCheckpointIds,
          messages,
          toolCache,
          decision,
        };
      }

      // Tool phase
      const needsWorkspaceTools = toolCalls.some(
        (call) => !isUpdateTodosTool(call.name),
      );
      if (needsWorkspaceTools && !this.deps.tools) {
        return {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: ["misconfigured"],
          error: {
            code: "misconfigured",
            message: "Model requested tools but Tool Runtime is not configured.",
          },
        };
      }
      if (needsWorkspaceTools && !workspaceRoot) {
        return {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: ["misconfigured"],
          error: {
            code: "misconfigured",
            message: "Model requested tools but workspaceRoot was not provided.",
          },
        };
      }

      messages.push({
        role: "assistant",
        content: turn.content,
        toolCalls,
      });

      this.emitStage(bus, runId, "tool_running", "started");

      // Cap mutation auto-advance to one checklist step per model turn.
      const taskListAutoAdvanceBudget = {
        remaining: this.deps.taskListAutoAdvance === true ? 1 : 0,
      };
      let attemptedMutatingTool = false;
      let succeededMutatingTool = false;
      let rejectedMutation:
        | {
            toolName: string;
            status: ToolResult["status"];
            reasonCode?: ToolResult["reasonCode"];
            warnings: readonly string[];
            summary?: string;
          }
        | undefined;
      let successfulToolCount = 0;
      let rejectedToolCount = 0;
      let rejectedTool:
        | {
            toolName: string;
            status: ToolResult["status"];
            reasonCode?: ToolResult["reasonCode"];
            warnings: readonly string[];
            summary?: string;
          }
        | undefined;

      for (const toolCall of toolCalls) {
        if (signal.aborted) {
          return { kind: "cancelled" };
        }
        if (!budget.canStartToolCall()) {
          return {
            kind: "budget_exhausted",
            answer: answer || undefined,
            message: "Tool call budget exhausted.",
            changedFiles,
            mutationCheckpointIds,
          };
        }

        const outcome = await this.executeOneTool({
          runId,
          toolCall,
          grant,
          pinnedState,
          workspaceRoot: workspaceRoot ?? ".",
          bus,
          signal,
          toolCache,
          budget,
          warnings,
          reasonCodes,
          dirtyPaths,
          changedFiles,
          mutationCheckpointIds,
          approvalToken: undefined,
          taskListRef,
          taskListAutoAdvance: this.deps.taskListAutoAdvance === true,
          taskListAutoAdvanceBudget,
          mutatingToolNames: DEFAULT_MUTATING_TOOL_NAMES,
          changeImpactGate,
        evidence,
        establishedFacts,
        windowPolicy: params.windowPolicy,
        loopFileReads,
        mustReadNudgeBudget,
        plan: params.plan,
      });

        if (outcome.kind === "approval_required") {
          const approvalId = this.deps.idGenerator.next("appr");
          return {
            kind: "approval_required",
            messages,
            toolCache,
            pendingApproval: {
              approvalId,
              fingerprint: outcome.fingerprint,
              toolName: outcome.toolName,
              callId: outcome.callId,
              arguments: outcome.arguments,
              paths: outcome.paths,
            },
            changedFiles,
            mutationCheckpointIds,
            answer: answer || undefined,
            decision,
          };
        }

        messages.push(outcome.message);
        const result = toolCache.get(toolCall.id);
        const mutatingTool = DEFAULT_MUTATING_TOOL_NAMES.has(toolCall.name);
        if (mutatingTool) {
          attemptedMutatingTool = true;
        }
        if (result?.status === "succeeded") {
          successfulToolCount += 1;
          if (mutatingTool) {
            succeededMutatingTool = true;
          }
        } else if (result) {
          rejectedToolCount += 1;
          rejectedTool = {
            toolName: toolCall.name,
            status: result.status,
            reasonCode: result.reasonCode,
            warnings: result.warnings,
            summary: this.summarizeToolCall(
              toolCall.name,
              toolCall.arguments.trim().length === 0
                ? {}
                : safeJsonParse(toolCall.arguments),
            ),
          };
        }
        if (
          mutatingTool &&
          result &&
          result.status !== "succeeded" &&
          result.reasonCode !== "approval_required" &&
          result.reasonCode !== "must_read_incomplete"
        ) {
          rejectedMutation = {
            toolName: toolCall.name,
            status: result.status,
            reasonCode: result.reasonCode,
            warnings: result.warnings,
            summary: this.summarizeToolCall(
              toolCall.name,
              toolCall.arguments.trim().length === 0
                ? {}
                : safeJsonParse(toolCall.arguments),
            ),
          };
        }
        if (
          changedFiles.length > 0 &&
          result &&
          isSuccessfulVerificationToolResult(toolCall.name, result)
        ) {
          successfulVerificationAfterMutation = true;
        }
      }

      await this.refreshAuthorityAfterTools({
        runId,
        bus,
        reasonCodes,
        warnings,
        messages,
        decisionRef: {
          get: () => decision,
          set: (next) => {
            decision = next;
            grant = next.toolGrant;
          },
        },
        selectedSkillIdsRef: {
          get: () => selectedSkillIds,
          set: (next) => {
            selectedSkillIds = next;
          },
        },
        changedFiles,
        dirtyPaths,
        understanding: params.understanding,
        skillsQuery: params.skillsQuery,
        mode: params.mode,
        projects: params.projects,
        route: decision.route,
        windowPolicy: params.windowPolicy,
      });

      reasonCodes.push("tools_executed");
      this.emitStage(bus, runId, "tool_running", "completed", [
        "tools_executed",
      ]);

      if (
        isMutationRequired() &&
        changedFiles.length === 0 &&
        awaitingRejectedMutationRetry &&
        !attemptedMutatingTool
      ) {
        if (
          isTargetedDiscoveryAfterRejectedMutation({
            recovery: awaitingRejectedMutationRetry,
            toolCalls,
            successfulToolCount,
            rejectedToolCount,
          })
        ) {
          const used =
            awaitingRejectedMutationRetry.targetedDiscoveryToolCallsUsed +
            toolCalls.length;
          const max =
            awaitingRejectedMutationRetry.maxTargetedDiscoveryToolCalls;
          awaitingRejectedMutationRetry = {
            ...awaitingRejectedMutationRetry,
            targetedDiscoveryToolCallsUsed: used,
            allowTargetedDiscovery: used < max,
          };
          messages.push({
            role: "user",
            content:
              `Use that targeted discovery result to retry the corrected workspace edit now. Targeted stale-patch reads used: ${used}/${max}. Your next turn must call apply_patch/delete_file/move_file or stop with a clear blocker. Only read again if it is one of the exact stale patch files and still within this budget.`,
          });
          warnings.push(
            "Allowed targeted stale-patch discovery after a recoverable rejected mutation.",
          );
          continue;
        }

        reasonCodes.push("tool_failed", "unfulfilled_execute_exhausted");
        return {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: [],
          error: {
            code: "no_mutation_performed",
            message:
              "The model read more files after a rejected mutation instead of retrying the workspace edit.",
          },
        };
      }

      if (
        isMutationRequired() &&
        changedFiles.length === 0 &&
        awaitingReadOnlyMutationRetry &&
        !attemptedMutatingTool
      ) {
        if (
          readOnlyMutationRetryAttempts <
            AGENT_ENGINE_THRESHOLDS.maxReadOnlyMutationRetryAttempts &&
          budget.canStartModelCall()
        ) {
          readOnlyMutationRetryAttempts += 1;
          reasonCodes.push("unfulfilled_execute_recovered");
          messages.push({
            role: "user",
            content:
              "You read again instead of editing. Your very next turn must call apply_patch/delete_file/move_file with a bounded change, or stop with a clear blocker. No further reads unless you state the blocker first.\n\n" +
              buildUnfulfilledExecuteRecoveryMessage(grant.mutationBudget),
          });
          warnings.push(
            "Model kept reading after the first-mutation nudge; granting another bounded chance before failing the run.",
          );
          continue;
        }

        reasonCodes.push("unfulfilled_execute_exhausted");
        return {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: [],
          error: {
            code: "no_mutation_performed",
            message:
              "The model continued reading after being told to apply the required workspace edit.",
          },
        };
      }

      if (
        isMutationRequired() &&
        changedFiles.length === 0 &&
        !attemptedMutatingTool &&
        rejectedTool &&
        successfulToolCount === 0 &&
        rejectedToolCount === toolCalls.length
      ) {
        reasonCodes.push("tool_failed");
        if (
          rejectedToolRecoveries <
            AGENT_ENGINE_THRESHOLDS.maxUnfulfilledExecuteRecoveries &&
          budget.canStartModelCall()
        ) {
          rejectedToolRecoveries += 1;
          messages.push({
            role: "user",
            content: buildRejectedToolRecoveryMessage(rejectedTool),
          });
          warnings.push(
            `All requested tools were ${rejectedTool.status}; requesting corrected tool arguments or a patch.`,
          );
          continue;
        }

        reasonCodes.push("unfulfilled_execute_exhausted");
        return {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: [],
          error: {
            code: "no_mutation_performed",
            message:
              "The model repeatedly called rejected tools instead of applying the required workspace edits.",
          },
        };
      }

      if (
        isMutationRequired() &&
        changedFiles.length === 0 &&
        rejectedMutation
      ) {
        reasonCodes.push("tool_failed");
        if (
          rejectedMutationRecoveries <
            AGENT_ENGINE_THRESHOLDS.maxUnfulfilledExecuteRecoveries &&
          budget.canStartModelCall()
        ) {
          rejectedMutationRecoveries += 1;
          const maxTargetedDiscoveryToolCalls =
            grant.mutationBudget?.maxUniqueFilesPerCall ??
            AGENT_ENGINE_THRESHOLDS.defaultPreferredBatchSize;
          const allowTargetedDiscovery =
            allowsTargetedDiscoveryAfterRejectedMutation(rejectedMutation);
          awaitingRejectedMutationRetry = {
            allowTargetedDiscovery,
            targetedDiscoveryToolCallsUsed: 0,
            maxTargetedDiscoveryToolCalls,
          };
          messages.push({
            role: "user",
            content: buildRejectedMutationRecoveryMessage({
              ...rejectedMutation,
              maxTargetedDiscoveryToolCalls,
            }),
          });
          warnings.push(
            `Mutation tool ${rejectedMutation.toolName} ${rejectedMutation.status}; requesting a corrected edit.`,
          );
          continue;
        }

        reasonCodes.push("unfulfilled_execute_exhausted");
        return {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: [],
          error: {
            code: "no_mutation_performed",
            message:
              "The model could not apply a valid workspace edit after a rejected mutation attempt.",
          },
        };
      }

      if (attemptedMutatingTool) {
        awaitingRejectedMutationRetry = undefined;
        awaitingReadOnlyMutationRetry = false;
        readOnlyToolTurnsWithoutMutation = 0;
        readOnlyMutationRetryAttempts = 0;
        if (succeededMutatingTool) {
          readOnlyToolTurnsAfterMutation = 0;
          resetLoopFileReadTracker(loopFileReads);
          explorationStallNudges = 0;
        }
      } else if (
        isMutationRequired() &&
        changedFiles.length === 0 &&
        successfulToolCount > 0
      ) {
        readOnlyToolTurnsWithoutMutation += 1;
        if (
          readOnlyToolTurnsWithoutMutation >=
          AGENT_ENGINE_THRESHOLDS.maxReadOnlyToolTurnsBeforeMutationNudge
        ) {
          if (budget.canStartModelCall()) {
            const diagnosticRule = currentPreflightDiagnosticRule();
            awaitingReadOnlyMutationRetry = true;
            reasonCodes.push("unfulfilled_execute_recovered");
            messages.push({
              role: "user",
              content:
                "You have enough repository context to attempt the requested edit. Stop reading/searching. Your next turn must call apply_patch/delete_file/move_file with a bounded change, or stop with a clear blocker.\n\n" +
                (diagnosticRule ? `${diagnosticRule}\n\n` : "") +
                buildUnfulfilledExecuteRecoveryMessage(grant.mutationBudget),
            });
            warnings.push(
              "Execute route spent multiple tool turns reading without edits; requesting the first mutation.",
            );
            continue;
          }

          reasonCodes.push("unfulfilled_execute_exhausted");
          return {
            kind: "failed",
            answer: answer || undefined,
            extraReasons: ["unfulfilled_execute_exhausted"],
            error: {
              code: "no_mutation_performed",
              message:
                "The model repeatedly read files but did not apply the required workspace edits.",
            },
          };
        }
      } else if (
        changedFiles.length > 0 &&
        successfulToolCount > 0 &&
        !attemptedMutatingTool
      ) {
        readOnlyToolTurnsAfterMutation += 1;
        if (
          readOnlyToolTurnsAfterMutation >=
          AGENT_ENGINE_THRESHOLDS.maxReadOnlyToolTurnsAfterMutationNudge
        ) {
          if (
            afterMutationReadOnlyNudges <
              AGENT_ENGINE_THRESHOLDS.maxReadOnlyToolTurnsAfterMutationNudges &&
            budget.canStartModelCall()
          ) {
            afterMutationReadOnlyNudges += 1;
            readOnlyToolTurnsAfterMutation = 0;
            reasonCodes.push("unfulfilled_execute_recovered");
            messages.push({
              role: "user",
              content:
                "Stop globbing/searching. Continue apply_patch for remaining errors, or run typecheck/diagnostics. Do not start a new exploration pass.",
            });
            warnings.push(
              "Execute route spent multiple tool turns reading after mutations; requesting the next patch or verification.",
            );
            continue;
          }

          reasonCodes.push("post_mutation_read_capped");
          warnings.push(
            "Stopped further read-only turns after mutations so verification can use remaining model-call budget.",
          );
          return {
            kind: "completed",
            answer,
            changedFiles,
            mutationCheckpointIds,
            messages,
            toolCache,
            decision,
          };
        }
      }

      const loopUsageSnap = snapshotLoopFileReads(loopFileReads);
      if (isExplorationRereadHeavy(loopUsageSnap)) {
        this.applyExplorationSignal(loopUsageSnap, reasonCodes, warnings);
        if (
          explorationStallNudges <
          AGENT_ENGINE_THRESHOLDS.maxExplorationStallNudges
        ) {
          explorationStallNudges += 1;
          if (logVerbosityAtLeast(logVerbosity, "verbose")) {
            // Live signal while the run is still in progress — the array
            // pushes above only surface in the terminal result's warnings.
            this.emit(bus, {
              type: "warning",
              runId,
              message: `File reads (${loopUsageSnap.fileReadCalls}) substantially exceeded unique paths (${loopUsageSnap.uniqueFilePathsTouched}); nudging the model (attempt ${explorationStallNudges}).`,
              code: "exploration_reread_heavy",
              data: {
                fileReadCalls: loopUsageSnap.fileReadCalls,
                uniqueFilePathsTouched: loopUsageSnap.uniqueFilePathsTouched,
                nudgeAttempt: explorationStallNudges,
              },
              at: this.isoNow(),
            });
          }
          messages.push({
            role: "user",
            content: buildExplorationStallNudge(loopUsageSnap, {
              mutationRequired:
                isMutationRequired() && changedFiles.length === 0,
            }),
          });
        } else {
          reasonCodes.push("exploration_stall_broken");
          warnings.push(
            "Stopped the run after repeated file re-reads of the same paths.",
          );
          if (logVerbosityAtLeast(logVerbosity, "standard")) {
            this.emit(bus, {
              type: "warning",
              runId,
              message: "Stopped the run after repeated file re-reads of the same paths.",
              code: "exploration_stall_broken",
              data: {
                fileReadCalls: loopUsageSnap.fileReadCalls,
                uniqueFilePathsTouched: loopUsageSnap.uniqueFilePathsTouched,
              },
              at: this.isoNow(),
            });
          }
          if (isMutationRequired() && changedFiles.length === 0) {
            return {
              kind: "failed",
              answer: answer || undefined,
              extraReasons: ["unfulfilled_execute_exhausted"],
              error: {
                code: "no_mutation_performed",
                message:
                  "The model repeatedly read files but did not apply the required workspace edits.",
              },
            };
          }
          return {
            kind: "completed",
            answer,
            changedFiles,
            mutationCheckpointIds,
            messages,
            toolCache,
            decision,
          };
        }
      }
    }
  }

  private async refreshAuthorityAfterTools(params: {
    runId: string;
    bus: EventBus;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    messages: ModelMessage[];
    decisionRef: {
      get: () => ExecutionDecision;
      set: (decision: ExecutionDecision) => void;
    };
    selectedSkillIdsRef: {
      get: () => string[];
      set: (ids: string[]) => void;
    };
    changedFiles: readonly string[];
    dirtyPaths: readonly string[] | undefined;
    understanding?: RequestUnderstandingResult;
    skillsQuery?: string;
    mode?: "ask" | "plan" | "agent";
    projects?: readonly ProjectDescriptor[];
    route: ExecutionDecision["route"];
    windowPolicy: WindowPolicy;
  }): Promise<void> {
    const discoveredPaths = [
      ...new Set([
        ...(params.dirtyPaths ?? []),
        ...params.changedFiles,
      ]),
    ]
      .filter((path) => path.trim().length > 0)
      .slice(0, 50);

    if (this.deps.decision.narrow && discoveredPaths.length > 0) {
      const previous = params.decisionRef.get();
      const narrowed = this.deps.decision.narrow({
        previous,
        discoveredPaths,
        residualRisk: params.understanding?.taskAnalysis.risk,
      });
      if (!toolGrantsEquivalent(previous.toolGrant, narrowed.toolGrant)) {
        params.decisionRef.set(narrowed);
        params.reasonCodes.push("grant_narrowed");
        this.emit(params.bus, {
          type: "grant_narrowed",
          runId: params.runId,
          maximumWorkspaceEffect: narrowed.toolGrant.maximumWorkspaceEffect,
          approvalMode: narrowed.toolGrant.approvalMode,
          pathScopes: narrowed.toolGrant.pathScopes.slice(0, 20),
          reasonCodes: narrowed.reasonCodes.slice(-8),
          truncated:
            narrowed.toolGrant.pathScopes.length > 20 ||
            narrowed.reasonCodes.length > 8
              ? true
              : undefined,
          at: this.isoNow(),
        });
      }
    }

    if (
      !this.deps.skills ||
      !params.understanding ||
      !params.skillsQuery ||
      !params.mode ||
      discoveredPaths.length === 0
    ) {
      return;
    }

    const evidence = mapUnderstandingToSkillEvidence(params.understanding, {
      projects: params.projects,
      extraPaths: discoveredPaths,
    });
    const skillsResult = await this.deps.skills.select({
      schemaVersion: SKILLS_SCHEMA_VERSION,
      query: params.skillsQuery,
      mode: params.mode,
      route: params.route,
      budgetTokens: params.windowPolicy.skills.budgetTokens,
      maxSkills: params.windowPolicy.skills.maxSkills,
      evidence,
    });
    const nextIds = skillsResult.instructions.map((block) => block.id);
    const previousIds = params.selectedSkillIdsRef.get();
    const changed =
      nextIds.length !== previousIds.length ||
      nextIds.some((id, index) => id !== previousIds[index]);
    if (!changed || skillsResult.instructions.length === 0) {
      return;
    }

    params.selectedSkillIdsRef.set(nextIds);
    params.reasonCodes.push("skills_refreshed");
    const refreshContent = skillsResult.instructions
      .map((block) => {
        const body = formatSkillPromptContent(block);
        return `### ${block.title ?? block.id}\n${body}`;
      })
      .join("\n\n");
    params.messages.push({
      role: "user",
      content: `Updated skill guidance after discovery (follow within current tool grant):\n\n${refreshContent}`,
    });
    this.emit(params.bus, {
      type: "skills_ready",
      runId: params.runId,
      selectedCount: skillsResult.instructions.length,
      omittedCount: skillsResult.omissions.length,
      status: skillsResult.status,
      selected: nextIds.slice(0, 20),
      omitted: skillsResult.omissions
        .map((omission) => omission.skillId)
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
      at: this.isoNow(),
    });
  }

  private async executeOneTool(params: {
    runId: string;
    toolCall: ModelToolCall;
    grant: ToolGrant;
    pinnedState: RepositoryStateReference | undefined;
    workspaceRoot: string;
    bus: EventBus;
    signal: AbortSignal;
    toolCache: ToolCallCache;
    budget: RunBudgetTracker;
    warnings: string[];
    reasonCodes: AgentReasonCode[];
    dirtyPaths: readonly string[] | undefined;
    changedFiles: string[];
    mutationCheckpointIds: string[];
    approvalToken: ToolApprovalToken | undefined;
    taskListRef?: TaskListRef;
    taskListAutoAdvance: boolean;
    /** Shared remaining auto-advances for the current model turn (usually 0 or 1). */
    taskListAutoAdvanceBudget: { remaining: number };
    mutatingToolNames: ReadonlySet<string>;
    /** Soft gate: require analyze_change_impact before first mutation when recommended. */
    changeImpactGate?: { required: boolean; satisfied: boolean };
    evidence?: RunEvidence;
    establishedFacts?: EstablishedFact[];
    windowPolicy: WindowPolicy;
    loopFileReads?: LoopFileReadTracker;
    /** One withheld mutation when active-task mustRead files are not loaded. */
    mustReadNudgeBudget?: { remaining: number };
    plan?: PlanArtifact;
  }): Promise<ToolCallOutcome> {
    const {
      runId,
      toolCall: rawToolCall,
      grant,
      pinnedState,
      workspaceRoot,
      bus,
      signal,
      toolCache,
      budget,
      warnings,
      reasonCodes,
      dirtyPaths,
      changedFiles,
      mutationCheckpointIds,
      approvalToken,
      taskListRef,
      taskListAutoAdvance,
      taskListAutoAdvanceBudget,
      mutatingToolNames,
      changeImpactGate,
      evidence,
      establishedFacts,
      windowPolicy,
      loopFileReads,
      mustReadNudgeBudget,
      plan,
    } = params;

    const toolCall: ModelToolCall = {
      ...rawToolCall,
      name: canonicalizeUpdateTodosToolName(rawToolCall.name),
    };

    let argumentsValue: unknown = {};
    try {
      argumentsValue =
        toolCall.arguments.trim().length === 0
          ? {}
          : JSON.parse(toolCall.arguments);
    } catch {
      warnings.push(`Invalid JSON arguments for tool ${toolCall.name}.`);
      argumentsValue = { _raw: toolCall.arguments };
    }
    const summary = this.summarizeToolCall(toolCall.name, argumentsValue);
    const fileReadPaths = extractFileReadPaths(toolCall.name, argumentsValue);
    if (fileReadPaths) {
      budget.recordFileRead(fileReadPaths);
      if (loopFileReads) {
        recordLoopFileReads(loopFileReads, fileReadPaths);
      }
    }

    this.emit(bus, {
      type: "tool_started",
      runId,
      callId: toolCall.id,
      toolName: toolCall.name,
      ...(summary ? { summary } : {}),
      at: this.isoNow(),
    });

    const cachedByCallId = toolCache.get(toolCall.id);
    const cachedByContent =
      cachedByCallId === undefined &&
      (READ_ONLY_TOOL_IDS as readonly string[]).includes(toolCall.name)
        ? toolCache.getByContent(toolCall.name, argumentsValue)
        : undefined;
    const cached =
      cachedByCallId ??
      (cachedByContent && cachedByContent.status === "succeeded"
        ? rebaseToolResult(cachedByContent, toolCall.id)
        : undefined);
    if (cached) {
      if (cachedByContent && cachedByCallId === undefined) {
        toolCache.set(toolCall.id, cached);
        reasonCodes.push("tool_result_deduped");
        upsertEstablishedFact(
          establishedFacts ?? [],
          extractEstablishedFact({
            toolName: toolCall.name,
            argumentsValue,
            output: cached.output,
            outputPreview: cached.audit.outputPreview,
            maxChars: windowPolicy.compaction.establishedFactChars,
          }),
          { maxFacts: windowPolicy.compaction.maxEstablishedFacts },
        );
      }
      this.emit(bus, {
        type: "tool_completed",
        runId,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: cached.status,
        ...(summary ? { summary } : {}),
        ...toolCompletionDiagnostics(cached),
        at: this.isoNow(),
      });
      return {
        kind: "message",
        message: {
          role: "tool",
          toolCallId: toolCall.id,
          content: serializeToolResultForModel(cached, {
            maxContentChars: windowPolicy.compaction.toolResultContentChars,
          }),
        },
      };
    }

    budget.recordToolCall();
    const preToolActiveId = taskListRef?.current?.items.find(
      (item) => item.status === "active",
    )?.id;

    if (
      changeImpactGate?.required &&
      !changeImpactGate.satisfied &&
      mutatingToolNames.has(toolCall.name)
    ) {
      warnings.push(
        "Proceeding with the mutating edit before analyze_change_impact. Call it on the primary seed when useful; do not block the batch.",
      );
    }

    if (
      mutatingToolNames.has(toolCall.name) &&
      (mustReadNudgeBudget?.remaining ?? 0) > 0
    ) {
      const mutationPaths = extractMutationTargetPaths(
        toolCall.name,
        argumentsValue,
      );
      const missing = missingMustReadPaths({
        taskList: taskListRef?.current,
        mutationPaths,
        loopFileReads,
        establishedFacts,
      });
      if (missing.length > 0) {
        mustReadNudgeBudget!.remaining -= 1;
        reasonCodes.push("must_read_nudged");
        const message = buildMustReadNudgeMessage({
          missing,
          mutationPaths,
        });
        warnings.push(message);
        const now = this.isoNow();
        const result = toolResultSchema.parse({
          schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
          callId: toolCall.id,
          toolName: toolCall.name,
          status: "rejected",
          reasonCode: "must_read_incomplete",
          output: {
            missingMustRead: missing,
            write: mutationPaths,
            message,
          },
          truncated: false,
          redacted: false,
          durationMs: 0,
          bytesProduced: 0,
          warnings: [message],
          audit: {
            callId: toolCall.id,
            toolName: toolCall.name,
            startedAt: now,
            endedAt: now,
            status: "rejected",
            reasonCode: "must_read_incomplete",
            inputPreview: toolCall.name,
            outputPreview: message,
            bytesProduced: 0,
            durationMs: 0,
            truncated: false,
            redacted: false,
          },
        });
        toolCache.set(toolCall.id, result);
        this.emit(bus, {
          type: "tool_completed",
          runId,
          callId: toolCall.id,
          toolName: toolCall.name,
          status: result.status,
          ...(summary ? { summary } : {}),
          ...toolCompletionDiagnostics(result),
          at: this.isoNow(),
        });
        return {
          kind: "message",
          message: {
            role: "tool",
            toolCallId: toolCall.id,
            content: serializeToolResultForModel(result, {
              maxContentChars: windowPolicy.compaction.toolResultContentChars,
            }),
          },
        };
      }
    }

    if (isUpdateTodosTool(toolCall.name)) {
      const applied = applyUpdateTodosArguments({
        current: taskListRef?.current,
        argumentsValue,
        maxTasks: taskListRef?.maxTasks,
      });
      const result = applied.ok
        ? buildUpdateTodosToolResult({
            callId: toolCall.id,
            status: "succeeded",
            taskList: applied.taskList,
            warnings: applied.warnings,
          })
        : buildUpdateTodosToolResult({
            callId: toolCall.id,
            status: "rejected",
            reasonCode: "invalid_arguments",
            warnings: [applied.message],
          });
      if (applied.ok) {
        let nextList = applied.taskList;
        if (nextList && plan) {
          const refilled = maybeRefillTaskListFromPlan({
            current: nextList,
            plan,
            maxTasks: taskListRef?.maxTasks,
          });
          if (refilled.refilled && refilled.taskList) {
            nextList = refilled.taskList;
            reasonCodes.push("task_list_refilled");
          }
        }
        if (taskListRef) {
          taskListRef.current = nextList;
        }
        reasonCodes.push("task_list_updated");
        // Always emit, including clear/empty, so hosts can drop a stale checklist.
        this.emitTaskListUpdated(
          bus,
          runId,
          nextList ?? {
            schemaVersion: 1,
            source: "agent",
            items: [],
          },
        );
      }
      toolCache.set(toolCall.id, result);
      this.emit(bus, {
        type: "tool_completed",
        runId,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: result.status,
        ...(summary ? { summary } : {}),
        ...toolCompletionDiagnostics(result),
        at: this.isoNow(),
      });
      recordToolEvidence(evidence, {
        toolName: toolCall.name,
        status: result.status,
        summary,
        output: result.output,
        at: this.isoNow(),
      });
      return {
        kind: "message",
        message: {
          role: "tool",
          toolCallId: toolCall.id,
          content: serializeToolResultForModel(result, {
            maxContentChars: windowPolicy.compaction.toolResultContentChars,
          }),
        },
      };
    }

    const result = await this.deps.tools!.execute(
      {
        schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
        callId: toolCall.id,
        toolName: toolCall.name,
        arguments: argumentsValue,
        grant,
        workspaceRoot,
        pinnedState,
      },
      {
        signal,
        dirtyPaths,
        alreadyMutatedPaths: changedFiles,
        approval: approvalToken,
      },
    );

    if (result.status === "rejected" && result.reasonCode === "approval_required") {
      const output = result.output as
        | { fingerprint?: string; paths?: string[] }
        | undefined;
      this.emit(bus, {
        type: "tool_completed",
        runId,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: result.status,
        ...(summary ? { summary } : {}),
        ...toolCompletionDiagnostics(result),
        at: this.isoNow(),
      });
      // Do not cache: resume must re-execute this call once approved.
      return {
        kind: "approval_required",
        toolName: toolCall.name,
        callId: toolCall.id,
        fingerprint:
          output?.fingerprint ?? fingerprintToolCall(toolCall.name, argumentsValue),
        arguments: argumentsValue,
        paths: output?.paths ?? [],
      };
    }

    toolCache.set(toolCall.id, result);
    if (
      result.status === "succeeded" &&
      (READ_ONLY_TOOL_IDS as readonly string[]).includes(toolCall.name)
    ) {
      toolCache.setContent(toolCall.name, argumentsValue, result);
      upsertEstablishedFact(
        establishedFacts ?? [],
          extractEstablishedFact({
            toolName: toolCall.name,
            argumentsValue,
            output: result.output,
            outputPreview: result.audit.outputPreview,
            maxChars: windowPolicy.compaction.establishedFactChars,
          }),
          { maxFacts: windowPolicy.compaction.maxEstablishedFacts },
        );
      }

    if (result.status === "succeeded") {
      if (toolCall.name === "analyze_change_impact" && changeImpactGate) {
        changeImpactGate.satisfied = true;
        reasonCodes.push("change_impact_observed");
      }
      const output = result.output as
        | { checkpointId?: string; changedFiles?: string[] }
        | undefined;
      if (output?.checkpointId) {
        mutationCheckpointIds.push(output.checkpointId);
        for (const changed of output.changedFiles ?? []) {
          if (!changedFiles.includes(changed)) {
            changedFiles.push(changed);
          }
        }
        reasonCodes.push("mutation_applied");
        toolCache.invalidateContent();
        dropEstablishedFactsForPaths(
          establishedFacts ?? [],
          output.changedFiles ?? [],
        );
      }
      const autoAdvanced = maybeAutoAdvanceTaskList({
        enabled: taskListAutoAdvance,
        allowAdvance: taskListAutoAdvanceBudget.remaining > 0,
        current: taskListRef?.current,
        preToolActiveId,
        toolStatus: result.status,
        isMutatingTool: mutatingToolNames.has(toolCall.name),
        changedFiles: output?.changedFiles ?? [],
        plan,
        maxTasks: taskListRef?.maxTasks,
      });
      if (autoAdvanced.warnings.length > 0) {
        warnings.push(...autoAdvanced.warnings);
      }
      if (autoAdvanced.advanced && autoAdvanced.taskList && taskListRef) {
        taskListRef.current = autoAdvanced.taskList;
        taskListAutoAdvanceBudget.remaining = Math.max(
          0,
          taskListAutoAdvanceBudget.remaining - 1,
        );
        reasonCodes.push("task_list_auto_advanced", "task_list_updated");
        if (autoAdvanced.refilled) {
          reasonCodes.push("task_list_refilled");
        }
        this.emitTaskListUpdated(bus, runId, autoAdvanced.taskList);
      }
    }

    if (result.status === "failed" || result.status === "rejected") {
      warnings.push(
        `Tool ${toolCall.name} ${result.status}${
          result.reasonCode ? ` (${result.reasonCode})` : ""
        }.`,
      );
    }

    this.emit(bus, {
      type: "tool_completed",
      runId,
      callId: toolCall.id,
      toolName: toolCall.name,
      status: result.status,
      ...(summary ? { summary } : {}),
      ...toolCompletionDiagnostics(result),
      at: this.isoNow(),
    });
    recordToolEvidence(evidence, {
      toolName: toolCall.name,
      status: result.status,
      summary,
      output: result.output,
      at: this.isoNow(),
    });

    return {
      kind: "message",
      message: {
        role: "tool",
        toolCallId: toolCall.id,
        content: serializeToolResultForModel(result, {
          maxContentChars: windowPolicy.compaction.toolResultContentChars,
        }),
      },
    };
  }

  private summarizeToolCall(toolName: string, argumentsValue: unknown): string | undefined {
    const args = this.asRecord(argumentsValue);
    if (!args) return undefined;

    const path = this.safeText(args.path);
    const paths = this.safeStringArray(args.paths);
    const query = this.safeText(args.query);
    const pattern = this.safeText(args.pattern);
    const url = this.safeUrl(args.url);
    const argv = this.safeStringArray(args.argv);
    const patches = Array.isArray(args.patches) ? args.patches : undefined;

    switch (toolName) {
      case "update_todos": {
        const type = this.safeText(args.type);
        const count = Array.isArray(args.items)
          ? args.items.length
          : Array.isArray(args.todos)
            ? args.todos.length
            : 0;
        return [type ? `type=${type}` : undefined, count ? `items=${count}` : undefined]
          .filter(Boolean)
          .join(" ");
      }
      case "list_directory":
        return `path=${path ?? "."}`;
      case "read_file": {
        const lineRange = this.formatLineRange(args.startLine, args.endLine);
        return [path ? `path=${path}` : undefined, lineRange]
          .filter(Boolean)
          .join(" ");
      }
      case "read_many_files":
        return this.formatPathList("paths", paths);
      case "search_files":
        return [
          query ? `query="${query}"` : undefined,
          path ? `path=${path}` : undefined,
          typeof args.maxMatches === "number" ? `maxMatches=${args.maxMatches}` : undefined,
          typeof args.caseSensitive === "boolean"
            ? `caseSensitive=${args.caseSensitive}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" ");
      case "glob_files":
        return [
          pattern ? `pattern=${pattern}` : undefined,
          path ? `path=${path}` : undefined,
          typeof args.maxResults === "number" ? `maxResults=${args.maxResults}` : undefined,
        ]
          .filter(Boolean)
          .join(" ");
      case "file_metadata":
      case "read_package_scripts":
        return [
          path ? `path=${path}` : undefined,
          typeof args.includeHash === "boolean"
            ? `includeHash=${args.includeHash}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" ");
      case "goto_definition":
      case "find_references":
        return [
          path ? `path=${path}` : undefined,
          typeof args.line === "number" ? `line=${args.line}` : undefined,
          typeof args.column === "number" ? `column=${args.column}` : undefined,
          typeof args.symbolName === "string"
            ? `symbol=${args.symbolName}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" ");
      case "read_diagnostics":
      case "read_git_status":
        return [
          paths ? this.formatPathList("paths", paths) : "paths=all",
          typeof args.includeDiff === "boolean"
            ? `includeDiff=${args.includeDiff}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" ");
      case "apply_patch": {
        const patchPaths = patches
          ?.map((patch) => this.safeText(this.asRecord(patch)?.path))
          .filter((value): value is string => Boolean(value));
        return [
          `patches=${patches?.length ?? 0}`,
          patchPaths?.length ? this.formatPathList("paths", patchPaths) : undefined,
        ]
          .filter(Boolean)
          .join(" ");
      }
      case "delete_file":
      case "delete_directory":
        return [
          path ? `path=${path}` : undefined,
          typeof args.recursive === "boolean"
            ? `recursive=${args.recursive}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" ");
      case "move_file": {
        const from = this.safeText(args.from);
        const to = this.safeText(args.to);
        return [
          from ? `from=${from}` : undefined,
          to ? `to=${to}` : undefined,
        ]
          .filter(Boolean)
          .join(" ");
      }
      case "run_command":
      case "run_readonly_command":
        return argv ? `argv=${this.formatArgv(argv)}` : undefined;
      case "fetch_url":
      case "fetch_docs":
        return url ? `url=${url}` : undefined;
      case "web_search":
        return query ? `query="${query}"` : undefined;
      default: {
        const keys = Object.keys(args)
          .filter((key) => !key.startsWith("_"))
          .slice(0, 8);
        return keys.length > 0 ? `args=${keys.join(",")}` : undefined;
      }
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private safeText(value: unknown, maxLength = 160): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.length > maxLength
      ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
      : normalized;
  }

  private safeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value
      .map((item) => this.safeText(item))
      .filter((item): item is string => Boolean(item));
    return items.length > 0 ? items : undefined;
  }

  private safeUrl(value: unknown): string | undefined {
    const raw = this.safeText(value, 240);
    if (!raw) return undefined;
    try {
      const url = new URL(raw);
      url.search = "";
      url.hash = "";
      return this.safeText(url.toString(), 240);
    } catch {
      return raw.split("?")[0]?.split("#")[0];
    }
  }

  private formatLineRange(startLine: unknown, endLine: unknown): string | undefined {
    const start = typeof startLine === "number" ? startLine : undefined;
    const end = typeof endLine === "number" ? endLine : undefined;
    if (start && end) return `lines=${start}-${end}`;
    if (start) return `fromLine=${start}`;
    if (end) return `toLine=${end}`;
    return undefined;
  }

  private formatPathList(label: string, paths: readonly string[] | undefined): string {
    if (!paths || paths.length === 0) return `${label}=none`;
    const preview = paths.slice(0, 5).join(",");
    const more = paths.length > 5 ? `,+${paths.length - 5}` : "";
    return `${label}=${preview}${more}`;
  }

  private formatArgv(argv: readonly string[]): string {
    const preview = argv.slice(0, 8).join(" ");
    const more = argv.length > 8 ? ` …+${argv.length - 8}` : "";
    return `"${this.safeText(preview, 220) ?? ""}${more}"`;
  }

  private calculateLoopInputBudgetTokens(
    request: ModelRequest,
    windowPolicy: WindowPolicy,
  ): number {
    const toolDefinitionTokens =
      request.tools && request.tools.length > 0
        ? this.tokenEstimator.estimate(JSON.stringify(request.tools))
        : windowPolicy.toolSchemaTokens;
    const rawBudget =
      windowPolicy.contextWindowTokens -
      windowPolicy.maximumOutputTokens -
      toolDefinitionTokens;
    return Math.max(
      1,
      Math.floor(
        Math.max(0, rawBudget) * windowPolicy.resolvedPolicy.loopSafetyRatio,
      ),
    );
  }

  private toRunUsage(snapshot: {
    modelCalls: number;
    toolCalls: number;
    loopIterations: number;
    inputTokens: number;
    outputTokens: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
    fileReadCalls: number;
    uniqueFilePathsTouched: number;
  }) {
    return {
      modelCalls: snapshot.modelCalls,
      toolCalls: snapshot.toolCalls,
      loopIterations: snapshot.loopIterations,
      inputTokens: snapshot.inputTokens,
      outputTokens: snapshot.outputTokens,
      cacheHitTokens: snapshot.cacheHitTokens,
      cacheMissTokens: snapshot.cacheMissTokens,
      fileReadCalls: snapshot.fileReadCalls,
      uniqueFilePathsTouched: snapshot.uniqueFilePathsTouched,
    };
  }

  private applyExplorationSignal(
    snapshot: {
      fileReadCalls: number;
      uniqueFilePathsTouched: number;
    },
    reasonCodes: AgentReasonCode[],
    warnings: string[],
  ): void {
    if (!isExplorationRereadHeavy(snapshot)) {
      return;
    }
    if (!reasonCodes.includes("exploration_reread_heavy")) {
      reasonCodes.push("exploration_reread_heavy");
    }
    const warning =
      `File reads (${snapshot.fileReadCalls}) substantially exceeded unique paths (${snapshot.uniqueFilePathsTouched}).`;
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
  }

  private resolveWindowPolicy(input: AgentEngineStartInput): WindowPolicy {
    const tools =
      input.tools ?? this.deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS;
    const toolSchemaTokens =
      tools.length > 0
        ? this.tokenEstimator.estimate(JSON.stringify(tools))
        : 0;
    return deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: this.deps.llm.capabilities.contextWindowTokens,
      maximumOutputTokens: this.deps.llm.capabilities.maximumOutputTokens,
      toolSchemaTokens,
      policy: input.windowBudget?.policy,
      effort: input.windowBudget?.effort,
    });
  }

  private clampRunBudget(
    parsed: ReturnType<typeof agentRunBudgetSchema.parse>,
    windowPolicy: WindowPolicy,
  ): {
    budget: ReturnType<typeof agentRunBudgetSchema.parse>;
    /** Fields the window policy actually reduced below the host's request. */
    clamped: Array<{ field: string; requested: number; effective: number }>;
  } {
    const maxModelCalls = Math.min(
      parsed.unlimited ? windowPolicy.run.maxModelCalls : parsed.maxModelCalls,
      windowPolicy.run.maxModelCalls,
    );
    const maxToolCalls = Math.min(
      parsed.unlimited ? windowPolicy.run.maxToolCalls : parsed.maxToolCalls,
      windowPolicy.run.maxToolCalls,
    );
    const maxLoopIterations = Math.min(
      parsed.unlimited ? windowPolicy.run.maxModelCalls : parsed.maxLoopIterations,
      windowPolicy.run.maxModelCalls,
    );
    const clamped: Array<{ field: string; requested: number; effective: number }> =
      [];
    if (!parsed.unlimited) {
      if (maxModelCalls < parsed.maxModelCalls) {
        clamped.push({
          field: "maxModelCalls",
          requested: parsed.maxModelCalls,
          effective: maxModelCalls,
        });
      }
      if (maxToolCalls < parsed.maxToolCalls) {
        clamped.push({
          field: "maxToolCalls",
          requested: parsed.maxToolCalls,
          effective: maxToolCalls,
        });
      }
      if (maxLoopIterations < parsed.maxLoopIterations) {
        clamped.push({
          field: "maxLoopIterations",
          requested: parsed.maxLoopIterations,
          effective: maxLoopIterations,
        });
      }
    }
    return {
      budget: {
        ...parsed,
        maxModelCalls,
        maxToolCalls,
        maxLoopIterations,
      },
      clamped,
    };
  }

  private async consumeModelTurn(params: {
    llm: LlmPort;
    request: ModelRequest;
    runId: string;
    signal: AbortSignal;
    bus: EventBus;
  }): Promise<
    | {
        kind: "completed";
        content: string;
        toolCalls: ModelToolCall[];
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          cacheHitTokens?: number;
          cacheMissTokens?: number;
        };
        finishReason?: string;
      }
    | { kind: "cancelled" }
    | {
        kind: "failed";
        content: string;
        errorCode: string;
        errorMessage: string;
      }
  > {
    const { llm, request, runId, signal, bus } = params;
    const contentParts: string[] = [];
    const reasoningParts: string[] = [];
    const toolDeltas: ModelToolCallDelta[] = [];
    let usage:
      | {
          inputTokens?: number;
          outputTokens?: number;
          cacheHitTokens?: number;
          cacheMissTokens?: number;
        }
      | undefined;
    let finishReason: string | undefined;

    try {
      for await (const event of llm.complete(request, {
        runId,
        abortSignal: signal,
      })) {
        if (signal.aborted) {
          return { kind: "cancelled" };
        }
        this.forwardModelEvent(bus, runId, event);

        switch (event.type) {
          case "content_delta":
            contentParts.push(event.content);
            break;
          case "reasoning_delta":
            reasoningParts.push(event.reasoning);
            break;
          case "tool_call_delta":
            toolDeltas.push(...event.toolCalls);
            break;
          case "usage":
            usage = {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cacheHitTokens: event.usage.cacheHitTokens,
              cacheMissTokens: event.usage.cacheMissTokens,
            };
            break;
          case "completed":
            finishReason = event.finishReason;
            if (event.usage) {
              usage = {
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                cacheHitTokens: event.usage.cacheHitTokens,
                cacheMissTokens: event.usage.cacheMissTokens,
              };
            }
            break;
          case "cancelled":
            return { kind: "cancelled" };
          case "failed":
            return {
              kind: "failed",
              content: contentParts.join("") || reasoningParts.join(""),
              errorCode: event.error.code,
              errorMessage: event.error.message,
            };
          default:
            break;
        }
      }
    } catch (error) {
      if (signal.aborted) {
        return { kind: "cancelled" };
      }
      return {
        kind: "failed",
        content: contentParts.join("") || reasoningParts.join(""),
        errorCode: "provider_failed",
        errorMessage:
          error instanceof Error ? error.message : "Model invocation failed.",
      };
    }

    if (signal.aborted) {
      return { kind: "cancelled" };
    }

    // Some reasoning models stream only into reasoning; fall back so the UI
    // still gets a usable answer.
    const content = contentParts.join("") || reasoningParts.join("");

    return {
      kind: "completed",
      content,
      toolCalls: assembleToolCalls(toolDeltas),
      usage,
      finishReason,
    };
  }

  private forwardModelEvent(
    bus: EventBus,
    runId: string,
    event: ModelEvent,
  ): void {
    if (event.type === "content_delta") {
      this.emit(bus, {
        type: "model_delta",
        runId,
        kind: "content",
        preview: event.content.slice(0, 200),
        at: this.isoNow(),
      });
      return;
    }
    if (event.type === "reasoning_delta") {
      this.emit(bus, {
        type: "model_delta",
        runId,
        kind: "reasoning",
        preview: event.reasoning.slice(0, 200),
        at: this.isoNow(),
      });
      return;
    }
    if (event.type === "tool_call_delta") {
      const name = event.toolCalls.find((c) => c.name)?.name;
      this.emit(bus, {
        type: "model_delta",
        runId,
        kind: "tool_call",
        preview: name,
        at: this.isoNow(),
      });
    }
  }

  private async safeUnpin(
    runId: string,
    state: RepositoryStateReference | undefined,
  ): Promise<void> {
    if (!state || !this.deps.repositoryState) {
      return;
    }
    try {
      await this.deps.repositoryState.unpin({ state, runId });
    } catch {
      // Unpin is best-effort on terminal paths.
    }
  }

  private emitStage(
    bus: EventBus,
    runId: string,
    stage: AgentActiveStage,
    phase: "started" | "completed",
    reasonCodes?: AgentReasonCode[],
  ): void {
    if (phase === "started") {
      this.emit(bus, {
        type: "stage_started",
        runId,
        stage,
        at: this.isoNow(),
      });
      return;
    }
    this.emit(bus, {
      type: "stage_completed",
      runId,
      stage,
      at: this.isoNow(),
      reasonCodes,
    });
  }

  private async runDiscoveryPass(params: {
    runId: string;
    query: string;
    objective: string;
    evidence: PlanningInput["evidence"];
    decision: ExecutionDecision;
    pinnedState: RepositoryStateReference | undefined;
    workspaceRoot: string | undefined;
    bus: EventBus;
    signal: AbortSignal;
    budget: RunBudgetTracker;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    taskListRef: TaskListRef;
    windowPolicy: WindowPolicy;
  }): Promise<{
    brief: DiscoveryBrief;
    failed: boolean;
    collector: ReturnType<typeof createDiscoveryObservationCollector>;
  }> {
    const {
      runId,
      query,
      objective,
      evidence,
      decision,
      pinnedState,
      workspaceRoot,
      bus,
      signal,
      budget,
      reasonCodes,
      warnings,
      taskListRef,
      windowPolicy,
    } = params;

    this.emitStage(bus, runId, "discovery", "started");
    this.emit(bus, {
      type: "discovery_started",
      runId,
      objective: objective.slice(0, 500),
      at: this.isoNow(),
    });
    reasonCodes.push("discovery_started");

    const discoveryList = createDiscoveryTaskList();
    taskListRef.current = discoveryList;
    this.emitTaskListUpdated(bus, runId, discoveryList);

    const collector = createDiscoveryObservationCollector();
    const explicitTargets: DiscoveryTarget[] = (evidence.targets ?? []).map(
      (target) => ({
        kind: inferDiscoveryTargetKind(target.kind),
        value: target.value,
        reason: target.explicit ? "Explicit request target" : "Inferred target",
        explicit: target.explicit,
      }),
    );

    const canLoop =
      Boolean(this.deps.tools) &&
      Boolean(workspaceRoot) &&
      this.deps.llm.capabilities.supportsTools &&
      !signal.aborted;

    let stopReason: "natural" | "turn_cap" | "budget_exhausted" | "aborted" | "model_error" =
      "natural";
    if (canLoop) {
      const grant = createDiscoveryGrant(decision.toolGrant);
      const tools = filterToolDefinitions({
        grant,
        definitions:
          this.deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS,
        supportsTools: true,
      }).filter((tool) => isDiscoveryToolAllowed(tool.name));
      const prompt = buildDiscoveryPrompt({ query, objective });
      const messages: ModelMessage[] = [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ];

      let turn = 0;
      for (; turn < DISCOVERY_PASS_POLICY.maxModelTurns; turn += 1) {
        if (signal.aborted) {
          stopReason = "aborted";
          break;
        }
        if (!discoveryBudgetRemaining(collector) || !budget.canStartModelCall()) {
          stopReason = "budget_exhausted";
          break;
        }
        budget.recordModelCall();
        const turnResult = await this.consumeModelTurn({
          llm: this.deps.llm,
          request: {
            messages: [...messages],
            tools,
            temperature: 0,
            maximumOutputTokens: 800,
            stream: false,
            toolChoice: tools.length > 0 ? "auto" : "none",
          },
          runId,
          signal,
          bus,
        });
        if (turnResult.kind !== "completed") {
          stopReason = turnResult.kind === "cancelled" ? "aborted" : "model_error";
          break;
        }
        const toolCalls = turnResult.toolCalls.filter((call) =>
          isDiscoveryToolAllowed(call.name),
        );
        if (toolCalls.length === 0) {
          // Model chose to stop calling tools — a natural finish.
          break;
        }
        messages.push({
          role: "assistant",
          content: turnResult.content,
          toolCalls,
        });
        for (const toolCall of toolCalls) {
          if (!discoveryBudgetRemaining(collector) || signal.aborted) {
            break;
          }
          let argumentsValue: unknown = {};
          try {
            argumentsValue =
              toolCall.arguments.trim().length === 0
                ? {}
                : JSON.parse(toolCall.arguments);
          } catch {
            argumentsValue = {};
            warnings.push(
              `Invalid JSON arguments for tool ${toolCall.name}.`,
            );
          }
          const summary = this.summarizeToolCall(toolCall.name, argumentsValue);
          this.emit(bus, {
            type: "tool_started",
            runId,
            callId: toolCall.id,
            toolName: toolCall.name,
            ...(summary ? { summary } : {}),
            at: this.isoNow(),
          });
          budget.recordToolCall();
          const result = this.deps.tools
            ? await this.deps.tools.execute({
                schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
                callId: toolCall.id,
                toolName: toolCall.name,
                arguments: argumentsValue,
                grant,
                workspaceRoot: workspaceRoot!,
                pinnedState,
              })
            : undefined;
          const status = result?.status ?? "failed";
          recordDiscoveryToolUse({
            collector,
            toolName: toolCall.name,
            argumentsValue,
            resultOutput: result?.output,
            status,
          });
          this.emit(bus, {
            type: "tool_completed",
            runId,
            callId: toolCall.id,
            toolName: toolCall.name,
            status,
            ...(summary ? { summary } : {}),
            at: this.isoNow(),
          });
          this.emit(bus, {
            type: "discovery_progress",
            runId,
            filesRead: collector.fileReads,
            searches: collector.searches,
            ...(summary ? { summary } : {}),
            at: this.isoNow(),
          });
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: result
              ? serializeToolResultForModel(result, {
                  maxContentChars: windowPolicy.compaction.toolResultContentChars,
                })
              : "Tool runtime unavailable.",
          });
        }
      }
      if (stopReason === "natural" && turn >= DISCOVERY_PASS_POLICY.maxModelTurns) {
        stopReason = "turn_cap";
      }
    } else {
      reasonCodes.push("discovery_skipped");
    }

    const brief = compileDiscoveryBrief(
      toDiscoveryObservation({
        objective,
        collector,
        explicitTargets,
        constraints: evidence.constraints ?? [],
      }),
    );
    const failed =
      brief.confidence === "low" && brief.proposedChangeSurfaces.length === 0;
    reasonCodes.push(failed ? "discovery_failed" : "discovery_completed");
    this.emit(bus, {
      type: "discovery_completed",
      runId,
      confidence: brief.confidence,
      fileCount: brief.filesRead.length,
      surfaceCount: brief.proposedChangeSurfaces.length,
      openQuestionCount: brief.openQuestions.length,
      brief,
      stopReason,
      at: this.isoNow(),
    });
    this.emitStage(bus, runId, "discovery", "completed", [
      failed ? "discovery_failed" : "discovery_completed",
    ]);
    if (failed) {
      warnings.push(
        "Discovery did not identify a concrete change surface. The plan lists open questions instead of invented file tasks.",
      );
    }
    return { brief, failed, collector };
  }

  private syncTaskList(params: {
    mode: string;
    plan?: PlanArtifact;
    planningDepth?: AgentRunResult["planningDepth"];
    planSource?: "host_carry" | "resume_approval";
    taskListRef: TaskListRef;
    runId: string;
    bus: EventBus;
    reasonCodes: AgentReasonCode[];
    resetExisting?: boolean;
  }): void {
    const seeded = seedTaskListFromPlan({
      mode: params.mode,
      plan: params.plan,
      planningDepth: params.planningDepth,
      planSource: params.planSource,
      taskListRef: params.taskListRef,
      resetExisting: params.resetExisting,
    });
    // Do not invent Diagnose/Apply/Verify placeholders. Hosts show a list only
    // after derive-from-plan or the model creates one via update_todos.
    if (seeded.seeded) {
      params.reasonCodes.push("task_list_seeded");
    }
    if (params.taskListRef.current) {
      this.emitTaskListUpdated(
        params.bus,
        params.runId,
        params.taskListRef.current,
      );
    }
  }

  private emitTaskListUpdated(
    bus: EventBus,
    runId: string,
    taskList: TaskList,
  ): void {
    const progress = progressOf(taskList);
    this.emit(bus, {
      type: "task_list_updated",
      runId,
      source: taskList.source,
      completedCount: progress.completedCount,
      totalCount: progress.totalCount,
      ...(progress.activeId ? { activeId: progress.activeId } : {}),
      taskList,
      at: this.isoNow(),
    });
  }

  private emitEvidenceUpdated(
    bus: EventBus,
    runId: string,
    evidence: RunEvidence | undefined,
  ): void {
    if (!evidence) {
      return;
    }
    this.emit(bus, {
      type: "evidence_updated",
      runId,
      evidence,
      at: this.isoNow(),
    });
  }

  private emit(bus: EventBus, event: RunEvent): void {
    bus.push(event);
  }

  private isoNow(): string {
    return this.deps.clock.now().toISOString();
  }
}

/**
 * Prefer host-supplied projects; otherwise infer a single root project from
 * changed-file extensions so language discovery can run.
 */
function resolveVerificationProjects(
  input: AgentEngineStartInput,
): ProjectDescriptor[] {
  if (input.projects && input.projects.length > 0) {
    return [...input.projects];
  }
  return [
    {
      projectId: "workspace-root",
      rootPath: ".",
      primaryLanguageId: inferLanguageFromPaths(input.dirtyPaths ?? []),
      manifestPaths: [],
    },
  ];
}

/**
 * Read-only-command grant used only to capture a preflight snapshot before
 * Decision Policy has run (Agent execute, always-on). `pathScopes` covers
 * the whole workspace deliberately — no target narrowing exists yet.
 */
function buildSyntheticPreflightGrant(_workspaceRoot: string): ToolGrant {
  return {
    maximumWorkspaceEffect: "read",
    allowedTools: [...READ_ONLY_TOOL_IDS],
    allowedEffects: ["workspace_read", "process_execute"],
    // Repo-root relative, matching how a real decision.toolGrant scopes
    // pathScopes (e.g. "."), not an absolute workspaceRoot path.
    pathScopes: ["."],
    approvalMode: "never",
    limits: { maxToolCalls: 0, maxWallTimeMs: 0, maxOutputBytes: 0 },
  };
}

function buildPreflightVerificationInput(params: {
  decision?: ExecutionDecision;
  understanding?: RequestUnderstandingResult;
  input: AgentEngineStartInput;
  pinnedState: RepositoryStateReference;
  verificationGrant: ToolGrant;
  contextPaths: readonly string[];
  pathScopes: readonly string[];
  mentionedPaths: readonly string[];
}): VerificationInput {
  const changedFiles = derivePreflightTargets({
    understanding: params.understanding,
    dirtyPaths: params.input.dirtyPaths ?? [],
    contextPaths: params.contextPaths,
    pathScopes: params.pathScopes,
    mentionedPaths: params.mentionedPaths,
  });
  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    workspaceRoot: params.input.workspaceRoot!,
    pinnedState: params.pinnedState,
    changedFiles,
    projects: resolveVerificationProjects(params.input),
    verification: {
      required: true,
      minimumEvidence: uniqueVerificationEvidence([
        ...(params.decision?.verification.minimumEvidence ?? []),
        "diagnostics",
        "typecheck",
        "build",
      ]),
      allowUnavailable: true,
    },
    grant: params.verificationGrant,
    changeScope: params.understanding
      ? resolvePreflightChangeScope(params.understanding)
      : params.mentionedPaths.length > 0
        ? "module"
        : "cross_cutting",
    stateReadiness: params.input.repositoryState?.readiness ?? "ready",
  };
}

function derivePreflightTargets(params: {
  understanding?: RequestUnderstandingResult;
  dirtyPaths: readonly string[];
  contextPaths: readonly string[];
  pathScopes: readonly string[];
  mentionedPaths: readonly string[];
}): string[] {
  const explicitTargets = (params.understanding?.taskAnalysis.targets ?? [])
    .filter((target) => target.explicit)
    .map((target) => target.value);
  const scopedCandidates = [
    ...explicitTargets,
    ...params.mentionedPaths,
    ...params.dirtyPaths,
    ...params.contextPaths,
  ];
  const normalized = scopedCandidates
    .map(normalizePlanningPath)
    .filter((path) => isSafeRelativePlanningPath(path));
  const specific = uniqueStrings(normalized).slice(0, 32);
  if (specific.length > 0) {
    return specific;
  }
  return uniqueStrings(
    params.pathScopes
      .map(normalizePlanningPath)
      .filter((path) => isSafeRelativePlanningPath(path)),
  ).slice(0, 32);
}

/**
 * Explicit "@path" mentions in the raw user query. Used only to scope the
 * preflight build-state capture that runs before Request Understanding
 * exists (so it has no `taskAnalysis.targets` yet) — without this, that
 * capture's `changedFiles` falls back to the repo root and never discovers
 * a real per-package build/typecheck check via nearby-manifest expansion.
 */
function extractMentionedPaths(query: string): string[] {
  const matches = query.matchAll(/@([^\s,;:)]+)/g);
  return [...matches].map((match) => match[1] ?? "").filter(Boolean);
}

function resolvePreflightChangeScope(
  understanding: RequestUnderstandingResult,
): VerificationInput["changeScope"] {
  const scope = understanding.taskAnalysis.scope;
  if (scope === "repository" || scope === "workspace") {
    return "cross_cutting";
  }
  if (scope === "package" || scope === "multi_file") {
    return "module";
  }
  return "localized";
}

function inferDiscoveryTargetKind(
  kind: string,
): DiscoveryTarget["kind"] {
  if (
    kind === "file" ||
    kind === "folder" ||
    kind === "symbol" ||
    kind === "test" ||
    kind === "config"
  ) {
    return kind;
  }
  return "unknown";
}

function buildScopedRepoMapForPlanning(
  contextPaths: readonly string[],
): { entries: Array<{ path: string; kind?: string; note?: string }> } | undefined {
  const entries = uniqueStrings(contextPaths.map(normalizePlanningPath))
    .filter((path) => isSafeRelativePlanningPath(path))
    .slice(0, 80)
    .map((path) => ({
      path,
      kind: path.includes(".") ? "file" : "folder",
    }));
  return entries.length > 0 ? { entries } : undefined;
}

function toPlanningBuildEvidence(state: RepoBuildState): {
  phase: "before";
  summary: string;
  diagnostics?: RepoBuildState["diagnostics"];
  failedChecks?: string[];
} {
  const failedChecks = state.checks
    .filter((check) => state.summary.failedCheckIds.includes(check.checkId))
    .map((check) => check.label || check.checkId)
    .slice(0, 32);
  const topDiagnostics = state.diagnostics.slice(0, 200);
  const summaryParts = [
    `${state.summary.errorCount} error(s)`,
    `${state.summary.warningCount} warning(s)`,
    state.scope.projectIds.length > 0
      ? `projects: ${state.scope.projectIds.slice(0, 8).join(", ")}`
      : undefined,
    failedChecks.length > 0
      ? `failed checks: ${failedChecks.slice(0, 8).join(", ")}`
      : undefined,
  ].filter((part): part is string => Boolean(part));

  return {
    phase: "before",
    summary: summaryParts.join("; ").slice(0, 4_000),
    diagnostics: topDiagnostics.length > 0 ? topDiagnostics : undefined,
    failedChecks: failedChecks.length > 0 ? failedChecks : undefined,
  };
}

function uniqueVerificationEvidence(
  values: readonly VerificationInput["verification"]["minimumEvidence"][number][],
): VerificationInput["verification"]["minimumEvidence"] {
  return [...new Set(values)];
}

/**
 * Capped preflight-diagnostic hint for the understanding LLM. Best-effort
 * scope match against the raw query text only — understanding hasn't run
 * yet, so there is no targets list to match against. The authoritative
 * in-scope count for strategy rules is computed later, post-understanding,
 * against full evidence.targets (see evidenceScope.ts).
 */
function buildDiagnosticSummary(
  state: RepoBuildState,
  query: string,
): DiagnosticSummary | undefined {
  const errors = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errors.length === 0) {
    return undefined;
  }
  const normalizedQuery = query.toLowerCase();
  const inScopeErrorCount = errors.filter((diagnostic) =>
    normalizedQuery.includes(diagnostic.path.toLowerCase()),
  ).length;
  return {
    errorCount: errors.length,
    inScopeErrorCount,
    diagnostics: errors.slice(0, 12).map((diagnostic) => ({
      path: diagnostic.path,
      ...(diagnostic.code ? { code: diagnostic.code } : {}),
      message: diagnostic.message.slice(0, 300),
    })),
  };
}

function normalizePlanningPath(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "") || ".";
}

function isSafeRelativePlanningPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.startsWith("~") &&
    !path.includes("..") &&
    !/^[A-Za-z]:\//.test(path)
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function safeJsonParse(value: string): unknown {
  try {
    return value.trim().length > 0 ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function buildRejectedMutationRecoveryMessage(params: {
  toolName: string;
  status: ToolResult["status"];
  reasonCode?: ToolResult["reasonCode"];
  warnings: readonly string[];
  summary?: string;
  maxTargetedDiscoveryToolCalls?: number;
}): string {
  const reason = params.reasonCode ? ` (${params.reasonCode})` : "";
  const warnings =
    params.warnings.length > 0
      ? `\nTool warning: ${params.warnings.slice(0, 3).join(" ")}`
      : "";
  const summary = params.summary ? `\nAttempt: ${params.summary}` : "";
  const allowTargetedDiscovery =
    allowsTargetedDiscoveryAfterRejectedMutation(params);

  const instructions = [
    `The mutation tool ${params.toolName} was ${params.status}${reason}.`,
    `${summary}${warnings}`,
    "Do not restart broad exploration.",
    "When the rejected result includes currentContent, copy exact oldText from that content and retry apply_patch immediately. Do not spend a turn re-reading unless currentContent is missing.",
  ];

  if (allowTargetedDiscovery) {
    const max =
      params.maxTargetedDiscoveryToolCalls ??
      AGENT_ENGINE_THRESHOLDS.defaultPreferredBatchSize;
    instructions.push(
      `If the rejection indicates stale oldText or a missing patch path, you may use at most ${max} targeted read/list/search call(s) for exact stale patch files or their parent directories.`,
      "After that targeted discovery, retry apply_patch/delete_file/move_file with corrected arguments, or stop with a clear blocker.",
    );
  } else {
    instructions.push(
      "Your next turn must either call apply_patch/delete_file/move_file with corrected arguments, or stop with a clear blocker. Do not read or search more files first.",
    );
  }

  return instructions.join("\n");
}

function allowsTargetedDiscoveryAfterRejectedMutation(params: {
  toolName: string;
  reasonCode?: ToolResult["reasonCode"];
  warnings: readonly string[];
  summary?: string;
}): boolean {
  if (params.toolName !== "apply_patch") {
    return false;
  }

  const details = [
    params.reasonCode,
    params.summary,
    ...params.warnings,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (params.reasonCode === "path_out_of_scope") {
    return true;
  }
  if (isPatchTargetedDiscoveryReason(params.reasonCode)) {
    return true;
  }
  if (
    params.reasonCode === "invalid_arguments" &&
    (details.includes("analyze_change_impact") ||
      details.includes("oldtext") ||
      details.includes("old text") ||
      details.includes("not found") ||
      details.includes("does not exist") ||
      details.includes("missing"))
  ) {
    return true;
  }
  return false;
}

function isTargetedDiscoveryAfterRejectedMutation(params: {
  recovery: {
    allowTargetedDiscovery: boolean;
    targetedDiscoveryToolCallsUsed: number;
    maxTargetedDiscoveryToolCalls: number;
  };
  toolCalls: readonly ModelToolCall[];
  successfulToolCount: number;
  rejectedToolCount: number;
}): boolean {
  if (
    !params.recovery.allowTargetedDiscovery ||
    params.toolCalls.length === 0 ||
    params.recovery.targetedDiscoveryToolCallsUsed + params.toolCalls.length >
      params.recovery.maxTargetedDiscoveryToolCalls ||
    params.successfulToolCount === 0 ||
    params.rejectedToolCount > 0
  ) {
    return false;
  }

  return params.toolCalls.every((call) =>
    TARGETED_REJECTED_MUTATION_DISCOVERY_TOOLS.has(call.name),
  );
}

function buildRejectedToolRecoveryMessage(params: {
  toolName: string;
  status: ToolResult["status"];
  reasonCode?: ToolResult["reasonCode"];
  warnings: readonly string[];
  summary?: string;
}): string {
  const reason = params.reasonCode ? ` (${params.reasonCode})` : "";
  const summary = params.summary ? `\nAttempt: ${params.summary}` : "";
  const warnings =
    params.warnings.length > 0
      ? `\nTool warning: ${params.warnings.slice(0, 3).join(" ")}`
      : "";

  return [
    `The requested tool ${params.toolName} was ${params.status}${reason}.`,
    `${summary}${warnings}`,
    "Do not repeat rejected tool calls.",
    "If you need more context, call the read/search tool once with corrected, valid arguments. If you already have enough context, call apply_patch now.",
    "Do not end the turn with more malformed or duplicate read/search calls.",
  ].join("\n");
}

function toolCompletionDiagnostics(
  result: ToolResult,
): Partial<Extract<RunEvent, { type: "tool_completed" }>> {
  const warnings = result.warnings
    .map((warning) => truncateForLogField(warning, 500))
    .filter((warning) => warning.length > 0)
    .slice(0, 5);
  const outputPreview = result.audit.outputPreview
    ? truncateForLogField(result.audit.outputPreview, 1_000)
    : undefined;

  return {
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(outputPreview ? { outputPreview } : {}),
    durationMs: result.durationMs,
    bytesProduced: result.bytesProduced,
    truncated: result.truncated,
    redacted: result.redacted,
  };
}

function truncateForLogField(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 1))}…`;
}

function inferLanguageFromPaths(paths: readonly string[]): ProjectDescriptor["primaryLanguageId"] {
  const joined = paths.join(" ").toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)\b/.test(joined)) return "typescript";
  if (/\.py\b/.test(joined)) return "python";
  if (/\.go\b/.test(joined)) return "go";
  if (/\.rs\b/.test(joined)) return "rust";
  if (/\.(java|kt)\b/.test(joined)) return "java";
  if (/\.cs\b/.test(joined)) return "csharp";
  if (/\.(c|cc|cpp|h|hpp)\b/.test(joined)) return "cpp";
  if (/\.rb\b/.test(joined)) return "ruby";
  if (/\.php\b/.test(joined)) return "php";
  if (/\.swift\b/.test(joined)) return "swift";
  return "typescript";
}

/**
 * Prefer a substantive prior user ask when the live turn is a short follow-up
 * ("fix it") so plan objectives stay grounded.
 */
function buildPlanningQuery(
  currentQuery: string,
  conversation: readonly { role: string; content: string }[],
): string {
  const current = currentQuery.trim().replace(/\s+/g, " ");
  const priorUser = [...conversation]
    .reverse()
    .find(
      (entry) => entry.role === "user" && entry.content.trim().length >= 24,
    )
    ?.content.trim()
    .replace(/\s+/g, " ");

  if (
    priorUser &&
    (current.length < 24 ||
      /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:fix|update|change|check|do|handle|implement)\s+(?:it|this|that)\b/i.test(
        current,
      ))
  ) {
    return `${priorUser}\n\nFollow-up: ${current}`.slice(0, 1_000);
  }

  return current.slice(0, 1_000);
}

const CONTEXT_READY_WARNING_CODES = new Set([
  "optional_source_unavailable",
  "required_source_unavailable",
  "file_map_fallback",
  "state_degraded",
  "source_failed",
  // A user-pinned/referenced file was dropped by budget allocation — the
  // single most user-visible context bug class, so it stays at "standard".
  "required_reference_omitted",
]);

/**
 * Lower-severity, higher-frequency context-selection drop reasons. These are
 * genuinely useful for deep debugging but noisy on every run, so they only
 * surface at logVerbosity "verbose".
 */
const CONTEXT_READY_VERBOSE_WARNING_CODES = new Set([
  "token_budget_reached",
  "item_limit_reached",
  "file_limit_reached",
  "per_file_limit_reached",
  "representation_downgraded",
  "unknown_token_estimate",
  "excluded_path_removed",
  "duplicate_reference_removed",
]);

function looksLikeContextFilePath(path: string): boolean {
  const lastSegment = path.split("/").at(-1) ?? "";
  if (!lastSegment) {
    return false;
  }
  if (lastSegment.startsWith(".") && lastSegment.length > 1) {
    return true;
  }
  return lastSegment.includes(".") && !lastSegment.endsWith(".");
}

function scopeDiscoveredContextPaths(
  paths: readonly string[],
  focus: {
    folderPrefix?: string;
    filePaths: readonly string[];
  },
): string[] {
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
  if (!focus.folderPrefix && focus.filePaths.length === 0) {
    return unique.slice(0, 12);
  }
  const allowedFiles = new Set(focus.filePaths);
  return unique
    .filter(
      (path) =>
        allowedFiles.has(path) ||
        (focus.folderPrefix
          ? pathMatchesFolderPrefix(path, focus.folderPrefix)
          : false),
    )
    .slice(0, 12);
}

/**
 * Map understanding targets into repository-context filters so @packages /
 * symbols / explicit files steer retrieval instead of only the raw query text.
 */
function deriveContextFocusFromUnderstanding(
  understanding: RequestUnderstandingResult,
): {
  folderPrefix?: string;
  filePaths: string[];
  kinds: Array<"code_symbol" | "code_region" | "markdown_section" | "text">;
  references?: {
    explicitFiles: Array<{ relativePath: string }>;
  };
} {
  const filePaths: string[] = [];
  const folderPrefixes: string[] = [];
  const hasSymbol = understanding.taskAnalysis.targets.some(
    (target) => target.explicit && target.kind === "symbol",
  );

  for (const target of understanding.taskAnalysis.targets) {
    if (target.value.length === 0) {
      continue;
    }
    // Include pinned/artifact paths (explicit:false) so @apps/docs / @packages
    // steer retrieval even when they were not typed as plain folder refs.
    if (target.kind !== "file" && target.kind !== "folder") {
      continue;
    }
    const value = target.value
      .replace(/\\/g, "/")
      .replace(/^@/, "")
      .replace(/\/+$/, "");
    // Reject absolute paths (leading "/", drive letters, "~") in addition to
    // "..": the context pipeline requires a canonical workspace-relative
    // path, and an absolute host path here must never reach that boundary.
    if (
      !value ||
      value.includes("..") ||
      value.startsWith("/") ||
      value.startsWith("~") ||
      /^[A-Za-z]:\//.test(value)
    ) {
      continue;
    }
    if (target.kind === "file" && looksLikeContextFilePath(value)) {
      filePaths.push(value);
    } else {
      folderPrefixes.push(value);
    }
  }

  const kinds: Array<
    "code_symbol" | "code_region" | "markdown_section" | "text"
  > = hasSymbol ? ["code_symbol", "code_region"] : [];

  const uniqueFolders = [...new Set(folderPrefixes)];
  // Prefer the most specific (longest) folder when several were mentioned.
  const preferredFolder = [...uniqueFolders].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  )[0];
  const uniqueFiles = [...new Set(filePaths)].slice(0, 12);

  return {
    ...(preferredFolder ? { folderPrefix: preferredFolder } : {}),
    filePaths: uniqueFiles,
    kinds,
    ...(uniqueFiles.length > 0
      ? {
          references: {
            explicitFiles: uniqueFiles.slice(0, 8).map((relativePath) => ({
              relativePath,
            })),
          },
        }
      : {}),
  };
}

function appendTextContinuation(prefix: string, continuation: string): string {
  const first = prefix.trimEnd();
  const second = continuation.trimStart();
  if (!first) return continuation;
  if (!second) return first;
  return `${first}\n${second}`;
}

function createInitialRunEvidence(objective: string): RunEvidence {
  return {
    issues: [],
    ledger: [
      {
        id: "run-start",
        kind: "tool",
        summary: `Run objective: ${objective.slice(0, 780)}`,
        paths: [],
        issueIds: [],
      },
    ],
  };
}

function finalizeRunEvidence(params: {
  evidence: RunEvidence;
  status: AgentRunStatus;
  reasonCodes: readonly AgentReasonCode[];
}): RunEvidence {
  const evidence = params.evidence;
  if (!evidence.finalStopReason) {
    if (params.status === "completed") {
      if (params.reasonCodes.includes("verification_passed")) {
        evidence.finalStopReason =
          "Completed because required verification passed after edits.";
      } else if (params.reasonCodes.includes("plan_mode_completed")) {
        evidence.finalStopReason =
          "Completed because Plan mode produced a structured plan.";
      } else {
        evidence.finalStopReason =
          "Completed because the agent produced an answer within the approved scope.";
      }
    } else if (params.status === "budget_exhausted") {
      evidence.finalStopReason = "Stopped because the run budget was exhausted.";
    } else if (params.status === "failed") {
      evidence.finalStopReason =
        "Stopped because execution or required verification failed.";
    } else if (params.status === "suspended") {
      evidence.finalStopReason =
        "Suspended because user approval or clarification is required.";
    } else if (params.status === "cancelled") {
      evidence.finalStopReason = "Stopped because the run was cancelled.";
    }
  }
  if (evidence.finalStopReason) {
    upsertLedgerEntry(evidence, {
      id: "final-stop",
      kind: "stop",
      summary: evidence.finalStopReason,
      status: params.status,
      paths: [],
      issueIds: [],
    });
  }
  return evidence;
}

function recordDiscoveryEvidence(
  evidence: RunEvidence,
  params: {
    brief: DiscoveryBrief;
    collector: ReturnType<typeof createDiscoveryObservationCollector>;
    failed: boolean;
  },
): void {
  evidence.discovery = {
    target: params.brief.objective,
    filesRead: uniqueStrings(params.brief.filesRead.map((file) => file.path)),
    searches: uniqueStrings(params.collector.searchHits.map((hit) => hit.path)),
    commands: uniqueStrings(
      params.brief.verificationHints
        .map((hint) => hint.command)
        .filter((value): value is string => Boolean(value)),
    ),
    skipped:
      params.collector.toolCalls >= DISCOVERY_PASS_POLICY.maxToolCalls
        ? ["Discovery stopped at the tool-call budget."]
        : [],
    capacity: {
      fileBudget: DISCOVERY_PASS_POLICY.maxFileReads,
      searchBudget: DISCOVERY_PASS_POLICY.maxSearches,
      toolCallBudget: DISCOVERY_PASS_POLICY.maxToolCalls,
      filesRead: params.collector.fileReads,
      searchesRun: params.collector.searches,
      toolCallsUsed: params.collector.toolCalls,
    },
    stopReason: params.failed
      ? "Discovery stopped with low confidence and no concrete change surface."
      : "Discovery stopped after identifying enough evidence for planning.",
    confidence: params.brief.confidence,
    surfaceCount: params.brief.proposedChangeSurfaces.length,
  };
  upsertLedgerEntry(evidence, {
    id: "discovery",
    kind: "discovery",
    summary: `${params.brief.confidence} confidence; ${params.brief.filesRead.length} files; ${params.brief.proposedChangeSurfaces.length} change surfaces.`,
    paths: evidence.discovery.filesRead.slice(0, 40),
    issueIds: [],
  });
}

function recordPlanEvidence(evidence: RunEvidence, plan: PlanArtifact): void {
  const reviewedRefs = plan.contextReviewed.map((ref) => ref.ref);
  const steps = plan.phases.flatMap((phase) =>
    phase.steps.map((step) => {
      const evidenceRefs = uniqueStrings([
        ...step.targetRefs,
        ...reviewedRefs.filter((ref) =>
          step.targetRefs.some(
            (target) => ref.includes(target) || target.includes(ref),
          ),
        ),
      ]).slice(0, 32);
      return {
        id: step.id,
        title: step.intent || step.actionSummary,
        targetRefs: step.targetRefs,
        evidenceRefs,
        ...(step.verification ? { verification: step.verification } : {}),
        status: "pending" as const,
      };
    }),
  );
  evidence.plan = {
    objective: plan.objective,
    stepCount: steps.length,
    steps,
    evidenceLinkedStepCount: steps.filter(
      (step) => step.evidenceRefs.length > 0 || step.verification,
    ).length,
  };
  upsertLedgerEntry(evidence, {
    id: "plan",
    kind: "plan",
    summary: `Plan has ${plan.phases.length} phases and ${steps.length} executable steps.`,
    paths: uniqueStrings(steps.flatMap((step) => step.targetRefs)).slice(0, 40),
    issueIds: [],
  });
}

function recordToolEvidence(
  evidence: RunEvidence | undefined,
  params: {
    toolName: string;
    status: string;
    summary?: string;
    output?: unknown;
    at?: string;
  },
): void {
  if (!evidence) return;
  const paths = extractEvidencePaths(params.output);
  const kind =
    hasCheckpointOutput(params.output)
      ? "edit"
      : params.toolName === "run_readonly_command" &&
          isVerificationCommandOutput(params.output)
        ? "verification"
        : "tool";
  evidence.ledger.push({
    id: `tool-${evidence.ledger.length + 1}`,
    kind,
    summary: params.summary || params.toolName,
    status: params.status,
    toolName: params.toolName,
    paths,
    issueIds: [],
    ...(params.at ? { at: params.at } : {}),
  });
  trimEvidence(evidence);
}

function recordBuildStateDeltaEvidence(
  evidence: RunEvidence | undefined,
  params: { before?: RepoBuildState; after: RepoBuildState },
): void {
  if (!evidence) return;
  const beforeDiagnostics = params.before?.diagnostics ?? [];
  const afterDiagnostics = params.after.diagnostics;
  const afterKeys = new Set(afterDiagnostics.map(diagnosticKey));
  const beforeKeys = new Set(beforeDiagnostics.map(diagnosticKey));
  const issues = [
    ...beforeDiagnostics.map((diagnostic, index) =>
      diagnosticToIssue(diagnostic, {
        idPrefix: "before",
        index,
        status: afterKeys.has(diagnosticKey(diagnostic)) ? "remaining" : "fixed",
      }),
    ),
    ...afterDiagnostics
      .filter((diagnostic) => !beforeKeys.has(diagnosticKey(diagnostic)))
      .map((diagnostic, index) =>
        diagnosticToIssue(diagnostic, {
          idPrefix: "after",
          index,
          status: "remaining",
        }),
      ),
  ];
  evidence.issues = mergeIssues(evidence.issues, issues);
  evidence.verification = {
    status: params.after.summary.errorCount === 0 ? "passed" : "remaining",
    beforeErrorCount: params.before?.summary.errorCount,
    afterErrorCount: params.after.summary.errorCount,
    clearedErrorCount: Math.max(
      0,
      (params.before?.summary.errorCount ?? 0) - params.after.summary.errorCount,
    ),
    remainingIssueCount: params.after.summary.errorCount,
    checks: params.after.checks.slice(0, 32).map((check) => ({
      checkId: check.checkId,
      kind: check.kind,
      outcome: check.outcome,
      summary: check.summary,
    })),
    stopReason:
      params.after.summary.errorCount === 0
        ? "Build diagnostics show no remaining errors."
        : "Build diagnostics still show remaining errors.",
  };
}

function recordVerificationEvidence(
  evidence: RunEvidence | undefined,
  params: { verification: VerificationResult; before?: RepoBuildState },
): void {
  if (!evidence) return;
  const diagnostics = params.verification.allDiagnostics ??
    params.verification.diagnostics;
  const issues = diagnostics.map((diagnostic, index) =>
    diagnosticToIssue(diagnostic, {
      idPrefix: "verify",
      index,
      status:
        diagnostic.severity === "error" || diagnostic.severity === "warning"
          ? "remaining"
          : "found",
    }),
  );
  evidence.issues = mergeIssues(evidence.issues, issues);
  evidence.verification = {
    status: params.verification.status,
    beforeErrorCount: params.before?.summary.errorCount,
    afterErrorCount: diagnostics.filter((diag) => diag.severity === "error")
      .length,
    clearedErrorCount:
      params.before?.summary.errorCount !== undefined
        ? Math.max(
            0,
            params.before.summary.errorCount -
              diagnostics.filter((diag) => diag.severity === "error").length,
          )
        : undefined,
    remainingIssueCount: diagnostics.filter(
      (diag) => diag.severity === "error" || diag.severity === "warning",
    ).length,
    checks: params.verification.checks.slice(0, 32).map((check) => ({
      checkId: check.checkId,
      kind: check.kind,
      outcome: check.outcome,
      summary: check.summary,
    })),
    stopReason:
      params.verification.status === "verified_success"
        ? "Verification checks passed."
        : "Verification did not fully pass.",
  };
}

function recordStopEvidence(
  evidence: RunEvidence | undefined,
  acceptKind: Extract<VerificationGateDecision, { action: "accept" }>["acceptKind"],
): void {
  if (!evidence) return;
  const reason =
    acceptKind === "verified_success"
      ? "Completed because verification passed."
      : acceptKind === "skipped_not_required"
        ? "Completed because verification was not required."
        : acceptKind === "implemented_unverified"
          ? "Completed with implementation kept unverified by policy."
          : "Completed because verification was unavailable but allowed.";
  evidence.finalStopReason = reason;
  upsertLedgerEntry(evidence, {
    id: "verification-stop",
    kind: "stop",
    summary: reason,
    status: acceptKind,
    paths: [],
    issueIds: [],
  });
}

function isSuccessfulVerificationToolResult(
  toolName: string,
  result: ToolResult,
): boolean {
  if (toolName !== "run_readonly_command" || result.status !== "succeeded") {
    return false;
  }
  const output = result.output;
  if (!output || typeof output !== "object") {
    return false;
  }
  const record = output as { argv?: unknown; exitCode?: unknown };
  if (record.exitCode !== 0 || !Array.isArray(record.argv)) {
    return false;
  }
  const argv = record.argv.filter(
    (part): part is string => typeof part === "string",
  );
  if (argv.length === 0) {
    return false;
  }
  const command = argv.join(" ").toLowerCase();
  return /\b(?:build|check|compile|lint|test|typecheck|tsc|vitest|jest|pytest|ctest)\b/.test(
    command,
  );
}

function diagnosticToIssue(
  diagnostic: VerificationResult["diagnostics"][number],
  params: {
    idPrefix: string;
    index: number;
    status: RunEvidence["issues"][number]["status"];
  },
): RunEvidence["issues"][number] {
  return {
    id: `${params.idPrefix}-${params.index + 1}`,
    source: diagnostic.source ?? "diagnostic",
    path: diagnostic.path,
    message: diagnostic.message,
    ...(diagnostic.code ? { code: diagnostic.code } : {}),
    status: params.status,
    ...(diagnostic.checkId
      ? { verificationEvidence: `check:${diagnostic.checkId}` }
      : {}),
  };
}

function diagnosticKey(diagnostic: VerificationResult["diagnostics"][number]): string {
  return [
    diagnostic.path,
    diagnostic.startLine ?? "",
    diagnostic.source ?? "",
    diagnostic.code ?? "",
    diagnostic.message,
  ].join("|");
}

function mergeIssues(
  current: RunEvidence["issues"],
  next: RunEvidence["issues"],
): RunEvidence["issues"] {
  const byKey = new Map<string, RunEvidence["issues"][number]>();
  for (const issue of current) {
    byKey.set(issueKey(issue), issue);
  }
  for (const issue of next) {
    byKey.set(issueKey(issue), issue);
  }
  return [...byKey.values()].slice(0, 500);
}

function issueKey(issue: RunEvidence["issues"][number]): string {
  return [issue.path ?? "", issue.code ?? "", issue.message].join("|");
}

function upsertLedgerEntry(
  evidence: RunEvidence,
  entry: RunEvidence["ledger"][number],
): void {
  const index = evidence.ledger.findIndex((item) => item.id === entry.id);
  if (index >= 0) {
    evidence.ledger[index] = entry;
  } else {
    evidence.ledger.push(entry);
  }
  trimEvidence(evidence);
}

function trimEvidence(evidence: RunEvidence): void {
  evidence.ledger = evidence.ledger.slice(-500);
  evidence.issues = evidence.issues.slice(0, 500);
}

function extractEvidencePaths(output: unknown): string[] {
  if (!output || typeof output !== "object") return [];
  const record = output as {
    changedFiles?: unknown;
    path?: unknown;
    argv?: unknown;
  };
  const paths: string[] = [];
  if (typeof record.path === "string") paths.push(record.path);
  if (Array.isArray(record.changedFiles)) {
    for (const item of record.changedFiles) {
      if (typeof item === "string") paths.push(item);
    }
  }
  return uniqueStrings(paths).slice(0, 40);
}

function hasCheckpointOutput(output: unknown): boolean {
  return Boolean(
    output &&
      typeof output === "object" &&
      "checkpointId" in output &&
      typeof (output as { checkpointId?: unknown }).checkpointId === "string",
  );
}

function isVerificationCommandOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const argv = (output as { argv?: unknown }).argv;
  if (!Array.isArray(argv)) return false;
  const command = argv
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  return /\b(?:build|check|compile|lint|test|typecheck|tsc|vitest|jest|pytest|ctest)\b/.test(
    command,
  );
}

function formatSkillPromptContent(block: {
  content: string;
  resources?: {
    references?: readonly string[];
    scripts?: readonly string[];
  };
}): string {
  const references = block.resources?.references ?? [];
  const scripts = block.resources?.scripts ?? [];
  if (references.length === 0 && scripts.length === 0) {
    return block.content;
  }
  const lines = ["Available skill resources (use only if normal tool policy allows):"];
  if (references.length > 0) {
    lines.push(`references: ${references.slice(0, 12).join(", ")}`);
  }
  if (scripts.length > 0) {
    lines.push(`scripts: ${scripts.slice(0, 12).join(", ")}`);
  }
  return `${block.content.trim()}\n\n${lines.join("\n")}`;
}

function resolveWorkspaceId(input: AgentEngineStartInput): string | undefined {
  return (
    input.request.workspace?.workspaceId ??
    input.repositoryState?.reference?.workspaceId
  );
}

function isVerificationRetryAsk(message: string): boolean {
  return /\b(fix (those|them|the remaining(?: ones)?|remaining (?:errors|issues|diagnostics)|the (?:verification )?errors)|retry verification|continue (?:the )?verification)\b/i.test(
    message,
  );
}

export type { AgentRunStatus };
