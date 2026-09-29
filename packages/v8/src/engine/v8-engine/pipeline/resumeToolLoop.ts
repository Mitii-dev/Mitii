import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { VerificationRecord } from "../../../modules/verification";

import {
  annotateMutationToolDefinitions,
} from "../../agent-engine/actions";
import { filterToolDefinitions } from "../actions/progressiveTools";
import type { EstablishedFact } from "../../agent-engine/actions";
import { withMcpAttachOnGrant } from "../../../modules/mcp-attach";
import { ToolCallCache } from "../../agent-engine/internal/ToolCallCache";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import type { AgentRunCheckpoint } from "../../agent-engine/internal/RunCheckpoint";
import { EventBus } from "../../agent-engine/internal/EventBus";
import { RunBudgetTracker } from "../../agent-engine/internal/RunBudget";
import {
  attachTaskListTool,
  type TaskListRef,
} from "../../agent-engine/internal/taskListRuntime";
import { DEFAULT_TOOL_DEFINITIONS } from "../../agent-engine/policy";
import type { AgentEngineRuntime } from "../../agent-engine/pipeline/runtime";
import { finishAfterLoop } from "../../agent-engine/pipeline/verification";
import { resolveSteeringFeatureFlags } from "../../agent-engine/steeringFlags";

import { runV8ModelLoop } from "./modelLoop";

/**
 * Re-enter the thin v8 model/tool loop from a suspended checkpoint.
 */
export async function resumeV8ToolLoopFromCheckpoint(
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
    onRepoBuildStateAfter?: (
      state: NonNullable<AgentRunCheckpoint["repoBuildStateAfter"]>,
    ) => void;
    onVerificationRecord?: (record: VerificationRecord) => void;
    continueOverrideCount?: number;
    /** Extra messages appended before the loop (Continue guidance, etc.). */
    prependMessages?: ModelMessage[];
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

  const attachIds = startInput.requiredMcpServerIds ?? [];
  const toolGrant = withMcpAttachOnGrant(decision.toolGrant, attachIds);
  const decisionWithAttach = { ...decision, toolGrant };
  const tools = annotateMutationToolDefinitions(
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

  const messages: ModelMessage[] = [
    ...checkpoint.messages,
    ...(params.prependMessages ?? []),
  ];
  const toolCache = ToolCallCache.fromEntries(checkpoint.toolCacheEntries);
  const changedFiles = [...checkpoint.changedFiles];
  const mutationCheckpointIds = [...checkpoint.mutationCheckpointIds];
  const establishedFacts: EstablishedFact[] = [];

  const request = {
    messages,
    model: startInput.model ?? runtime.deps.llm.capabilities.modelId,
    tools,
    maximumOutputTokens: windowPolicy.maximumOutputTokens,
  };

  const loopOutcome = await runV8ModelLoop(runtime, {
    runId,
    requestId,
    interactionMode: startInput.request.mode,
    llm: runtime.deps.llm,
    request,
    decision: decisionWithAttach,
    messages,
    bus,
    signal,
    budget,
    reasonCodes,
    warnings,
    toolCache,
    changedFiles,
    mutationCheckpointIds,
    dirtyPaths: startInput.dirtyPaths,
    pinnedState,
    workspaceRoot: startInput.workspaceRoot,
    taskListRef,
    establishedFacts,
    windowPolicy,
    continueOverrideCount: params.continueOverrideCount,
    thresholdOverrides: startInput.v8LoopPolicy?.thresholds,
    criticMode: resolveSteeringFeatureFlags(startInput.steering).criticMode,
  });

  return finishAfterLoop(runtime, {
    runId,
    requestId,
    input: startInput,
    request,
    decision: decisionWithAttach,
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
    continueOverrideCount: params.continueOverrideCount,
    loopContext: {
      mode: startInput.request.mode,
      projects: startInput.projects,
      establishedFacts,
      plan: checkpoint.plan,
      requiredSkillIds: startInput.requiredSkillIds ?? [],
      excludedSkillIds: startInput.excludedSkillIds ?? [],
    },
  });
}
