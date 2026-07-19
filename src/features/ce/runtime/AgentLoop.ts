import type { AssistantStreamChunk, LlmProvider, ChatMessage } from '../../../kernel/llm/types';
import type { ReasoningEffort } from '../../../kernel/policy/tierPolicy';
import type { ToolDefinition, ToolCall } from '../../../kernel/llm/toolTypes';
import { toAssistantStreamChunk } from '../../../kernel/llm/streamChunks';
import type { ToolExecutor, ToolExecutionResult } from '../safety/ToolExecutor';
import { formatToolResult } from '../tools/builtinTools';
import { NO_TOOLS_AUDIT_NUDGE, NO_TOOLS_LOG_AUDIT_NUDGE } from './taskKind';
import type { AgentTaskState } from './AgentTaskState';
import { NO_TOOLS_ASK_NUDGE, ASK_SYNTHESIS_NUDGE, isGroundingToolCall } from './askMode';
import { NO_TOOLS_PLAN_NUDGE, PLAN_SYNTHESIS_NUDGE, isPlanGroundingToolCall } from '../modes/plan/planMode';
import { isSkippedToolOutput } from './toolSkip';
import type { PlanPhase, ThunderPlan } from '../plans/PlanActEngine';
import { classifyCommandEffect, isPhaseLockRunCommandError, isPhaseLockWriteError } from '../plans/PlanActEngine';
import { buildPlanTrackerPacket } from '../plans/PlanFileStore';
import { createLogger } from '../../../kernel/telemetry/Logger';
import {
  evaluateNoProgress,
  fingerprintToolCall,
  type ToolAttemptRecord,
} from '../pipeline/loop/noProgressDetector';

const log = createLogger('AgentLoop');

const PHASE_LOCK_ESCALATION = `SYSTEM: File writes are blocked in the current read-only plan phase.
Do NOT retry apply_patch or write_file in this step.
If you finished analysis, summarize findings in plain text and stop — the orchestrator advances to the next step automatically.
If edits are required now, state exactly what must change and which files are affected.`;

const PHASE_LOCK_WRITE_HARD_STOP =
  'Stopped: file writes were blocked by the read-only phase lock and the model retried after being told to stop. Findings gathered so far stand; no files were written. The orchestrator will advance to the next step, which is authorized to write.';

const PHASE_LOCK_RUN_COMMAND_HARD_STOP =
  'Stopped: run_command was blocked by the current plan phase and the model retried after being told to stop. Findings gathered so far stand. The orchestrator will advance to the step where this command is authorized.';

const VALIDATION_BLOCK_MESSAGE =
  'Post-edit validation found errors. Fix all reported issues before marking this step complete or moving on.';

const REPEATED_TOOL_INPUT_FAILURE_PREFIX = 'Stopped after repeated identical tool failure';

const WRITE_TOOL_NAMES = new Set(['apply_patch', 'write_file']);

/**
 * Tool filtering (e.g. filterActModeTools) only controls what's advertised to the model —
 * nothing previously stopped the model from calling an excluded tool name anyway (it would
 * reach ToolExecutor and execute/fail there). This keeps excluded tools truly inert.
 */
function notOfferedToolResult(toolName: string): ToolExecutionResult {
  return {
    success: false,
    output: '',
    error: `Tool "${toolName}" is not available in this mode/phase — do not call it again.`,
  };
}

const NO_WRITE_AGENT_NUDGE = `SYSTEM: The user asked Agent mode to modify the workspace, but no file edit has been made yet.
Do not finish with a summary only. Call apply_patch or write_file now for the required change, then verify.`;

const NO_WRITE_AGENT_STOP =
  'Stopped because the model tried to finish an Agent-mode edit task without calling apply_patch or write_file. No files were changed.';

const WRITE_REQUIRED_CHURN_NUDGE = `SYSTEM: You are stuck in read-only exploration for an Agent-mode edit task.
The required context is already available. In the next assistant step, call apply_patch or write_file.
Do NOT call read_file, read_files, list_files, diagnostics, memory_search, use_skill, or ask_question again before editing.`;

const WRITE_REQUIRED_CHURN_STOP =
  'Stopped because the model kept using read-only tools for an edit task and never called apply_patch or write_file. Try a stronger coding model or reduce the prompt scope.';

function buildRequiredOperationNudge(
  operation: NonNullable<AgentLoopOptions['requiredOperation']>
): string {
  if (operation === 'workspace_write') return NO_WRITE_AGENT_NUDGE;
  return `SYSTEM: The requested ${operation.replace(/_/g, ' ')} has not happened. Call one of the offered tools that performs this operation now. Do not finish with progress-only prose.`;
}

function buildRequiredOperationStop(
  operation: NonNullable<AgentLoopOptions['requiredOperation']>
): string {
  if (operation === 'workspace_write') return NO_WRITE_AGENT_STOP;
  return `Stopped because the model tried to finish without completing the requested ${operation.replace(/_/g, ' ')}.`;
}

function isOperationSideEffectTool(
  operation: NonNullable<AgentLoopOptions['requiredOperation']>,
  toolName: string,
  input?: Record<string, unknown>
): boolean {
  if (operation === 'workspace_write' || operation === 'execute_saved_plan') {
    if (['write_file', 'apply_patch'].includes(toolName)) return true;
    if (toolName !== 'run_command') return false;
    const effect = classifyCommandEffect(typeof input?.command === 'string' ? input.command : '');
    return effect === 'workspace_mutation' || effect === 'dependency_mutation';
  }
  if (operation === 'local_git_write') {
    return /^git_(?:stage|unstage|commit|branch|merge|rebase|tag)/.test(toolName);
  }
  if (operation === 'remote_write') {
    return /^github_(?:create|dispatch)/.test(toolName) || toolName === 'git_push';
  }
  return operation === 'release' && (
    toolName === 'release_plan_controller' ||
    toolName === 'github_create_release' ||
    toolName === 'git_tag_create'
  );
}

export interface PostWriteValidationResult {
  message?: string;
  hasErrors: boolean;
}

export interface AgentLoopCallbacks {
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, success: boolean, output: string, durationMs?: number) => void;
  onStep?: (step: number, maxSteps: number) => void;
  onLlmStepComplete?: (step: number, durationMs: number, toolCallCount: number) => void;
  onResponseCandidate?: (candidate: {
    callId: string;
    step: number;
    characters: number;
    toolCalls: number;
    finishReason?: string;
    accepted: boolean;
    rejectionReason?: string;
  }) => void;
  onAutoContinue?: (step: number) => void;
  onPostWriteValidation?: (relPath: string, output: string) => PostWriteValidationResult | undefined | Promise<PostWriteValidationResult | undefined>;
}

export interface AgentLoopOptions {
  auditMode?: boolean;
  logAuditMode?: boolean;
  maxSteps?: number;
  autoContinue?: boolean;
  maxAutoContinues?: number;
  phaseLock?: PlanPhase;
  restrictRunCommandToReadOnly?: boolean;
  /** Active plan for state-invariant sync — injects locked MASTER PLAN TRACKER header. */
  planTracker?: ThunderPlan;
  /** Ask mode: retry once when the model answers without grounding tools. */
  askMode?: boolean;
  requiresAskGrounding?: boolean;
  /** Plan mode discovery / read-only fallback loop. */
  planMode?: boolean;
  requiresPlanGrounding?: boolean;
  /** Agent mode edit tasks: retry once if the model tries to stop before writing. */
  requiresWrite?: boolean;
  /** Canonical operation whose observable side effect must occur before completion. */
  requiredOperation?: 'workspace_write' | 'local_git_write' | 'remote_write' | 'release' | 'execute_saved_plan';
  reasoningEffort?: ReasoningEffort;
  /** Optional task-state for duplicate-action forced synthesis. */
  getTaskState?: () => AgentTaskState | undefined;
}

export interface AgentLoopSuspendState {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  options: AgentLoopOptions;
  checkpoint?: string;
}

export interface ApprovedToolResult {
  toolCallId: string;
  toolName: string;
  output: string;
  success: boolean;
  input?: Record<string, unknown>;
}

export interface AgentLoopResult {
  fullContent: string;
  messages: ChatMessage[];
  toolCallsMade: number;
  pendingApproval: boolean;
}

interface ExecutedToolCall {
  tc: ToolCall;
  input: Record<string, unknown>;
  execResult: ToolExecutionResult;
  durationMs: number;
}

interface AgentLoopRuntimeState {
  groundingToolCallsMade?: boolean;
  requiredSideEffectMade?: boolean;
  writeToolCallsMade?: boolean;
}

type AgentLoopExecutionSource = 'run' | 'resume';

export class AgentLoop {
  private lastPendingApproval = false;
  private lastSuspendState: AgentLoopSuspendState | undefined;

  constructor(
    private readonly toolExecutor: ToolExecutor,
    private readonly defaultMaxSteps = 15
  ) {}

  hadPendingApproval(): boolean {
    return this.lastPendingApproval;
  }

  getSuspendState(): AgentLoopSuspendState | undefined {
    return this.lastSuspendState;
  }

  clearSuspendState(): void {
    this.lastSuspendState = undefined;
  }

  async *run(
    provider: LlmProvider,
    initialMessages: ChatMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    callbacks?: AgentLoopCallbacks,
    options?: AgentLoopOptions
  ): AsyncIterable<AssistantStreamChunk> {
    this.lastPendingApproval = false;
    this.lastSuspendState = undefined;

    const messages: ChatMessage[] = [...initialMessages];
    // Churn/forced-synthesis state is local to one agent loop. A structured plan
    // invokes a fresh loop per step, so a duplicate read in one step must not disable
    // every tool in all later execute and verify steps.
    options?.getTaskState?.()?.beginAgentLoop();
    this.toolExecutor.clearPlanPhaseLock?.();
    injectFileScopeContract(messages);

    yield* this.executeLoop(provider, messages, tools, signal, callbacks, options, 'run');
  }

  private async *executeLoop(
    provider: LlmProvider,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    callbacks?: AgentLoopCallbacks,
    options?: AgentLoopOptions,
    source: AgentLoopExecutionSource = 'run',
    initialState: AgentLoopRuntimeState = {}
  ): AsyncIterable<AssistantStreamChunk> {
    const allowedToolNames = new Set(tools.map((t) => t.function.name));
    let pendingApproval = false;
    const maxSteps = options?.maxSteps ?? this.defaultMaxSteps;
    const auditMode = options?.auditMode ?? false;
    const logAuditMode = options?.logAuditMode ?? false;
    const autoContinue = options?.autoContinue ?? true;
    const maxAutoContinues = options?.maxAutoContinues ?? 2;
    let auditNudgeUsed = false;
    let logAuditNudgeUsed = false;
    let askNudgeUsed = false;
    let planNudgeUsed = false;
    let groundingToolCallsMade = initialState.groundingToolCallsMade ?? false;
    let autoContinuesUsed = 0;
    let totalSteps = 0;
    let phaseLockWriteFailures = 0;
    let phaseLockRunCommandFailures = 0;
    let phaseLockWriteEscalated = false;
    let lastInputFailureKey = '';
    let repeatedInputFailureCount = 0;
    let writeToolCallsMade = initialState.writeToolCallsMade ?? false;
    let requiredSideEffectMade = initialState.requiredSideEffectMade ?? false;
    let noWriteNudgeUsed = false;
    let noWriteToolRounds = 0;
    let writeChurnNudgeUsed = false;
    let synthesizeOnly = false;
    /** Narrows the offered tools to apply_patch/write_file when no-progress fires on an
     *  edit task that hasn't written yet — the model already has the failure evidence it
     *  needs, so cutting off run_command/read tools (not everything) pushes it to fix the
     *  known issue instead of stopping with a text-only report. Cleared once a write lands. */
    let writeOnlyMode = false;
    const recentToolAttempts: ToolAttemptRecord[] = [];
    const hardLimit = maxSteps + maxAutoContinues * maxSteps;

    const isReadOnlyRoute = Boolean(options?.askMode || options?.planMode || options?.logAuditMode);
    const needsGroundedSynthesis = Boolean(options?.askMode || options?.planMode);
    const requiredOperation = options?.requiredOperation ?? (options?.requiresWrite ? 'workspace_write' : undefined);
    const isGroundingTool = (toolName: string): boolean =>
      options?.planMode ? isPlanGroundingToolCall(toolName) : isGroundingToolCall(toolName);

    for (let step = 0; step < hardLimit; step++) {
      totalSteps = step + 1;
      if (signal?.aborted) break;
      const displayStep = ((step % maxSteps) + 1);
      callbacks?.onStep?.(displayStep, maxSteps);

      injectPlanTracker(messages, options?.planTracker);

      let stepContent = '';
      let finishReason: string | undefined;
      const toolCallsMap = new Map<number, ToolCall>();
      const llmStartedAt = Date.now();

      for await (const delta of provider.complete({
        messages,
        tools: synthesizeOnly ? [] : writeOnlyMode ? tools.filter((t) => WRITE_TOOL_NAMES.has(t.function.name)) : tools,
        toolChoice: synthesizeOnly ? 'none' : 'auto',
        stream: true,
        reasoningEffort: options?.reasoningEffort,
      })) {
        if (signal?.aborted) break;
        if (delta.error) throw new Error(delta.error);
        if (delta.content) {
          stepContent += delta.content;
        }
        // Stream reasoning live; buffer plain content until we know if this step is final.
        if (delta.reasoning) {
          const reasoningChunk = toAssistantStreamChunk(undefined, delta.reasoning, 'progress');
          if (reasoningChunk) yield reasoningChunk;
        }
        if (delta.tool_calls) {
          for (const partial of delta.tool_calls) {
            const existing = toolCallsMap.get(partial.index);
            if (!existing) {
              toolCallsMap.set(partial.index, {
                id: partial.id ?? `call_${partial.index}`,
                type: 'function',
                function: {
                  name: partial.function?.name ?? '',
                  arguments: partial.function?.arguments ?? '',
                },
              });
            } else {
              if (partial.id) existing.id = partial.id;
              if (partial.function?.name) existing.function.name += partial.function.name;
              if (partial.function?.arguments) existing.function.arguments += partial.function.arguments;
            }
          }
        }
        if (delta.finish_reason) finishReason = delta.finish_reason;
        if (delta.done) break;
      }

      const toolCalls = toolCallsMap.size > 0
        ? Array.from(toolCallsMap.entries()).sort(([a], [b]) => a - b).map(([, tc]) => tc)
        : undefined;

      callbacks?.onLlmStepComplete?.(displayStep, Date.now() - llmStartedAt, toolCalls?.length ?? 0);
      const emitCandidate = (accepted: boolean, rejectionReason?: string): void => {
        callbacks?.onResponseCandidate?.({
          callId: `step_${totalSteps}`,
          step: displayStep,
          characters: stepContent.length,
          toolCalls: toolCalls?.length ?? 0,
          finishReason,
          accepted,
          rejectionReason,
        });
      };

      if (!toolCalls || toolCalls.length === 0) {
        if (
          requiredOperation &&
          !isReadOnlyRoute &&
          stepContent &&
          !requiredSideEffectMade &&
          !noWriteNudgeUsed
        ) {
          emitCandidate(false, `${requiredOperation}_required`);
          noWriteNudgeUsed = true;
          messages.push({ role: 'assistant', content: stepContent });
          messages.push({ role: 'user', content: buildRequiredOperationNudge(requiredOperation) });
          continue;
        }
        if (
          requiredOperation &&
          !isReadOnlyRoute &&
          stepContent &&
          !requiredSideEffectMade &&
          noWriteNudgeUsed
        ) {
          emitCandidate(false, `${requiredOperation}_missing_after_retry`);
          const stop = buildRequiredOperationStop(requiredOperation);
          messages.push({ role: 'assistant', content: stop });
          yield stop;
          break;
        }
        if (logAuditMode && stepContent && !logAuditNudgeUsed) {
          emitCandidate(false, 'log_analysis_tool_required');
          logAuditNudgeUsed = true;
          messages.push({ role: 'assistant', content: stepContent });
          messages.push({ role: 'user', content: NO_TOOLS_LOG_AUDIT_NUDGE });
          continue;
        }
        if (auditMode && stepContent && !auditNudgeUsed) {
          emitCandidate(false, 'audit_grounding_tool_required');
          auditNudgeUsed = true;
          messages.push({ role: 'assistant', content: stepContent });
          messages.push({ role: 'user', content: NO_TOOLS_AUDIT_NUDGE });
          continue;
        }
        if (
          options?.askMode &&
          options?.requiresAskGrounding &&
          stepContent &&
          !askNudgeUsed &&
          !groundingToolCallsMade
        ) {
          emitCandidate(false, 'ask_grounding_required');
          askNudgeUsed = true;
          messages.push({ role: 'assistant', content: stepContent });
          messages.push({ role: 'user', content: NO_TOOLS_ASK_NUDGE });
          continue;
        }
        if (
          options?.planMode &&
          options?.requiresPlanGrounding &&
          stepContent &&
          !planNudgeUsed &&
          !groundingToolCallsMade
        ) {
          emitCandidate(false, 'plan_grounding_required');
          planNudgeUsed = true;
          messages.push({ role: 'assistant', content: stepContent });
          messages.push({ role: 'user', content: NO_TOOLS_PLAN_NUDGE });
          continue;
        }
        if (stepContent) {
          emitCandidate(true);
          messages.push({ role: 'assistant', content: stepContent });
          const finalChunk = toAssistantStreamChunk(stepContent, undefined, 'final');
          if (finalChunk) yield finalChunk;
        } else emitCandidate(false, 'empty_response');
        break;
      }

      emitCandidate(true);
      // Intermediate narration → progress only (not persisted as the final answer).
      if (stepContent) {
        const progressChunk = toAssistantStreamChunk(stepContent, undefined, 'progress');
        if (progressChunk) yield progressChunk;
      }

      messages.push({
        role: 'assistant',
        content: stepContent,
        tool_calls: toolCalls,
      });

      const executions = await this.executeToolCalls(
        toolCalls,
        allowedToolNames,
        options,
        auditMode || options?.restrictRunCommandToReadOnly,
        signal,
        callbacks
      );

      let phaseLockFailuresThisTurn = 0;
      let phaseLockRunCommandFailuresThisTurn = 0;
      let postWriteValidationFailed = false;
      let repeatedInputFailureStop: string | undefined;
      let nonWriteOnlyTurn = true;

      for (const { tc, input, execResult, durationMs } of executions) {
        if (signal?.aborted) break;

        if (execResult.pendingApproval) {
          pendingApproval = true;
          callbacks?.onToolEnd?.(tc.function.name, false, 'Awaiting approval', durationMs);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: `Tool ${tc.function.name} is awaiting user approval. Stop and wait for the user to approve.`,
          });
          continue;
        }

        const { isSkipped, output, success: toolSuccess } = resolveToolOutput(execResult);
        const completedRealSideEffect = execResult.success && !isSkipped && !execResult.pendingApproval;

        if (['write_file', 'apply_patch'].includes(tc.function.name)) {
          nonWriteOnlyTurn = false;
          if (completedRealSideEffect) {
            writeToolCallsMade = true;
            writeOnlyMode = false;
          }
        }
        if (
          completedRealSideEffect &&
          requiredOperation &&
          isOperationSideEffectTool(requiredOperation, tc.function.name, input)
        ) {
          requiredSideEffectMade = true;
          if (requiredOperation === 'workspace_write' || requiredOperation === 'execute_saved_plan') {
            writeToolCallsMade = true;
            writeOnlyMode = false;
            nonWriteOnlyTurn = false;
          }
        }

        if (completedRealSideEffect && isGroundingTool(tc.function.name)) {
          groundingToolCallsMade = true;
        }

        recentToolAttempts.push({
          toolName: tc.function.name,
          fingerprint: fingerprintToolCall(
            tc.function.name,
            input,
            execResult.success && !isSkipped ? undefined : output
          ),
          success: execResult.success && !isSkipped,
          error: execResult.success && !isSkipped ? undefined : output,
        });
        if (recentToolAttempts.length > 12) recentToolAttempts.splice(0, recentToolAttempts.length - 12);

        if (
          !execResult.success &&
          !isSkipped &&
          ['write_file', 'apply_patch'].includes(tc.function.name) &&
          isPhaseLockWriteError(execResult.error)
        ) {
          phaseLockFailuresThisTurn += 1;
        }
        if (
          !execResult.success &&
          !isSkipped &&
          tc.function.name === 'run_command' &&
          isPhaseLockRunCommandError(execResult.error)
        ) {
          phaseLockRunCommandFailuresThisTurn += 1;
        }

        callbacks?.onToolEnd?.(
          tc.function.name,
          toolSuccess,
          isSkipped ? output : output.slice(0, 500),
          durationMs
        );

        let toolContent = formatToolResult(tc.function.name, {
          success: toolSuccess,
          output: isSkipped ? output : execResult.output,
          error: isSkipped ? undefined : execResult.error,
        });

        if (
          execResult.success &&
          !isSkipped &&
          callbacks?.onPostWriteValidation &&
          ['write_file', 'apply_patch'].includes(tc.function.name)
        ) {
          const relPath = typeof input.path === 'string' ? input.path : '';
          if (relPath) {
            const validation = await callbacks.onPostWriteValidation(relPath, execResult.output);
            if (validation?.message) {
              toolContent += `\n\n${validation.message}`;
            }
            if (validation?.hasErrors) {
              postWriteValidationFailed = true;
            }
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: toolContent,
        });

        const inputFailureKey =
          !execResult.success && !isSkipped
            ? repeatedToolFailureKey(tc.function.name, input, output)
            : undefined;
        if (inputFailureKey) {
          if (inputFailureKey === lastInputFailureKey) {
            repeatedInputFailureCount += 1;
          } else {
            lastInputFailureKey = inputFailureKey;
            repeatedInputFailureCount = 1;
          }
          const phaseLockFailure =
            isPhaseLockWriteError(execResult.error) ||
            isPhaseLockRunCommandError(execResult.error);
          if (repeatedInputFailureCount >= 2 && !phaseLockFailure) {
            repeatedInputFailureStop = buildRepeatedToolInputFailureMessage(
              tc.function.name,
              output,
              repeatedInputFailureCount
            );
          }
        } else {
          lastInputFailureKey = '';
          repeatedInputFailureCount = 0;
        }
      }

      if (postWriteValidationFailed) {
        messages.push({ role: 'user', content: VALIDATION_BLOCK_MESSAGE });
      }

      // Both churn-detectors below can fire on the same evidence: repeated failed reads/verifications
      // for an edit task that already has enough information to act on. When that's the case, narrow
      // to write tools instead of ending the turn empty-handed — the model still has real work to do.
      const canFixInstead = Boolean(options?.requiresWrite) && !isReadOnlyRoute && !writeToolCallsMade;

      const noProgress = evaluateNoProgress(recentToolAttempts);
      if (noProgress.stuck) {
        if (canFixInstead) {
          writeOnlyMode = true;
          messages.push({
            role: 'user',
            content:
              `NO_PROGRESS_STOP: ${noProgress.reason ?? 'Repeated tool activity is not advancing the task.'} ` +
              'run_command and other exploration tools are disabled for this loop. The failures above already show the exact issue(s) — call apply_patch or write_file now to fix them. Do not call any other tool.',
          });
        } else {
          synthesizeOnly = true;
          messages.push({
            role: 'user',
            content:
              `NO_PROGRESS_STOP: ${noProgress.reason ?? 'Repeated tool activity is not advancing the task.'} ` +
              'Tools are disabled for this loop. Summarize the exact blocker or completed evidence now; the plan executor may retry the step with fresh state.',
          });
        }
      }

      if (options?.getTaskState?.()?.shouldForceSynthesis()) {
        synthesizeOnly = true;
        messages.push({
          role: 'user',
          content:
            'FORCE_SYNTHESIS: Duplicate or sufficient tool evidence is already cached. ' +
            'Do not call any more tools. Write the final analysis now from the cached results above.',
        });
      }

      // After deterministic log analysis reports hasEnoughEvidence, force synthesis-only mode.
      if (logAuditMode) {
        const lastTool = messages[messages.length - 1];
        if (
          lastTool?.role === 'tool' &&
          typeof lastTool.content === 'string' &&
          (
            lastTool.content.includes('[evidenceSufficientForSummary=true]') ||
            lastTool.content.includes('[hasEnoughEvidence=true]')
          )
        ) {
          options?.getTaskState?.()?.markForceSynthesis();
          synthesizeOnly = true;
          messages.push({
            role: 'user',
            content:
              'Log analysis returned sufficient evidence for a summary. Tools are now disabled for this route. Write the final analysis now.',
          });
        }
      }

      let phaseLockHardStop: string | undefined;

      if (phaseLockFailuresThisTurn > 0) {
        if (phaseLockWriteEscalated) {
          phaseLockHardStop = PHASE_LOCK_WRITE_HARD_STOP;
        } else {
          phaseLockWriteFailures += phaseLockFailuresThisTurn;
          if (phaseLockWriteFailures >= 2) {
            messages.push({ role: 'user', content: PHASE_LOCK_ESCALATION });
            phaseLockWriteFailures = 0;
            phaseLockWriteEscalated = true;
          }
        }
      }
      if (phaseLockRunCommandFailuresThisTurn > 0) {
        phaseLockRunCommandFailures += phaseLockRunCommandFailuresThisTurn;
        if (phaseLockRunCommandFailures >= 2) {
          phaseLockHardStop = phaseLockHardStop ?? PHASE_LOCK_RUN_COMMAND_HARD_STOP;
        }
      }

      if (phaseLockHardStop) {
        messages.push({ role: 'assistant', content: phaseLockHardStop });
        yield phaseLockHardStop;
        break;
      }

      if (repeatedInputFailureStop) {
        if (isReadOnlyRoute) {
          synthesizeOnly = true;
          messages.push({
            role: 'user',
            content:
              `${repeatedInputFailureStop}\n\n` +
              'Tools are now disabled. Answer the original request using the successful evidence already gathered, and briefly identify any online verification that could not be completed.',
          });
          continue;
        }
        if (canFixInstead) {
          writeOnlyMode = true;
          messages.push({
            role: 'user',
            content:
              `${repeatedInputFailureStop}\n\n` +
              'run_command and other exploration tools are disabled for this loop. The failures above already show the exact issue(s) — call apply_patch or write_file now to fix them. Do not call any other tool.',
          });
          continue;
        }
        messages.push({ role: 'assistant', content: repeatedInputFailureStop });
        yield repeatedInputFailureStop;
        break;
      }

      if (
        options?.requiresWrite &&
        !isReadOnlyRoute &&
        !pendingApproval &&
        !writeToolCallsMade &&
        nonWriteOnlyTurn
      ) {
        noWriteToolRounds += 1;
        if (noWriteToolRounds >= 4) {
          messages.push({ role: 'assistant', content: WRITE_REQUIRED_CHURN_STOP });
          yield WRITE_REQUIRED_CHURN_STOP;
          break;
        }
        if (noWriteToolRounds >= 2 && !writeChurnNudgeUsed) {
          writeChurnNudgeUsed = true;
          messages.push({ role: 'user', content: WRITE_REQUIRED_CHURN_NUDGE });
        }
      }

      if (pendingApproval) {
        const checkpoint = await createApprovalCheckpoint(provider, messages, options?.phaseLock, signal);
        this.lastSuspendState = {
          messages: [...messages],
          tools,
          options: {
            ...options,
            auditMode,
            logAuditMode,
            maxSteps,
            autoContinue,
            maxAutoContinues,
            phaseLock: options?.phaseLock,
            restrictRunCommandToReadOnly: auditMode || options?.restrictRunCommandToReadOnly,
          },
          checkpoint,
        };
        break;
      }

      if (
        autoContinue &&
        autoContinuesUsed < maxAutoContinues &&
        step > 0 &&
        (step + 1) % maxSteps === 0 &&
        !pendingApproval
      ) {
        autoContinuesUsed += 1;
        callbacks?.onAutoContinue?.(autoContinuesUsed);
        messages.push({
          role: 'user',
          content: 'Continue the task from where you left off. Use tools as needed until complete.',
        });
        log.info(source === 'resume' ? 'Auto-continuing agent loop after resume' : 'Auto-continuing agent loop', {
          continueRound: autoContinuesUsed,
        });
      }
    }

    if (
      needsGroundedSynthesis &&
      groundingToolCallsMade &&
      !pendingApproval &&
      !signal?.aborted &&
      needsReadOnlySynthesis(messages)
    ) {
      const synthesisNudge = options?.planMode ? PLAN_SYNTHESIS_NUDGE : ASK_SYNTHESIS_NUDGE;
      messages.push({ role: 'user', content: synthesisNudge });
      callbacks?.onStep?.(1, 1);

      for await (const delta of provider.complete({
        messages,
        tools: [],
        toolChoice: 'none',
        stream: true,
        reasoningEffort: options?.reasoningEffort,
      })) {
        if (signal?.aborted) break;
        if (delta.error) throw new Error(delta.error);
        const chunk = toAssistantStreamChunk(delta.content, delta.reasoning);
        if (chunk) yield chunk;
        if (delta.done) break;
      }
    }

    this.lastPendingApproval = pendingApproval;
    log.info(source === 'resume' ? 'Agent loop resume finished' : 'Agent loop finished', { pendingApproval, totalSteps });
  }

  async *resume(
    provider: LlmProvider,
    state: AgentLoopSuspendState,
    approved: ApprovedToolResult[],
    signal?: AbortSignal,
    callbacks?: AgentLoopCallbacks
  ): AsyncIterable<AssistantStreamChunk> {
    const messages: ChatMessage[] = state.messages.map((m) => ({ ...m }));
    const tools = state.tools;
    const options = state.options;
    this.lastPendingApproval = false;
    this.lastSuspendState = undefined;

    if (state.checkpoint) {
      injectWakeUpCheckpoint(messages, state.checkpoint);
    }

    let resumeValidationFailed = false;
    const requiredOperation = options.requiredOperation ?? (options.requiresWrite ? 'workspace_write' : undefined);
    const isGroundingTool = (toolName: string): boolean =>
      options.planMode ? isPlanGroundingToolCall(toolName) : isGroundingToolCall(toolName);
    const initialState: AgentLoopRuntimeState = {
      groundingToolCallsMade: false,
      requiredSideEffectMade: false,
      writeToolCallsMade: false,
    };

    for (const result of approved) {
      const idx = messages.findIndex(
        (m) => m.role === 'tool' && m.tool_call_id === result.toolCallId
      );
      if (idx < 0) continue;

      callbacks?.onToolEnd?.(
        result.toolName,
        result.success,
        result.success ? result.output.slice(0, 500) : (result.output || 'Denied')
      );

      let toolContent = result.success
        ? formatToolResult(result.toolName, {
            success: true,
            output: result.output,
          })
        : `User denied ${result.toolName}. Do not retry the same command; choose another approach.`;

      if (result.success) {
        if (['write_file', 'apply_patch'].includes(result.toolName)) {
          initialState.writeToolCallsMade = true;
        }
        if (requiredOperation && isOperationSideEffectTool(requiredOperation, result.toolName, result.input)) {
          initialState.requiredSideEffectMade = true;
        }
        if (isGroundingTool(result.toolName)) {
          initialState.groundingToolCallsMade = true;
        }
      }

      if (
        result.success &&
        callbacks?.onPostWriteValidation &&
        ['write_file', 'apply_patch'].includes(result.toolName) &&
        result.input
      ) {
        const relPath = typeof result.input.path === 'string' ? result.input.path : '';
        if (relPath) {
          const validation = await callbacks.onPostWriteValidation(relPath, result.output);
          if (validation?.message) {
            toolContent += `\n\n${validation.message}`;
          }
          if (validation?.hasErrors) {
            resumeValidationFailed = true;
          }
        }
      }

      messages[idx] = {
        ...messages[idx],
        content: toolContent,
      };
    }

    if (resumeValidationFailed) {
      messages.push({ role: 'user', content: VALIDATION_BLOCK_MESSAGE });
    }

    yield* this.executeLoop(provider, messages, tools, signal, callbacks, options, 'resume', initialState);
  }

  private async executeToolCalls(
    toolCalls: ToolCall[],
    allowedToolNames: Set<string>,
    options: AgentLoopOptions | undefined,
    restrictRunCommandToReadOnly: boolean | undefined,
    signal?: AbortSignal,
    callbacks?: AgentLoopCallbacks
  ): Promise<ExecutedToolCall[]> {
    const executions: ExecutedToolCall[] = [];

    for (const tc of toolCalls) {
      if (signal?.aborted) break;

      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        input = {};
      }

      callbacks?.onToolStart?.(tc.function.name, input);
      const toolStartedAt = Date.now();
      const execResult = allowedToolNames.has(tc.function.name)
        ? await this.toolExecutor.execute(tc.function.name, input, {
            toolCallId: tc.id,
            phaseLock: options?.phaseLock,
            restrictRunCommandToReadOnly,
            allowedToolNames,
          })
        : notOfferedToolResult(tc.function.name);

      executions.push({ tc, input, execResult, durationMs: Date.now() - toolStartedAt });

      if (execResult.pendingApproval) {
        break;
      }
    }

    return executions;
  }

  async runToCompletion(
    provider: LlmProvider,
    initialMessages: ChatMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    callbacks?: AgentLoopCallbacks,
    streamContent = false,
    options?: AgentLoopOptions
  ): Promise<AgentLoopResult> {
    const messages: ChatMessage[] = [...initialMessages];
    const allowedToolNames = new Set(tools.map((t) => t.function.name));
    let fullContent = '';
    let toolCallsMade = 0;
    let pendingApproval = false;
    const maxSteps = options?.maxSteps ?? this.defaultMaxSteps;
    let phaseLockRunCommandFailures = 0;

    for (let step = 0; step < maxSteps; step++) {
      if (signal?.aborted) break;
      callbacks?.onStep?.(step + 1, maxSteps);

      const collected = await collectCompletion(provider, messages, tools, signal, streamContent && step === 0, options?.reasoningEffort);

      if (collected.content) {
        fullContent += collected.content;
      }

      if (!collected.toolCalls || collected.toolCalls.length === 0) {
        if (collected.content) {
          messages.push({ role: 'assistant', content: collected.content });
        }
        break;
      }

      messages.push({
        role: 'assistant',
        content: collected.content ?? '',
        tool_calls: collected.toolCalls,
      });

      const executions = await this.executeToolCalls(
        collected.toolCalls,
        allowedToolNames,
        options,
        options?.restrictRunCommandToReadOnly,
        signal,
        callbacks
      );
      toolCallsMade += executions.length;

      let phaseLockRunCommandFailuresThisTurn = 0;

      for (const { tc, execResult, durationMs } of executions) {
        if (signal?.aborted) break;

        if (execResult.pendingApproval) {
          pendingApproval = true;
          callbacks?.onToolEnd?.(tc.function.name, false, 'Awaiting approval', durationMs);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: `Tool ${tc.function.name} is awaiting user approval. Stop and wait for the user to approve.`,
          });
          continue;
        }

        const { isSkipped, output, success: toolSuccess } = resolveToolOutput(execResult);

        if (
          !execResult.success &&
          !isSkipped &&
          tc.function.name === 'run_command' &&
          isPhaseLockRunCommandError(execResult.error)
        ) {
          phaseLockRunCommandFailuresThisTurn += 1;
        }

        callbacks?.onToolEnd?.(
          tc.function.name,
          toolSuccess,
          isSkipped ? output : output.slice(0, 500),
          durationMs
        );
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: formatToolResult(tc.function.name, {
            success: toolSuccess,
            output: isSkipped ? output : execResult.output,
            error: isSkipped ? undefined : execResult.error,
          }),
        });
      }

      if (phaseLockRunCommandFailuresThisTurn > 0) {
        phaseLockRunCommandFailures += phaseLockRunCommandFailuresThisTurn;
        if (phaseLockRunCommandFailures >= 2) {
          messages.push({ role: 'assistant', content: PHASE_LOCK_RUN_COMMAND_HARD_STOP });
          fullContent += PHASE_LOCK_RUN_COMMAND_HARD_STOP;
          break;
        }
      }

      if (pendingApproval) {
        const checkpoint = await createApprovalCheckpoint(provider, messages, options?.phaseLock, signal);
        this.lastSuspendState = {
          messages: [...messages],
          tools,
          options: options ?? {},
          checkpoint,
        };
        break;
      }
    }

    log.info('Agent loop finished', { toolCallsMade, pendingApproval });
    return { fullContent, messages, toolCallsMade, pendingApproval };
  }
}

async function createApprovalCheckpoint(
  provider: LlmProvider,
  messages: ChatMessage[],
  phaseLock?: PlanPhase,
  signal?: AbortSignal
): Promise<string | undefined> {
  if (signal?.aborted) return undefined;

  const compactMessages = messages
    .slice(-12)
    .map((m) => {
      const tool = m.role === 'tool' ? ` (${m.name ?? 'tool'})` : '';
      return `${m.role}${tool}: ${m.content.slice(0, 2000)}`;
    })
    .join('\n\n');

  const checkpointMessages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Summarize coding-agent progress for resuming after a user approval pause. Output only a compact checkpoint with: current phase, completed facts/tool results, pending approval action, and exact next step. Max 180 words.',
    },
    {
      role: 'user',
      content: `Current phase lock: ${phaseLock ?? 'none'}\n\nRecent state:\n${compactMessages}`,
    },
  ];

  let response = '';
  try {
    for await (const delta of provider.complete({
      messages: checkpointMessages,
      stream: false,
      toolChoice: 'none',
    })) {
      if (signal?.aborted) return undefined;
      if (delta.error) throw new Error(delta.error);
      if (delta.content) response += delta.content;
      if (delta.done) break;
    }
  } catch (error) {
    log.warn('Approval checkpoint generation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  return response.trim().slice(0, 1200) || undefined;
}

function injectPlanTracker(messages: ChatMessage[], plan?: ThunderPlan): void {
  if (!plan) return;

  const trackerContent = buildPlanTrackerPacket(plan);
  const marker = '[MASTER PLAN TRACKER';
  const existingIdx = messages.findIndex(
    (m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes(marker)
  );

  if (existingIdx >= 0) {
    messages[existingIdx] = { role: 'system', content: trackerContent };
  } else {
    const systemIdx = messages.findIndex((m) => m.role === 'system');
    if (systemIdx >= 0) {
      messages.splice(systemIdx + 1, 0, { role: 'system', content: trackerContent });
    } else {
      messages.unshift({ role: 'system', content: trackerContent });
    }
  }
}

function injectFileScopeContract(messages: ChatMessage[]): void {
  const marker = '[FILE_SCOPE_CONTRACT]';
  if (messages.some((m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes(marker))) {
    return;
  }
  const contract: ChatMessage = {
    role: 'system',
    content: [
      marker,
      'Before reading or editing workspace files, call propose_file_scope with the objective and candidate paths.',
      'Only call read_file/read_files/write_file/apply_patch for paths accepted by propose_file_scope.',
      'Use read_file startLine/endLine slices for large files or targeted symbols, and stay within the returned maxFilesRead budget.',
    ].join('\n'),
  };

  const systemIndex = messages.findIndex((m) => m.role === 'system');
  if (systemIndex >= 0) {
    messages.splice(systemIndex + 1, 0, contract);
  } else {
    messages.unshift(contract);
  }
}

function injectWakeUpCheckpoint(messages: ChatMessage[], checkpoint: string): void {
  const wakeUp: ChatMessage = {
    role: 'system',
    content:
      `APPROVAL WAKE-UP CHECKPOINT:\n${checkpoint}\n\nResume from this checkpoint. Trust it over stale instinct, do not repeat completed discovery, and continue with the approved action/result.`,
  };

  const systemIndex = messages.findIndex((m) => m.role === 'system');
  if (systemIndex >= 0) {
    messages.splice(systemIndex + 1, 0, wakeUp);
  } else {
    messages.unshift(wakeUp);
  }
}

interface CollectedCompletion {
  content: string;
  toolCalls?: ToolCall[];
}

async function collectCompletion(
  provider: LlmProvider,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
  stream = true,
  reasoningEffort?: ReasoningEffort
): Promise<CollectedCompletion> {
  let content = '';
  const toolCallsMap = new Map<number, ToolCall>();

  for await (const delta of provider.complete({
    messages,
    tools,
    toolChoice: 'auto',
    stream,
    reasoningEffort,
  })) {
    if (signal?.aborted) break;
    if (delta.error) throw new Error(delta.error);

    if (delta.content) {
      content += delta.content;
    }

    if (delta.tool_calls) {
      for (const partial of delta.tool_calls) {
        const existing = toolCallsMap.get(partial.index);
        if (!existing) {
          toolCallsMap.set(partial.index, {
            id: partial.id ?? `call_${partial.index}`,
            type: 'function',
            function: {
              name: partial.function?.name ?? '',
              arguments: partial.function?.arguments ?? '',
            },
          });
        } else {
          if (partial.id) existing.id = partial.id;
          if (partial.function?.name) existing.function.name += partial.function.name;
          if (partial.function?.arguments) existing.function.arguments += partial.function.arguments;
        }
      }
    }

    if (delta.done) break;
  }

  const toolCalls = toolCallsMap.size > 0
    ? Array.from(toolCallsMap.entries()).sort(([a], [b]) => a - b).map(([, tc]) => tc)
    : undefined;

  return { content, toolCalls };
}

/** True when the loop ended after tool exploration without a substantive final answer. */
export function needsReadOnlySynthesis(messages: ChatMessage[]): boolean {
  const assistants = messages.filter((m) => m.role === 'assistant');
  const lastAssistant = assistants[assistants.length - 1];
  if (!lastAssistant) return true;
  if (lastAssistant.tool_calls && lastAssistant.tool_calls.length > 0) return true;

  const content = (lastAssistant.content ?? '').trim();
  if (!content) return true;
  if (content.length < 160 && /\b(let me|i will|i'll|fetching|checking|searching|reading)\b/i.test(content)) {
    return true;
  }
  return false;
}

function resolveToolOutput(execResult: import('../safety/ToolExecutor').ToolExecutionResult): {
  isSkipped: boolean;
  output: string;
  success: boolean;
} {
  const isSkipped = Boolean(execResult.skipped) ||
    isSkippedToolOutput(execResult.output) ||
    isSkippedToolOutput(execResult.error);
  const output = execResult.success
    ? execResult.output
    : isSkipped
      ? (execResult.output || execResult.error || 'Skipped redundant tool call')
      : (execResult.error ?? 'Tool failed');
  return {
    isSkipped,
    output,
    success: execResult.success || isSkipped,
  };
}

/**
 * Keys a failed tool call by tool name + normalized error text so identical failures can be
 * counted across steps. Phase-lock failures ARE included after the first instructional nudge
 * so the model cannot loop forever on write_file / run_command / mark_step_complete.
 */
function repeatedToolFailureKey(
  toolName: string,
  input: Record<string, unknown>,
  output: string
): string | undefined {
  if (!output) return undefined;
  return fingerprintToolCall(toolName, input, normalizeToolFailure(output));
}

function normalizeToolFailure(output: string): string {
  return output.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function buildRepeatedToolInputFailureMessage(toolName: string, output: string, count: number): string {
  const detail = normalizeToolFailure(output).slice(0, 320);
  let recovery =
    'I will not keep retrying the same failing tool call. The next attempt should use a different tool, different arguments, or explain the blocker instead.';
  if (/Path is ignored/i.test(detail)) {
    recovery =
      'For log analysis, call `analyze_log_directory` for `.mitii/logs/` or `analyze_jsonl` for a specific `.mitii/logs/*.jsonl`; common `.mitii` typos such as `.miti/logs` and `.mtii/logs` are canonicalized. Do not fall back to raw file reads or keep retrying ignored non-log paths.';
  } else if (/Shell blocked|Mutating shell commands in Ask\/Plan\/Review require your approval/i.test(detail)) {
    recovery =
      'Ask/Plan allow read-only shell without approval. For installs/edits, call the mutating tool again so the user can approve — or use `execute_workspace_script` / read-only `grep`/`ls`/`cat`.';
  } else if (/not available in this mode|Writes blocked|Patch apply blocked|MCP filesystem writes|require your approval|file writes are locked|Phase 4 \(Verify\)/i.test(detail)) {
    recovery =
      'This tool is blocked for the current mode/phase. Do not retry it. Synthesize from evidence already gathered, or wait for the orchestrator to advance the plan phase.';
  } else if (/release_plan_controller/i.test(toolName)) {
    recovery =
      'release_plan_controller is for git/release workflows only — not for marking documentation plan steps complete. Continue without it.';
  }
  return [
    `\n\n### ${REPEATED_TOOL_INPUT_FAILURE_PREFIX}`,
    '',
    `The agent stopped after ${count} consecutive \`${toolName}\` calls that failed with the same error: ${detail}`,
    '',
    recovery,
  ].join('\n');
}
