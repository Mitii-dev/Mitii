import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { VerificationRecord } from "../../../modules/verification";

import {
  annotateMutationToolDefinitions,
} from "../actions";
import { filterToolDefinitions } from "../actions/progressiveTools";
import type { EstablishedFact } from "../actions";
import { withMcpAttachOnGrant } from "../../../modules/mcp-attach";
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
import { DEFAULT_TOOL_DEFINITIONS } from "../legacy/policy";
import { shouldRearmMutateLockOnContinue } from "../modules/mutate-readiness";
import { shouldStripDiscoveryAfterEvidenceExhaustion } from "../actions/resolveEvidenceTerminal";
import {
  isExecutionSeedTrusted,
  resolveExecutionSeed,
} from "../modules/execution-seed";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
import type { AgentEngineRuntime } from "./runtime";
import { finishAfterLoop } from "./verification";
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";

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

  const executionSeed =
    checkpoint.executionSeed ??
    resolveExecutionSeed({
      userPrompt: extractPrimaryUserMessage(startInput.request.userMessage),
      repoBuildStateBefore: checkpoint.repoBuildStateBefore,
    });
  if (checkpoint.executionSeed) {
    reasonCodes.push("execution_seed_restored");
  }
  const mutationRequired =
    decisionWithAttach.reasonCodes.includes("mutation_execute") ||
    decisionWithAttach.toolGrant.maximumWorkspaceEffect === "write";
  // Phase 3: exhaustion sticky — never reopen discovery after bind+recovery.
  const stripAfterEvidenceExhaust =
    shouldStripDiscoveryAfterEvidenceExhaustion({ reasonCodes });
  const rearmLock =
    stripAfterEvidenceExhaust ||
    (isExecutionSeedTrusted(executionSeed) &&
      shouldRearmMutateLockOnContinue({
        wallReason: checkpoint.continueWallReason,
        changedFileCount: changedFiles.length,
        mutationRequired,
        reasonCodes,
      }));
  if (stripAfterEvidenceExhaust) {
    if (!reasonCodes.includes("evidence_recovery_exhausted_terminal")) {
      reasonCodes.push("evidence_recovery_exhausted_terminal");
    }
    warnings.push(
      "Evidence recovery previously exhausted — discovery stays stripped on Continue.",
    );
  }

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
    repoBuildStateBefore: checkpoint.repoBuildStateBefore,
    logVerbosity: startInput.logVerbosity,
    executionSeed,
    armMutateLockOnStart: rearmLock,
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
      executionSeed,
    },
  });
}
