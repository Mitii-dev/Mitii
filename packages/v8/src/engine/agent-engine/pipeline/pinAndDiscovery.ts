import type {
  ExecutionDecision,
  ToolGrant,
} from "../../../modules/decision-policy";
import {
  buildVerificationGrant,
} from "../../../modules/decision-policy";
import type {
  ModelMessage,
} from "../../../modules/model-gateway";
import {
  compileDiscoveryBrief,
} from "../../../modules/planning";
import type {
  DiscoveryBrief,
  DiscoveryTarget,
  PlanningInput,
} from "../../../modules/planning";
import type {
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type {
  RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import {
  TOOL_RUNTIME_SCHEMA_VERSION,
} from "../../tool-runtime";
import type {
  RepoBuildState,
} from "../../../modules/verification";

import {
  summarizeToolCall,
  filterToolDefinitions,
  serializeToolResultForModel,
  buildPreflightVerificationInput,
  buildSyntheticPreflightGrant,
  inferDiscoveryTargetKind,
} from "../actions";
import {
  collectShapedDiscoveryHits,
  rankPathsForShapedDiscovery,
  resolveShapedDiscoveryProfile,
  selectShapedDiscoverySeeds,
} from "../actions/shapedDiscovery";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
} from "../contracts";
import {
  DISCOVERY_PASS_POLICY,
  buildDiscoveryPrompt,
  createDiscoveryGrant,
  createDiscoveryObservationCollector,
  createDiscoveryTaskList,
  discoveryBudgetRemaining,
  hasDiscoveryReadPath,
  isDiscoveryToolAllowed,
  recordDiscoveryToolUse,
  toDiscoveryObservation,
} from "../internal/discoveryPass";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  logVerbosityAtLeast,
} from "../internal/logVerbosity";
import {
  type TaskListRef,
} from "../internal/taskListRuntime";
import {
  DEFAULT_TOOL_DEFINITIONS,
} from "../policy";

import type { AgentEngineRuntime } from "./runtime";

import { consumeModelTurn } from "./modelToolLoop";

/**
 * Resolve + pin whenever a workspace reference exists — no longer gated
 * on `decision.repositoryContextRequired`, since pin now runs before
 * Decision Policy so an Agent-execute preflight snapshot can happen
 * before `understand()`.
 */
export async function resolveAndPinState(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  envelope: UserRequestEnvelope;
  input: AgentEngineStartInput;
  bus: EventBus;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
}): Promise<RepositoryStateReference | undefined> {
  const { runId, envelope, input, bus, reasonCodes, warnings } = params;

  let reference = input.repositoryState?.reference;

  if (!reference && runtime.deps.repositoryState && envelope.workspace) {
    const latest = await runtime.deps.repositoryState.getLatest(
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

  if (runtime.deps.repositoryState) {
    const pinResult = await runtime.deps.repositoryState.pin({
      state: reference,
      runId,
    });
    if (pinResult.status === "failed") {
      warnings.push(pinResult.message);
      reasonCodes.push("state_unavailable");
      if (logVerbosityAtLeast(input.logVerbosity, "standard")) {
        runtime.emit(bus, {
          type: "warning",
          runId,
          message: pinResult.message,
          code: "state_unavailable",
          stage: "received",
          at: runtime.isoNow(),
        });
      }
      return undefined;
    }
    reasonCodes.push("state_pinned");
    runtime.emit(bus, {
      type: "state_pinned",
      runId,
      state: reference,
      at: runtime.isoNow(),
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
 *    The caller gates this on repair/mutation-shaped asks, not every
 *    Agent chat.
 *  - Plan mode (repair intent), gated on `decision.reasonCodes` as before,
 *    using the real decision-derived grant. Skipped entirely when the
 *    Agent-mode capture already ran.
 */
export async function capturePreflightBuildState(
  runtime: AgentEngineRuntime,
  params: {
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
    !runtime.deps.verification?.captureBuildState ||
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

  runtime.emitStage(bus, runId, "verifying", "started");
  try {
    if (signal.aborted) {
      warnings.push("Preflight build snapshot was cancelled.");
      runtime.emitStage(bus, runId, "verifying", "completed", []);
      return undefined;
    }
    const verificationGrant = decision
      ? buildVerificationGrant(decision.toolGrant)
      : buildVerificationGrant(
          buildSyntheticPreflightGrant(input.workspaceRoot),
        );
    const buildState = await runtime.deps.verification.captureBuildState(
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
      { phase: "before", capturedAt: runtime.isoNow() },
      { signal },
    );
    if (signal.aborted) {
      warnings.push("Preflight build snapshot was cancelled.");
      runtime.emitStage(bus, runId, "verifying", "completed", []);
      return undefined;
    }
    reasonCodes.push("repo_build_state_before_captured");
    runtime.emitStage(bus, runId, "verifying", "completed", [
      "repo_build_state_before_captured",
    ]);
    return buildState;
  } catch (error) {
    warnings.push(
      `Preflight build snapshot failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    runtime.emitStage(bus, runId, "verifying", "completed", []);
    return undefined;
  }
}

export async function runDiscoveryPass(
  runtime: AgentEngineRuntime,
  params: {
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
  preferredPaths?: readonly string[];
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
    preferredPaths = [],
  } = params;

  runtime.emitStage(bus, runId, "discovery", "started");
  runtime.emit(bus, {
    type: "discovery_started",
    runId,
    objective: objective.slice(0, 500),
    at: runtime.isoNow(),
  });
  reasonCodes.push("discovery_started");

  const discoveryList = createDiscoveryTaskList();
  taskListRef.current = discoveryList;
  runtime.emitTaskListUpdated(bus, runId, discoveryList);

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
    Boolean(runtime.deps.tools) &&
    Boolean(workspaceRoot) &&
    runtime.deps.llm.capabilities.supportsTools &&
    !signal.aborted;

  let stopReason: "natural" | "turn_cap" | "budget_exhausted" | "aborted" | "model_error" =
    "natural";
  if (canLoop) {
    const grant = createDiscoveryGrant(decision.toolGrant);
    const tools = filterToolDefinitions({
      grant,
      definitions:
        runtime.deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS,
      supportsTools: true,
    }).filter((tool) => isDiscoveryToolAllowed(tool.name));

    // Deterministic shaped-discovery preflight + preferred-path pre-read.
    const shapedProfile = resolveShapedDiscoveryProfile(query);
    const rankedPreferred = shapedProfile
      ? rankPathsForShapedDiscovery(shapedProfile, preferredPaths)
      : preferredPaths;
    const globHits = shapedProfile
      ? await collectShapedDiscoveryHits({
          profile: shapedProfile,
          shouldContinue: () =>
            discoveryBudgetRemaining(collector) &&
            collector.searches < DISCOVERY_PASS_POLICY.maxSearches &&
            !signal.aborted,
          executeTool: async (toolName, argumentsValue) => {
            const result = await executeDiscoveryToolCall(runtime, {
              runId,
              bus,
              budget,
              collector,
              grant,
              workspaceRoot: workspaceRoot!,
              pinnedState,
              windowPolicy,
              toolName,
              argumentsValue,
            });
            return result?.output;
          },
        })
      : [];
    const shapedSeeds = shapedProfile
      ? selectShapedDiscoverySeeds(shapedProfile, globHits, rankedPreferred)
      : [];
    const seeds = [
      ...shapedSeeds,
      ...rankedPreferred.filter((path) => !shapedSeeds.includes(path)),
    ]
      .map((path) => path.trim())
      .filter((path) => path.length > 0 && path.includes("."))
      .slice(0, Math.min(6, DISCOVERY_PASS_POLICY.maxFileReads));
    for (const seedPath of seeds) {
      if (!discoveryBudgetRemaining(collector) || signal.aborted) {
        break;
      }
      if (hasDiscoveryReadPath(collector, seedPath)) {
        continue;
      }
      await executeDiscoveryToolCall(runtime, {
        runId,
        bus,
        budget,
        collector,
        grant,
        workspaceRoot: workspaceRoot!,
        pinnedState,
        windowPolicy,
        toolName: "read_file",
        argumentsValue: { path: seedPath },
      });
    }

    const prompt = buildDiscoveryPrompt({
      query,
      objective,
      preferredPaths: seeds,
      shapedDiscovery: shapedProfile,
    });
    const messages: ModelMessage[] = [
      { role: "system", content: prompt.system },
      {
        role: "user",
        content:
          seeds.length > 0
            ? `${prompt.user}\n\nAlready pre-read: ${seeds.join(", ")}. Continue only if more surfaces are needed.`
            : prompt.user,
      },
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
      const turnResult = await consumeModelTurn(runtime, {
        llm: runtime.deps.llm,
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
        const summary = summarizeToolCall(toolCall.name, argumentsValue);
        const readPath =
          typeof (argumentsValue as { path?: unknown }).path === "string"
            ? (argumentsValue as { path: string }).path
            : undefined;
        if (
          readPath &&
          (toolCall.name === "read_file" || toolCall.name === "read_many_files") &&
          hasDiscoveryReadPath(collector, readPath)
        ) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: `Already read during discovery: ${readPath}`,
          });
          continue;
        }
        runtime.emit(bus, {
          type: "tool_started",
          runId,
          callId: toolCall.id,
          toolName: toolCall.name,
          ...(summary ? { summary } : {}),
          at: runtime.isoNow(),
        });
        budget.recordToolCall();
        const result = runtime.deps.tools
          ? await runtime.deps.tools.execute({
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
        runtime.emit(bus, {
          type: "tool_completed",
          runId,
          callId: toolCall.id,
          toolName: toolCall.name,
          status,
          ...(summary ? { summary } : {}),
          at: runtime.isoNow(),
        });
        runtime.emit(bus, {
          type: "discovery_progress",
          runId,
          filesRead: collector.fileReads,
          searches: collector.searches,
          ...(summary ? { summary } : {}),
          at: runtime.isoNow(),
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
  runtime.emit(bus, {
    type: "discovery_completed",
    runId,
    confidence: brief.confidence,
    fileCount: brief.filesRead.length,
    surfaceCount: brief.proposedChangeSurfaces.length,
    openQuestionCount: brief.openQuestions.length,
    brief,
    stopReason,
    at: runtime.isoNow(),
  });
  runtime.emitStage(bus, runId, "discovery", "completed", [
    failed ? "discovery_failed" : "discovery_completed",
  ]);
  if (failed) {
    warnings.push(
      "Discovery did not identify a concrete change surface. The plan lists open questions instead of invented file tasks.",
    );
  }
  return { brief, failed, collector };
}

async function executeDiscoveryToolCall(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    bus: EventBus;
    budget: RunBudgetTracker;
    collector: ReturnType<typeof createDiscoveryObservationCollector>;
    grant: ToolGrant;
    workspaceRoot: string;
    pinnedState: RepositoryStateReference | undefined;
    windowPolicy: WindowPolicy;
    toolName: string;
    argumentsValue: Record<string, unknown>;
    callIdPrefix?: string;
  },
): Promise<{ status: string; output?: unknown } | undefined> {
  const callId = `${params.callIdPrefix ?? "discovery"}-${params.collector.toolCalls + 1}`;
  const summary = summarizeToolCall(params.toolName, params.argumentsValue);
  runtime.emit(params.bus, {
    type: "tool_started",
    runId: params.runId,
    callId,
    toolName: params.toolName,
    ...(summary ? { summary } : {}),
    at: runtime.isoNow(),
  });
  params.budget.recordToolCall();
  const result = runtime.deps.tools
    ? await runtime.deps.tools.execute({
        schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
        callId,
        toolName: params.toolName,
        arguments: params.argumentsValue,
        grant: params.grant,
        workspaceRoot: params.workspaceRoot,
        pinnedState: params.pinnedState,
      })
    : undefined;
  const status = result?.status ?? "failed";
  recordDiscoveryToolUse({
    collector: params.collector,
    toolName: params.toolName,
    argumentsValue: params.argumentsValue,
    resultOutput: result?.output,
    status,
  });
  runtime.emit(params.bus, {
    type: "tool_completed",
    runId: params.runId,
    callId,
    toolName: params.toolName,
    status,
    ...(summary ? { summary } : {}),
    at: runtime.isoNow(),
  });
  runtime.emit(params.bus, {
    type: "discovery_progress",
    runId: params.runId,
    filesRead: params.collector.fileReads,
    searches: params.collector.searches,
    ...(summary ? { summary } : {}),
    at: runtime.isoNow(),
  });
  return result ? { status: result.status, output: result.output } : undefined;
}
