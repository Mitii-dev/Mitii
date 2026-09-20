import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { VerificationRecord } from "../../../modules/verification";

import {
  annotateMutationToolDefinitions,
  filterToolDefinitions,
} from "../actions";
import { withMcpAttachOnGrant } from "../../../modules/mcp-attach";
import type { EstablishedFact } from "../actions";
import { ToolCallCache } from "../internal/ToolCallCache";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import type { AgentRunCheckpoint } from "../internal/RunCheckpoint";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  attachTaskListTool,
  type TaskListRef,
} from "../internal/taskListRuntime";
import { DEFAULT_TOOL_DEFINITIONS } from "../policy";
import { resolveLoopPolicyThresholds } from "../actions/resolveLoopPolicyThresholds";
import { resolveSteeringFeatureFlags } from "../steeringFlags";

import { observedIdsFromContextEpoch } from "../internal/context-epoch";

import type { AgentEngineRuntime } from "./runtime";
import { runModelToolLoop } from "./modelToolLoop";
import { finishAfterLoop } from "./verification";

export async function resumeToolLoopFromCheckpoint(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    requestId: string;
    checkpoint: AgentRunCheckpoint;
    startInput: AgentEngineStartInput;
    decision: ExecutionDecision;
    bus: EventBus;
    signal: AbortSignal;
    budget: RunBudgetTracker;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    taskListRef: TaskListRef;
    windowPolicy: WindowPolicy;
    pinnedState: AgentRunCheckpoint["pinnedState"];
    finish: (
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
    ) => AgentRunResult;
    cancelledResult: () => Promise<AgentRunResult>;
    repoBuildStateAfter?: AgentRunCheckpoint["repoBuildStateAfter"];
    onRepoBuildStateAfter?: (state: NonNullable<
      AgentRunCheckpoint["repoBuildStateAfter"]
    >) => void;
    onVerificationRecord?: (record: VerificationRecord) => void;
    /** Seeded after a Continue approval so the next stall can enforce the override cap. */
    continueOverrideCount?: number;
    /**
     * When true, the resumed loop starts already awaiting the first mutation
     * (blocks broad rediscovery). Used after unfulfilled/exploration walls
     * with zero workspace edits.
     */
    forceMutationOnResume?: boolean;
  },
): Promise<AgentRunResult> {
  const {
    runId,
    requestId,
    checkpoint,
    startInput,
    decision,
    bus,
    signal,
    budget,
    reasonCodes,
    warnings,
    taskListRef,
    windowPolicy,
    pinnedState,
    finish,
    cancelledResult,
  } = params;

  if (!runtime.deps.tools) {
    await runtime.safeUnpin(runId, pinnedState);
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
    await runtime.safeUnpin(runId, pinnedState);
    return finish({
      status: "failed",
      reasonCodes: [...reasonCodes, "misconfigured"],
      error: {
        code: "misconfigured",
        message: "workspaceRoot is required to resume a tool loop.",
      },
    });
  }

  const messages: ModelMessage[] = [...checkpoint.messages];
  const toolCache = ToolCallCache.fromEntries(checkpoint.toolCacheEntries);
  const changedFiles = [...checkpoint.changedFiles];
  const mutationCheckpointIds = [...checkpoint.mutationCheckpointIds];
  const establishedFacts: EstablishedFact[] = [];

  const attachIds = startInput.requiredMcpServerIds ?? [];
  const toolGrant = withMcpAttachOnGrant(decision.toolGrant, attachIds);
  const toolDefinitions = annotateMutationToolDefinitions(
    attachTaskListTool({
      mode: startInput.request.mode,
      tools: filterToolDefinitions({
        grant: toolGrant,
        definitions:
          startInput.tools ??
          runtime.deps.toolDefinitions ??
          DEFAULT_TOOL_DEFINITIONS,
        supportsTools: runtime.deps.llm.capabilities.supportsTools,
        mode: startInput.request.mode,
        requiredMcpServerIds: attachIds,
      }),
    }),
    toolGrant.mutationBudget,
  );

  // Resume often omits skill/env/memory params; restore IDs from the frozen
  // epoch so Continue does not admit a spurious "(none)" mid-update.
  const epochObserved = observedIdsFromContextEpoch(checkpoint.contextEpoch);

  const loopOutcome = await runModelToolLoop(runtime, {
    runId,
    request: {
      messages: [...messages],
      model: startInput.model,
      temperature: startInput.temperature,
      stream: startInput.stream,
      tools: toolDefinitions,
    },
    decision: { ...decision, toolGrant },
    requestId: checkpoint.requestId,
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
    selectedSkillIds: epochObserved.skillIds,
    projectRuleIds: epochObserved.ruleIds,
    environmentIds: epochObserved.environmentIds,
    memoryFacts: epochObserved.memoryIds.map((id) => ({ id, content: "" })),
    windowPolicy,
    repoBuildStateBefore: checkpoint.repoBuildStateBefore,
    logVerbosity: startInput.logVerbosity,
    reserveVerificationRepairModelCalls: true,
    plan: checkpoint.plan,
    continueOverrideCount:
      params.continueOverrideCount ?? checkpoint.continueOverrideCount ?? 0,
    forceMutationOnResume: params.forceMutationOnResume === true,
    thresholds: resolveLoopPolicyThresholds({
      contextWindowTokens: windowPolicy.contextWindowTokens,
      overrides: startInput.loopPolicy?.thresholds,
    }).thresholds,
    criticMode: resolveSteeringFeatureFlags(startInput.steering).criticMode,
  });

  return await finishAfterLoop(runtime, {
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
    repoBuildStateAfter: params.repoBuildStateAfter,
    onRepoBuildStateAfter: params.onRepoBuildStateAfter,
    onVerificationRecord: params.onVerificationRecord,
    windowPolicy,
    continueOverrideCount:
      params.continueOverrideCount ?? checkpoint.continueOverrideCount ?? 0,
    loopContext: {
      establishedFacts,
      plan: checkpoint.plan,
    },
  });
}
