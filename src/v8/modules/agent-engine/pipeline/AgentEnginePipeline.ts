import type {
  DecisionPolicyInput,
  ExecutionDecision,
  ToolGrant,
} from "../../decision-policy";
import { DECISION_POLICY_SCHEMA_VERSION } from "../../decision-policy";
import type {
  LlmPort,
  ModelEvent,
  ModelMessage,
  ModelRequest,
  ModelToolCall,
  ModelToolCallDelta,
} from "../../model-gateway";
import { PROMPT_CONSTRUCTION_SCHEMA_VERSION } from "../../prompt-construction";
import type { PromptRepositoryContext } from "../../prompt-construction";
import type { RepositoryStateReference } from "../../repository-state";
import type { UserRequestEnvelope } from "../../request-intake";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";

import {
  assembleToolCalls,
  filterToolDefinitions,
  mapContextToPromptSlice,
  serializeToolResultForModel,
} from "../actions";
import {
  AGENT_ENGINE_SCHEMA_VERSION,
} from "../constants";
import {
  agentEngineStartInputSchema,
  agentRunBudgetSchema,
  agentRunResultSchema,
  AgentEngineError,
} from "../contracts";
import type {
  AgentActiveStage,
  AgentEngineDependencies,
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunHandle,
  AgentRunResult,
  AgentRunStatus,
  RunEvent,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import { ToolCallCache } from "../internal/ToolCallCache";
import { PHASE7_SUPPORTED_ROUTES } from "../policy";

export type AgentEnginePipelineDependencies = AgentEngineDependencies;

/**
 * Agent Engine facade (Phase 7 read-only).
 *
 * Flow:
 *   Intake → Understand → Decide → pin Repository State
 *   → retrieve Context → construct Prompt → invoke Model
 *   → execute authorized read-only Tools as needed → Result
 *
 * Does not implement understanding, policy, retrieval, prompting,
 * tool enforcement, or verification algorithms.
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
      | "repositoryState"
      | "repositoryContext"
      | "tools"
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
      repositoryState: dependencies.repositoryState,
      repositoryContext: dependencies.repositoryContext,
      tools: dependencies.tools,
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
    const bus = new EventBus();
    const abort = new AbortController();
    let cancelReason: string | undefined;

    const resultPromise = this.executeRun({
      runId,
      input: parsed,
      bus,
      signal: abort.signal,
      getCancelReason: () => cancelReason,
    }).finally(() => {
      bus.end();
    });

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
  }): Promise<AgentRunResult> {
    const { runId, input, bus, signal, getCancelReason } = params;
    const startedMs = Date.now();
    const budgetLimits = agentRunBudgetSchema.parse(input.budget ?? {});
    const budget = new RunBudgetTracker(budgetLimits, startedMs);
    const reasonCodes: AgentReasonCode[] = ["run_started"];
    const warnings: string[] = [];
    let pinnedState: RepositoryStateReference | undefined;
    let requestId = input.request.requestId ?? runId;
    let route: AgentRunResult["route"];
    let planningDepth: AgentRunResult["planningDepth"];

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
        suspension: partial.suspension,
        pinnedState: partial.pinnedState ?? pinnedState,
        reasonCodes: partial.reasonCodes ?? reasonCodes,
        warnings: [...warnings, ...(partial.warnings ?? [])],
        usage: {
          modelCalls: usageSnap.modelCalls,
          toolCalls: usageSnap.toolCalls,
          loopIterations: usageSnap.loopIterations,
          ...(usageSnap.inputTokens > 0
            ? { inputTokens: usageSnap.inputTokens }
            : {}),
          ...(usageSnap.outputTokens > 0
            ? { outputTokens: usageSnap.outputTokens }
            : {}),
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
            clarificationPrompt: envelope.message,
          },
          reasonCodes,
        });
      }

      // Phase 7: mutation routes are deferred.
      if (
        !(PHASE7_SUPPORTED_ROUTES as readonly string[]).includes(decision.route)
      ) {
        reasonCodes.push("mutation_deferred");
        return finish({
          status: "failed",
          route: decision.route,
          planningDepth: decision.planningDepth,
          reasonCodes,
          error: {
            code: "mutation_deferred",
            message:
              "Phase 7 Agent Engine supports read-only routes only. Mutation requires Phase 8.",
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
          query: envelope.message,
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
        this.emit(bus, {
          type: "context_ready",
          runId,
          stateToken: contextResult.stateToken,
          blockCount: contextResult.assembly.blocks.length,
          status: contextResult.status,
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

      // --- Prompt ---
      const tools = filterToolDefinitions({
        grant: decision.toolGrant,
        definitions: input.tools ?? this.deps.toolDefinitions,
        supportsTools: this.deps.llm.capabilities.supportsTools,
      });

      const promptResult = this.deps.prompt.construct({
        schemaVersion: PROMPT_CONSTRUCTION_SCHEMA_VERSION,
        decision,
        userMessage: envelope.message,
        conversation: input.conversation,
        repositoryContext,
        instructions: input.instructions,
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
      const loopOutcome = await this.runModelToolLoop({
        runId,
        request: promptResult.request,
        grant: decision.toolGrant,
        pinnedState,
        workspaceRoot: input.workspaceRoot,
        bus,
        signal,
        budget,
        reasonCodes,
        warnings,
      });

      await this.safeUnpin(runId, pinnedState);

      if (loopOutcome.kind === "cancelled") {
        return cancelledResult();
      }
      if (loopOutcome.kind === "budget_exhausted") {
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
        return finish({
          status: "failed",
          answer: loopOutcome.answer,
          reasonCodes: [...reasonCodes, ...loopOutcome.extraReasons],
          error: loopOutcome.error,
        });
      }

      reasonCodes.push("answer_produced");
      return finish({
        status: "completed",
        answer: loopOutcome.answer,
        reasonCodes,
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

  private async runModelToolLoop(params: {
    runId: string;
    request: ModelRequest;
    grant: ToolGrant;
    pinnedState: RepositoryStateReference | undefined;
    workspaceRoot: string | undefined;
    bus: EventBus;
    signal: AbortSignal;
    budget: RunBudgetTracker;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
  }): Promise<
    | { kind: "completed"; answer: string }
    | { kind: "cancelled" }
    | { kind: "budget_exhausted"; answer?: string; message: string }
    | {
        kind: "failed";
        answer?: string;
        extraReasons: AgentReasonCode[];
        error: { code: string; message: string };
      }
  > {
    const {
      runId,
      grant,
      pinnedState,
      workspaceRoot,
      bus,
      signal,
      budget,
      reasonCodes,
      warnings,
    } = params;

    const messages: ModelMessage[] = [...params.request.messages];
    const toolCache = new ToolCallCache();
    let answer = "";

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

      if (turn.content.length > 0) {
        answer = turn.content;
      }

      reasonCodes.push("model_completed");
      this.emitStage(bus, runId, "model_running", "completed", [
        "model_completed",
      ]);

      if (turn.toolCalls.length === 0) {
        return { kind: "completed", answer };
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

        const toolMessage = await this.executeOneTool({
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
        });

        messages.push(toolMessage);
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
  }): Promise<ModelMessage> {
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
        role: "tool",
        toolCallId: toolCall.id,
        content: serializeToolResultForModel(cached),
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
      { signal },
    );

    toolCache.set(toolCall.id, result);

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
      role: "tool",
      toolCallId: toolCall.id,
      content: serializeToolResultForModel(result),
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
    const toolDeltas: ModelToolCallDelta[] = [];
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;

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
              content: contentParts.join(""),
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
        content: contentParts.join(""),
        errorCode: "provider_failed",
        errorMessage:
          error instanceof Error ? error.message : "Model invocation failed.",
      };
    }

    if (signal.aborted) {
      return { kind: "cancelled" };
    }

    return {
      kind: "completed",
      content: contentParts.join(""),
      toolCalls: assembleToolCalls(toolDeltas),
      usage,
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

export type { AgentRunStatus };
