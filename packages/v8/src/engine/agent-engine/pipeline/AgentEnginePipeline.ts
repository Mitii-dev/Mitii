import type {
  DecisionPolicyInput,
  ExecutionDecision,
  ToolGrant,
} from "../../../modules/decision-policy";
import {
  DECISION_POLICY_SCHEMA_VERSION,
  buildVerificationGrant,
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
import {
  PLANNING_SCHEMA_VERSION,
  formatPlanAsAnswer,
  serializePlanForPrompt,
} from "../../../modules/planning";
import type { PlanArtifact } from "../../../modules/planning";
import { PROMPT_CONSTRUCTION_SCHEMA_VERSION } from "../../../modules/prompt-construction";
import type {
  PromptInstructions,
  PromptRepositoryContext,
} from "../../../modules/prompt-construction";
import type {
  ProjectDescriptor,
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
import { SKILLS_SCHEMA_VERSION } from "../../../modules/skills";
import {
  TOOL_RUNTIME_SCHEMA_VERSION,
  fingerprintToolCall,
} from "../../tool-runtime";
import type { ToolApprovalToken } from "../../tool-runtime";
import { VERIFICATION_SCHEMA_VERSION } from "../../../modules/verification";

import {
  amendMessageWithClarification,
  assembleToolCalls,
  buildClarificationPayload,
  buildMutationBudgetInstruction,
  buildOutputTruncationRecovery,
  filterToolDefinitions,
  mapContextToPromptSlice,
  mapUnderstandingToPlanningEvidence,
  mapUnderstandingToSkillEvidence,
  mergePromptInstructions,
  serializeToolResultForModel,
} from "../actions";
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
  RunEvent,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { PendingApprovalState } from "../internal/RunCheckpoint";
import { ToolCallCache } from "../internal/ToolCallCache";
import { DEFAULT_TOOL_DEFINITIONS, PHASE8_SUPPORTED_ROUTES } from "../policy";

export type AgentEnginePipelineDependencies = AgentEngineDependencies;

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
    }
  | {
      kind: "approval_required";
      messages: ModelMessage[];
      toolCache: ToolCallCache;
      pendingApproval: PendingApprovalState;
      changedFiles: string[];
      mutationCheckpointIds: string[];
      answer?: string;
    }
  | { kind: "cancelled" }
  | { kind: "budget_exhausted"; answer?: string; message: string }
  | {
      kind: "failed";
      answer?: string;
      extraReasons: AgentReasonCode[];
      error: { code: string; message: string };
    };

type VerificationGateOutcome =
  | { kind: "ok" }
  | { kind: "failed"; error: { code: string; message: string } };

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
      toolDefinitions: dependencies.toolDefinitions,
      clock: dependencies.clock ?? { now: () => new Date() },
      idGenerator: dependencies.idGenerator ?? {
        next: (prefix: string) =>
          `${prefix}_${Math.random().toString(36).slice(2, 10)}`,
      },
    };
  }

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
    return this.createRunHandle(runId, (bus, signal, getCancelReason) =>
      this.executeRun({ runId, input: parsed, bus, signal, getCancelReason }),
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
    /** Previously approved/edited plan (plan-approval resume). */
    approvedPlan?: PlanArtifact;
    /** Skip plan-gate suspension (after user approved/edited the plan). */
    skipPlanGate?: boolean;
  }): Promise<AgentRunResult> {
    const {
      runId,
      input,
      bus,
      signal,
      getCancelReason,
      approvedPlan,
      skipPlanGate = false,
    } = params;
    const startedMs = Date.now();
    const budgetLimits = agentRunBudgetSchema.parse(input.budget ?? {});
    const budget = new RunBudgetTracker(budgetLimits, startedMs);
    const reasonCodes: AgentReasonCode[] = ["run_started"];
    const warnings: string[] = [];
    let pinnedState: RepositoryStateReference | undefined;
    let requestId = input.request.requestId ?? runId;
    let route: AgentRunResult["route"];
    let planningDepth: AgentRunResult["planningDepth"];
    let runPlan: PlanArtifact | undefined;

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
      const result = agentRunResultSchema.parse({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId,
        requestId,
        status: partial.status,
        route: partial.route ?? route,
        planningDepth: partial.planningDepth ?? planningDepth,
        answer: partial.answer,
        plan: partial.plan ?? runPlan,
        suspension: partial.suspension,
        pinnedState: partial.pinnedState ?? pinnedState,
        reasonCodes: partial.reasonCodes ?? reasonCodes,
        warnings: [...warnings, ...(partial.warnings ?? [])],
        usage: {
          modelCalls: usageSnap.modelCalls,
          toolCalls: usageSnap.toolCalls,
          loopIterations: usageSnap.loopIterations,
          inputTokens: usageSnap.inputTokens,
          outputTokens: usageSnap.outputTokens,
        },
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

    const cancelledResult = (): AgentRunResult =>
      finish({
        status: "cancelled",
        reasonCodes: [...reasonCodes, "cancelled"],
        error: {
          code: "cancelled",
          message: getCancelReason() ?? "Run cancelled.",
        },
      });

    try {
      if (signal.aborted) {
        return cancelledResult();
      }

      // --- Intake ---
      this.emitStage(bus, runId, "received", "started");
      const envelope = this.deps.intake.intake(input.request);
      requestId = envelope.requestId;
      reasonCodes.push("intake_complete");
      this.emitStage(bus, runId, "received", "completed", ["intake_complete"]);

      if (signal.aborted) {
        return cancelledResult();
      }

      // --- Understand ---
      this.emitStage(bus, runId, "understood", "started");
      const understanding = await this.deps.understanding.understand(envelope);
      reasonCodes.push("understanding_complete");
      this.emitStage(bus, runId, "understood", "completed", [
        "understanding_complete",
      ]);

      if (signal.aborted) {
        return cancelledResult();
      }

      // --- Decide ---
      this.emitStage(bus, runId, "decided", "started");
      const decision = this.deps.decision.decide({
        schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
        envelope: envelope as DecisionPolicyInput["envelope"],
        understanding,
        repositoryState: input.repositoryState,
        approvalMode: input.approvalMode,
        planApproval: input.planApproval,
      });
      route = decision.route;
      planningDepth = decision.planningDepth;
      reasonCodes.push("decision_complete");
      this.emit(bus, {
        type: "decision_made",
        runId,
        route: decision.route,
        runDisposition: decision.runDisposition,
        at: this.isoNow(),
      });
      this.emitStage(bus, runId, "decided", "completed", ["decision_complete"]);

      if (signal.aborted) {
        return cancelledResult();
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
          });
        }
        this.emit(bus, {
          type: "suspended",
          runId,
          kind: "clarification_required",
          rationale,
          at: this.isoNow(),
        });
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

      // --- Pin + Context ---
      let repositoryContext: PromptRepositoryContext | undefined;
      pinnedState = await this.resolveAndPinState({
        runId,
        decision,
        envelope,
        input,
        bus,
        reasonCodes,
        warnings,
      });

      if (signal.aborted) {
        await this.safeUnpin(runId, pinnedState);
        return cancelledResult();
      }

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
        const contextResult = await this.deps.repositoryContext.execute({
          state: pinnedState,
          query: extractPrimaryUserMessage(envelope.message),
          mode: envelope.mode,
          abortSignal: signal,
        });

        if (signal.aborted || contextResult.status === "cancelled") {
          await this.safeUnpin(runId, pinnedState);
          return cancelledResult();
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
        const contextPaths = contextResult.assembly.blocks
          .map((block) => block.relativePath)
          .filter((path): path is string => Boolean(path?.trim()))
          .slice(0, 12);
        this.emit(bus, {
          type: "context_ready",
          runId,
          stateToken: contextResult.stateToken,
          blockCount: contextResult.assembly.blocks.length,
          status: contextResult.status,
          ...(contextPaths.length > 0 ? { paths: contextPaths } : {}),
          at: this.isoNow(),
        });
        this.emitStage(bus, runId, "context_ready", "completed", [
          "context_retrieved",
        ]);
      } else {
        reasonCodes.push("context_skipped");
      }

      if (signal.aborted) {
        await this.safeUnpin(runId, pinnedState);
        return cancelledResult();
      }

      // --- Skills (optional) ---
      let selectedSkills: PromptInstructions["skills"];
      if (this.deps.skills) {
        this.emitStage(bus, runId, "skills_ready", "started");
        const skillsResult = await this.deps.skills.select({
          schemaVersion: SKILLS_SCHEMA_VERSION,
          query: extractPrimaryUserMessage(envelope.message),
          mode: envelope.mode,
          route: decision.route,
          evidence: mapUnderstandingToSkillEvidence(understanding),
        });
        selectedSkills = skillsResult.instructions.map((block) => ({
          id: block.id,
          title: block.title,
          content: block.content,
          priority: block.priority,
        }));
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
        return cancelledResult();
      }

      // --- Memory (optional) ---
      let selectedMemory: PromptInstructions["memory"];
      const workspaceId = envelope.workspace?.workspaceId;
      if (this.deps.memory && workspaceId) {
        this.emitStage(bus, runId, "memory_ready", "started");
        const memoryResult = await this.deps.memory.retrieve({
          schemaVersion: MEMORY_SCHEMA_VERSION,
          query: extractPrimaryUserMessage(envelope.message),
          scope: { kind: "workspace", workspaceId },
          now: this.isoNow(),
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
            : "memory_skipped",
        ]);
      } else {
        reasonCodes.push("memory_skipped");
      }

      if (signal.aborted) {
        await this.safeUnpin(runId, pinnedState);
        return cancelledResult();
      }

      // --- Planning (optional) ---
      let planText: string | undefined;
      if (approvedPlan) {
        runPlan = approvedPlan;
        planText = serializePlanForPrompt(approvedPlan);
        reasonCodes.push("plan_drafted", "plan_approved");
      } else if (this.deps.planning && decision.planningDepth !== "none") {
        this.emitStage(bus, runId, "plan_ready", "started");
        const contextReviewed = (repositoryContext?.blocks ?? [])
          .slice(0, 20)
          .map((block) => ({
            kind: "file" as const,
            ref: block.relativePath,
          }));
        const planningResult = this.deps.planning.plan({
          schemaVersion: PLANNING_SCHEMA_VERSION,
          query: extractPrimaryUserMessage(envelope.message),
          mode: envelope.mode,
          route: decision.route,
          planningDepth: decision.planningDepth,
          evidence: mapUnderstandingToPlanningEvidence(understanding),
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
        });

        if (planningResult.plan) {
          runPlan = planningResult.plan;
          planText = serializePlanForPrompt(planningResult.plan);
          reasonCodes.push("plan_drafted");
          this.emit(bus, {
            type: "plan_ready",
            runId,
            planningDepth: decision.planningDepth,
            phaseCount: planningResult.plan.phases.length,
            approvalRequired: planningResult.plan.approvalRequired,
            at: this.isoNow(),
          });
          this.emitStage(bus, runId, "plan_ready", "completed", [
            "plan_drafted",
          ]);

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
                changedFiles: [],
                mutationCheckpointIds: [],
                reasonCodes,
                warnings,
                usage: budget.snapshot(),
                startedAtMs: startedMs,
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
        } else {
          reasonCodes.push("plan_skipped");
          this.emitStage(bus, runId, "plan_ready", "completed", [
            "plan_skipped",
          ]);
        }
      } else {
        reasonCodes.push("plan_skipped");
      }

      if (signal.aborted) {
        await this.safeUnpin(runId, pinnedState);
        return cancelledResult();
      }

      // --- Prompt ---
      const tools = filterToolDefinitions({
        grant: decision.toolGrant,
        definitions:
          input.tools ?? this.deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS,
        supportsTools: this.deps.llm.capabilities.supportsTools,
      });

      const mutationBudgetRule = buildMutationBudgetInstruction(
        decision.toolGrant.mutationBudget,
      );
      const hostInstructions: PromptInstructions | undefined = mutationBudgetRule
        ? {
            ...input.instructions,
            projectRules: [
              ...(input.instructions?.projectRules ?? []),
              mutationBudgetRule,
            ],
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

      // --- Model / tool loop ---
      const messages: ModelMessage[] = [...promptResult.request.messages];
      const toolCache = new ToolCallCache();
      const changedFiles: string[] = [];
      const mutationCheckpointIds: string[] = [];

      const loopOutcome = await this.runModelToolLoop({
        runId,
        request: promptResult.request,
        decision,
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
      });

      return await this.finishAfterLoop({
        runId,
        requestId,
        input,
        decision,
        bus,
        pinnedState,
        loopOutcome,
        reasonCodes,
        warnings,
        budget,
        startedAtMs: startedMs,
        finish,
        cancelledResult,
      });
    } catch (error) {
      await this.safeUnpin(runId, pinnedState);
      if (signal.aborted) {
        return cancelledResult();
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
    const decision = checkpoint.decision;
    const startInput = checkpoint.input;
    const pinnedState = checkpoint.pinnedState;
    const reasonCodes: AgentReasonCode[] = [...checkpoint.reasonCodes];
    const warnings: string[] = [...checkpoint.warnings];
    const resumedAtMs = Date.now();
    const suspensionWaitMs =
      checkpoint.suspendedAtMs !== undefined
        ? Math.max(0, resumedAtMs - checkpoint.suspendedAtMs)
        : 0;
    const excludedWaitMs =
      (checkpoint.excludedWaitMs ?? 0) + suspensionWaitMs;
    const budget = new RunBudgetTracker(
      agentRunBudgetSchema.parse(startInput.budget ?? {}),
      checkpoint.startedAtMs,
      checkpoint.usage,
      excludedWaitMs,
    );

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
      const result = agentRunResultSchema.parse({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId,
        requestId,
        status: partial.status,
        route: partial.route ?? decision.route,
        planningDepth: partial.planningDepth ?? decision.planningDepth,
        answer: partial.answer,
        plan: partial.plan ?? checkpoint.plan,
        suspension: partial.suspension,
        pinnedState: partial.pinnedState ?? pinnedState,
        reasonCodes: partial.reasonCodes ?? reasonCodes,
        warnings: [...warnings, ...(partial.warnings ?? [])],
        usage: {
          modelCalls: usageSnap.modelCalls,
          toolCalls: usageSnap.toolCalls,
          loopIterations: usageSnap.loopIterations,
          inputTokens: usageSnap.inputTokens,
          outputTokens: usageSnap.outputTokens,
        },
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

    const cancelledResult = (): AgentRunResult =>
      finish({
        status: "cancelled",
        reasonCodes: [...reasonCodes, "cancelled"],
        error: {
          code: "cancelled",
          message: getCancelReason() ?? "Run cancelled.",
        },
      });

    try {
      if (signal.aborted) {
        return cancelledResult();
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
          skipPlanGate: true,
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

      const toolDefinitions = filterToolDefinitions({
        grant: decision.toolGrant,
        definitions:
          startInput.tools ??
          this.deps.toolDefinitions ??
          DEFAULT_TOOL_DEFINITIONS,
        supportsTools: this.deps.llm.capabilities.supportsTools,
      });

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
      });

      return await this.finishAfterLoop({
        runId,
        requestId,
        input: startInput,
        decision,
        bus,
        pinnedState,
        loopOutcome,
        reasonCodes,
        warnings,
        budget,
        startedAtMs: checkpoint.startedAtMs,
        finish,
        cancelledResult,
      });
    } catch (error) {
      if (error instanceof AgentEngineError) {
        throw error;
      }
      await this.safeUnpin(runId, pinnedState);
      if (signal.aborted) {
        return cancelledResult();
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
    decision: ExecutionDecision;
    bus: EventBus;
    pinnedState: RepositoryStateReference | undefined;
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
    cancelledResult: () => AgentRunResult;
  }): Promise<AgentRunResult> {
    const {
      runId,
      requestId,
      input,
      decision,
      bus,
      pinnedState,
      loopOutcome,
      reasonCodes,
      warnings,
      budget,
      startedAtMs,
      finish,
      cancelledResult,
    } = params;

    if (loopOutcome.kind === "approval_required") {
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
        messages: loopOutcome.messages,
        toolCacheEntries: loopOutcome.toolCache.entries(),
        pendingApproval: loopOutcome.pendingApproval,
        changedFiles: loopOutcome.changedFiles,
        mutationCheckpointIds: loopOutcome.mutationCheckpointIds,
        reasonCodes,
        warnings,
        usage: budget.snapshot(),
        startedAtMs,
        excludedWaitMs: budget.getExcludedWaitMs(),
        suspendedAtMs: Date.now(),
      });

      const rationale = `Approval required for "${loopOutcome.pendingApproval.toolName}".`;
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
            approvalId: loopOutcome.pendingApproval.approvalId,
            fingerprint: loopOutcome.pendingApproval.fingerprint,
            toolName: loopOutcome.pendingApproval.toolName,
            callId: loopOutcome.pendingApproval.callId,
            paths: loopOutcome.pendingApproval.paths,
          },
        },
        reasonCodes,
      });
    }

    if (loopOutcome.kind === "cancelled") {
      await this.safeUnpin(runId, pinnedState);
      return cancelledResult();
    }

    if (loopOutcome.kind === "budget_exhausted") {
      await this.safeUnpin(runId, pinnedState);
      reasonCodes.push("budget_exhausted");
      return finish({
        status: "budget_exhausted",
        answer: loopOutcome.answer,
        reasonCodes,
        error: {
          code: "budget_exhausted",
          message: loopOutcome.message,
        },
      });
    }

    if (loopOutcome.kind === "failed") {
      await this.safeUnpin(runId, pinnedState);
      return finish({
        status: "failed",
        answer: loopOutcome.answer,
        reasonCodes: [...reasonCodes, ...loopOutcome.extraReasons],
        error: loopOutcome.error,
      });
    }

    // loopOutcome.kind === "completed"
    reasonCodes.push("answer_produced");

    const verificationOutcome = await this.runVerificationGate({
      runId,
      bus,
      decision,
      input,
      pinnedState,
      changedFiles: loopOutcome.changedFiles,
      mutationCheckpointIds: loopOutcome.mutationCheckpointIds,
      reasonCodes,
      warnings,
    });

    await this.safeUnpin(runId, pinnedState);

    if (verificationOutcome.kind === "failed") {
      return finish({
        status: "failed",
        answer: loopOutcome.answer,
        reasonCodes,
        error: verificationOutcome.error,
      });
    }

    return finish({
      status: "completed",
      answer: loopOutcome.answer,
      reasonCodes,
    });
  }

  private async resolveAndPinState(params: {
    runId: string;
    decision: ExecutionDecision;
    envelope: UserRequestEnvelope;
    input: AgentEngineStartInput;
    bus: EventBus;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
  }): Promise<RepositoryStateReference | undefined> {
    const { runId, decision, envelope, input, bus, reasonCodes, warnings } =
      params;

    if (!decision.repositoryContextRequired) {
      return decision.pinnedState ?? input.repositoryState?.reference;
    }

    let reference =
      decision.pinnedState ?? input.repositoryState?.reference;

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
   * Gate completion on Verification when the decision requires it and a
   * mutation changed files. Rolls back applied mutations on failure and
   * commits them on success (or when verification is skipped safely).
   */
  private async runVerificationGate(params: {
    runId: string;
    bus: EventBus;
    decision: ExecutionDecision;
    input: AgentEngineStartInput;
    pinnedState: RepositoryStateReference | undefined;
    changedFiles: string[];
    mutationCheckpointIds: string[];
    reasonCodes: AgentReasonCode[];
    warnings: string[];
  }): Promise<VerificationGateOutcome> {
    const {
      runId,
      bus,
      decision,
      input,
      pinnedState,
      changedFiles,
      mutationCheckpointIds,
      reasonCodes,
      warnings,
    } = params;

    if (!decision.verification.required || changedFiles.length === 0) {
      this.commitMutations(mutationCheckpointIds);
      return { kind: "ok" };
    }

    const canVerify =
      this.deps.verification !== undefined &&
      pinnedState !== undefined &&
      input.workspaceRoot !== undefined;

    if (!canVerify) {
      if (decision.verification.allowUnavailable) {
        reasonCodes.push("verification_skipped");
        this.commitMutations(mutationCheckpointIds);
        return { kind: "ok" };
      }
      await this.rollbackMutations(mutationCheckpointIds, warnings);
      reasonCodes.push("mutation_rolled_back", "verification_failed");
      return {
        kind: "failed",
        error: {
          code: "verification_failed",
          message:
            "Verification is required but unavailable (missing verification port or pinned state).",
        },
      };
    }

    this.emitStage(bus, runId, "verifying", "started");
    const verificationGrant = buildVerificationGrant(decision.toolGrant);
    const projects = resolveVerificationProjects(input);
    const verificationResult = await this.deps.verification!.verify({
      schemaVersion: VERIFICATION_SCHEMA_VERSION,
      workspaceRoot: input.workspaceRoot!,
      pinnedState: pinnedState!,
      changedFiles,
      projects,
      verification: decision.verification,
      grant: verificationGrant,
      changeScope: "localized",
      stateReadiness: input.repositoryState?.readiness ?? "ready",
    });

    if (verificationResult.status === "verified_success") {
      this.emitStage(bus, runId, "verifying", "completed", [
        "verification_passed",
      ]);
      reasonCodes.push("verification_passed");
      this.commitMutations(mutationCheckpointIds);
      return { kind: "ok" };
    }

    if (decision.verification.allowUnavailable) {
      this.emitStage(bus, runId, "verifying", "completed", [
        "verification_skipped",
      ]);
      reasonCodes.push("verification_skipped");
      warnings.push(
        `Verification did not confirm success (status: ${verificationResult.status}); implementation kept unverified.`,
      );
      this.commitMutations(mutationCheckpointIds);
      return { kind: "ok" };
    }

    this.emitStage(bus, runId, "verifying", "completed", [
      "verification_failed",
    ]);
    await this.rollbackMutations(mutationCheckpointIds, warnings);
    reasonCodes.push("mutation_rolled_back", "verification_failed");
    return {
      kind: "failed",
      error: {
        code: "verification_failed",
        message: `Verification did not succeed (status: ${verificationResult.status}).`,
      },
    };
  }

  private commitMutations(mutationCheckpointIds: readonly string[]): void {
    if (mutationCheckpointIds.length === 0 || !this.deps.tools?.commitMutation) {
      return;
    }
    for (const checkpointId of mutationCheckpointIds) {
      try {
        this.deps.tools.commitMutation(checkpointId);
      } catch {
        // Commit is best-effort; the mutation already applied successfully.
      }
    }
  }

  private async rollbackMutations(
    mutationCheckpointIds: readonly string[],
    warnings: string[],
  ): Promise<void> {
    if (mutationCheckpointIds.length === 0) {
      return;
    }
    if (!this.deps.tools?.rollbackMutation) {
      warnings.push(
        "Mutation rollback was required but no rollback port is configured.",
      );
      return;
    }
    for (const checkpointId of mutationCheckpointIds) {
      try {
        await this.deps.tools.rollbackMutation({ checkpointId });
      } catch (error) {
        warnings.push(
          `Failed to roll back checkpoint "${checkpointId}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async runModelToolLoop(params: {
    runId: string;
    request: ModelRequest;
    decision: ExecutionDecision;
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
  }): Promise<ToolLoopOutcome> {
    const {
      runId,
      decision,
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
    } = params;
    const grant = decision.toolGrant;
    let answer = "";
    let truncationRecoveries = 0;

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
        };
      }

      if (!budget.canStartModelCall()) {
        return {
          kind: "budget_exhausted",
          answer: answer || undefined,
          message: "Model call budget exhausted.",
        };
      }

      budget.recordLoopIteration();
      budget.recordModelCall();
      this.emitStage(bus, runId, "model_running", "started");

      const turnRequest: ModelRequest = {
        ...params.request,
        messages: [...messages],
      };

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
      });

      if (recovery?.shouldRecover) {
        truncationRecoveries += 1;
        reasonCodes.push("output_truncation_recovered");
        answer = recovery.assistantContent;
        messages.push({
          role: "assistant",
          content: recovery.assistantContent,
        });
        messages.push(recovery.recoveryMessage);
        this.emit(bus, {
          type: "warning",
          runId,
          message:
            "Discarded incomplete truncated tool call(s); continuing with a smaller-batch instruction.",
          at: this.isoNow(),
        });
        this.emitStage(bus, runId, "model_running", "completed", [
          "model_completed",
          "output_truncated",
          "output_truncation_recovered",
        ]);
        continue;
      }

      if (turn.content.length > 0) {
        answer = truncated
          ? `${turn.content}\n\n…(output truncated — token limit reached)`
          : turn.content;
      }

      reasonCodes.push("model_completed");
      this.emitStage(bus, runId, "model_running", "completed", [
        "model_completed",
        ...(truncated ? (["output_truncated"] as const) : []),
      ]);

      if (turn.toolCalls.length === 0) {
        return {
          kind: "completed",
          answer,
          changedFiles,
          mutationCheckpointIds,
          messages,
          toolCache,
        };
      }

      // Tool phase
      if (!this.deps.tools) {
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
      if (!workspaceRoot) {
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
        toolCalls: turn.toolCalls,
      });

      this.emitStage(bus, runId, "tool_running", "started");

      for (const toolCall of turn.toolCalls) {
        if (signal.aborted) {
          return { kind: "cancelled" };
        }
        if (!budget.canStartToolCall()) {
          return {
            kind: "budget_exhausted",
            answer: answer || undefined,
            message: "Tool call budget exhausted.",
          };
        }

        const outcome = await this.executeOneTool({
          runId,
          toolCall,
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
          approvalToken: undefined,
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
          };
        }

        messages.push(outcome.message);
      }

      reasonCodes.push("tools_executed");
      this.emitStage(bus, runId, "tool_running", "completed", [
        "tools_executed",
      ]);
    }
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
  }): Promise<ToolCallOutcome> {
    const {
      runId,
      toolCall,
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
    } = params;

    this.emit(bus, {
      type: "tool_started",
      runId,
      callId: toolCall.id,
      toolName: toolCall.name,
      at: this.isoNow(),
    });

    const cached = toolCache.get(toolCall.id);
    if (cached) {
      this.emit(bus, {
        type: "tool_completed",
        runId,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: cached.status,
        at: this.isoNow(),
      });
      return {
        kind: "message",
        message: {
          role: "tool",
          toolCallId: toolCall.id,
          content: serializeToolResultForModel(cached),
        },
      };
    }

    budget.recordToolCall();

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

    if (result.status === "succeeded" && toolCall.name === "apply_patch") {
      const output = result.output as
        | { checkpointId?: string; changedFiles?: string[] }
        | undefined;
      if (output?.checkpointId) {
        mutationCheckpointIds.push(output.checkpointId);
      }
      for (const changed of output?.changedFiles ?? []) {
        if (!changedFiles.includes(changed)) {
          changedFiles.push(changed);
        }
      }
      reasonCodes.push("mutation_applied");
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
      at: this.isoNow(),
    });

    return {
      kind: "message",
      message: {
        role: "tool",
        toolCallId: toolCall.id,
        content: serializeToolResultForModel(result),
      },
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
        usage?: { inputTokens?: number; outputTokens?: number };
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
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
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
            };
            break;
          case "completed":
            finishReason = event.finishReason;
            if (event.usage) {
              usage = {
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
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

export type { AgentRunStatus };
