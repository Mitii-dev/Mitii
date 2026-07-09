import type { AssistantStreamChunk, LlmProvider, ChatMessage } from '../llm/types';
import type { ToolDefinition, ToolCall } from '../llm/toolTypes';
import { toAssistantStreamChunk } from '../llm/streamChunks';
import type { ToolExecutor, ToolExecutionResult } from '../safety/ToolExecutor';
import { formatToolResult } from '../tools/builtinTools';
import { NO_TOOLS_AUDIT_NUDGE } from './taskKind';
import { NO_TOOLS_ASK_NUDGE, ASK_SYNTHESIS_NUDGE, isGroundingToolCall } from './askMode';
import { NO_TOOLS_PLAN_NUDGE, PLAN_SYNTHESIS_NUDGE, isPlanGroundingToolCall } from '../modes/plan/planMode';
import { isSkippedToolOutput } from './toolSkip';
import type { PlanPhase, ThunderPlan } from '../plans/PlanActEngine';
import { isPhaseLockRunCommandError, isPhaseLockWriteError } from '../plans/PlanActEngine';
import { buildPlanTrackerPacket } from '../plans/PlanFileStore';
import { createLogger } from '../telemetry/Logger';

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

export interface PostWriteValidationResult {
  message?: string;
  hasErrors: boolean;
}

export interface AgentLoopCallbacks {
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, success: boolean, output: string, durationMs?: number) => void;
  onStep?: (step: number, maxSteps: number) => void;
  onLlmStepComplete?: (step: number, durationMs: number, toolCallCount: number) => void;
  onAutoContinue?: (step: number) => void;
  onPostWriteValidation?: (relPath: string, output: string) => PostWriteValidationResult | undefined | Promise<PostWriteValidationResult | undefined>;
}

export interface AgentLoopOptions {
  auditMode?: boolean;
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
    const messages: ChatMessage[] = [...initialMessages];
    const allowedToolNames = new Set(tools.map((t) => t.function.name));
    let pendingApproval = false;
    this.lastPendingApproval = false;
    this.lastSuspendState = undefined;
    const maxSteps = options?.maxSteps ?? this.defaultMaxSteps;
    const auditMode = options?.auditMode ?? false;
    const autoContinue = options?.autoContinue ?? true;
    const maxAutoContinues = options?.maxAutoContinues ?? 2;
    let auditNudgeUsed = false;
    let askNudgeUsed = false;
    let planNudgeUsed = false;
    let groundingToolCallsMade = false;
    let autoContinuesUsed = 0;
    let totalSteps = 0;
    let phaseLockWriteFailures = 0;
    let phaseLockRunCommandFailures = 0;
    let phaseLockWriteEscalated = false;
    let lastInputFailureKey = '';
    let repeatedInputFailureCount = 0;
    let writeToolCallsMade = false;
    let noWriteNudgeUsed = false;
    let noWriteToolRounds = 0;
    let writeChurnNudgeUsed = false;
    const hardLimit = maxSteps + maxAutoContinues * maxSteps;

    const readOnlyMode = Boolean(options?.askMode || options?.planMode);
    const isGroundingTool = (toolName: string): boolean =>
      options?.planMode ? isPlanGroundingToolCall(toolName) : isGroundingToolCall(toolName);

    this.toolExecutor.clearPlanPhaseLock?.();

    for (let step = 0; step < hardLimit; step++) {
      totalSteps = step + 1;
      if (signal?.aborted) break;
      const displayStep = ((step % maxSteps) + 1);
      callbacks?.onStep?.(displayStep, maxSteps);

      injectPlanTracker(messages, options?.planTracker);

      let stepContent = '';
      const toolCallsMap = new Map<number, ToolCall>();
      const llmStartedAt = Date.now();

      for await (const delta of provider.complete({
        messages,
        tools,
        toolChoice: 'auto',
        stream: true,
      })) {
        if (signal?.aborted) break;
        if (delta.error) throw new Error(delta.error);
        if (delta.content) {
          stepContent += delta.content;
        }
        const chunk = toAssistantStreamChunk(delta.content, delta.reasoning);
        if (chunk) yield chunk;
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

      callbacks?.onLlmStepComplete?.(displayStep, Date.now() - llmStartedAt, toolCalls?.length ?? 0);

      if (!toolCalls || toolCalls.length === 0) {
        if (
          options?.requiresWrite &&
          !readOnlyMode &&
          !auditMode &&
          stepContent &&
          !writeToolCallsMade &&
          !noWriteNudgeUsed
        ) {
          noWriteNudgeUsed = true;
          messages.push({ role: 'assistant', content: stepContent });
          messages.push({ role: 'user', content: NO_WRITE_AGENT_NUDGE });
          continue;
        }
        if (
          options?.requiresWrite &&
          !readOnlyMode &&
          !auditMode &&
          stepContent &&
          !writeToolCallsMade &&
          noWriteNudgeUsed
        ) {
          messages.push({ role: 'assistant', content: NO_WRITE_AGENT_STOP });
          yield NO_WRITE_AGENT_STOP;
          break;
        }
        if (auditMode && stepContent && !auditNudgeUsed) {
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
          planNudgeUsed = true;
          messages.push({ role: 'assistant', content: stepContent });
          messages.push({ role: 'user', content: NO_TOOLS_PLAN_NUDGE });
          continue;
        }
        if (stepContent) {
          messages.push({ role: 'assistant', content: stepContent });
        }
        break;
      }

      messages.push({
        role: 'assistant',
        content: stepContent,
        tool_calls: toolCalls,
      });

      const executions = await Promise.all(
        toolCalls.map(async (tc) => {
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
                restrictRunCommandToReadOnly: auditMode || options?.restrictRunCommandToReadOnly,
              })
            : notOfferedToolResult(tc.function.name);
          return { tc, input, execResult, durationMs: Date.now() - toolStartedAt };
        })
      );

      let phaseLockFailuresThisTurn = 0;
      let phaseLockRunCommandFailuresThisTurn = 0;
      let postWriteValidationFailed = false;
      let repeatedInputFailureStop: string | undefined;
      let nonWriteOnlyTurn = true;

      for (const { tc, input, execResult, durationMs } of executions) {
        if (signal?.aborted) break;

        if (['write_file', 'apply_patch'].includes(tc.function.name)) {
          nonWriteOnlyTurn = false;
          if (execResult.success || execResult.pendingApproval) {
            writeToolCallsMade = true;
          }
        }

        if (execResult.success && isGroundingTool(tc.function.name)) {
          groundingToolCallsMade = true;
        }

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
          !execResult.success && !isSkipped ? repeatedToolFailureKey(tc.function.name, output) : undefined;
        if (inputFailureKey) {
          if (inputFailureKey === lastInputFailureKey) {
            repeatedInputFailureCount += 1;
          } else {
            lastInputFailureKey = inputFailureKey;
            repeatedInputFailureCount = 1;
          }
          if (repeatedInputFailureCount >= 2) {
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
        messages.push({ role: 'assistant', content: repeatedInputFailureStop });
        yield repeatedInputFailureStop;
        break;
      }

      if (
        options?.requiresWrite &&
        !readOnlyMode &&
        !auditMode &&
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
            auditMode,
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
        log.info('Auto-continuing agent loop', { continueRound: autoContinuesUsed });
      }
    }

    if (
      readOnlyMode &&
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
      })) {
        if (signal?.aborted) break;
        if (delta.error) throw new Error(delta.error);
        const chunk = toAssistantStreamChunk(delta.content, delta.reasoning);
        if (chunk) yield chunk;
        if (delta.done) break;
      }
    }

    this.lastPendingApproval = pendingApproval;
    log.info('Agent loop finished', { pendingApproval, totalSteps });
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
    const allowedToolNames = new Set(tools.map((t) => t.function.name));
    const options = state.options;
    let pendingApproval = false;
    this.lastPendingApproval = false;
    this.lastSuspendState = undefined;

    if (state.checkpoint) {
      injectWakeUpCheckpoint(messages, state.checkpoint);
    }

    let resumeValidationFailed = false;
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

    const maxSteps = options.maxSteps ?? this.defaultMaxSteps;
    const auditMode = options.auditMode ?? false;
    const autoContinue = options.autoContinue ?? true;
    const maxAutoContinues = options.maxAutoContinues ?? 2;
    let auditNudgeUsed = false;
    let autoContinuesUsed = 0;
    let phaseLockRunCommandFailures = 0;
    const hardLimit = maxSteps + maxAutoContinues * maxSteps;

    for (let step = 0; step < hardLimit; step++) {
      if (signal?.aborted) break;
      const displayStep = ((step % maxSteps) + 1);
      callbacks?.onStep?.(displayStep, maxSteps);

      injectPlanTracker(messages, options.planTracker);

      let stepContent = '';
      const toolCallsMap = new Map<number, ToolCall>();
      const llmStartedAt = Date.now();

      for await (const delta of provider.complete({
        messages,
        tools,
        toolChoice: 'auto',
        stream: true,
      })) {
        if (signal?.aborted) break;
        if (delta.error) throw new Error(delta.error);
        if (delta.content) {
          stepContent += delta.content;
        }
        const chunk = toAssistantStreamChunk(delta.content, delta.reasoning);
        if (chunk) yield chunk;
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

      callbacks?.onLlmStepComplete?.(displayStep, Date.now() - llmStartedAt, toolCalls?.length ?? 0);

      if (!toolCalls || toolCalls.length === 0) {
        if (auditMode && stepContent && !auditNudgeUsed) {
          auditNudgeUsed = true;
          messages.push({ role: 'assistant', content: stepContent });
          messages.push({ role: 'user', content: NO_TOOLS_AUDIT_NUDGE });
          continue;
        }
        if (stepContent) {
          messages.push({ role: 'assistant', content: stepContent });
        }
        break;
      }

      messages.push({
        role: 'assistant',
        content: stepContent,
        tool_calls: toolCalls,
      });

      const executions = await Promise.all(
        toolCalls.map(async (tc) => {
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
                phaseLock: options.phaseLock,
                restrictRunCommandToReadOnly: options.restrictRunCommandToReadOnly,
              })
            : notOfferedToolResult(tc.function.name);
          return { tc, input, execResult, durationMs: Date.now() - toolStartedAt };
        })
      );

      let phaseLockRunCommandFailuresThisTurn = 0;
      let resumeStepValidationFailed = false;

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
              resumeStepValidationFailed = true;
            }
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: toolContent,
        });
      }

      if (resumeStepValidationFailed) {
        messages.push({ role: 'user', content: VALIDATION_BLOCK_MESSAGE });
      }

      if (phaseLockRunCommandFailuresThisTurn > 0) {
        phaseLockRunCommandFailures += phaseLockRunCommandFailuresThisTurn;
        if (phaseLockRunCommandFailures >= 2) {
          messages.push({ role: 'assistant', content: PHASE_LOCK_RUN_COMMAND_HARD_STOP });
          yield PHASE_LOCK_RUN_COMMAND_HARD_STOP;
          break;
        }
      }

      if (pendingApproval) {
        const checkpoint = await createApprovalCheckpoint(provider, messages, options.phaseLock, signal);
        this.lastSuspendState = {
          messages: [...messages],
          tools,
          options,
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
        log.info('Auto-continuing agent loop after resume', { continueRound: autoContinuesUsed });
      }
    }

    this.lastPendingApproval = pendingApproval;
    log.info('Agent loop resume finished', { pendingApproval });
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

      const collected = await collectCompletion(provider, messages, tools, signal, streamContent && step === 0);

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

      const executions = await Promise.all(
        collected.toolCalls.map(async (tc) => {
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
                phaseLock: options?.phaseLock,
                restrictRunCommandToReadOnly: options?.restrictRunCommandToReadOnly,
              })
            : notOfferedToolResult(tc.function.name);
          toolCallsMade += 1;
          return { tc, execResult, durationMs: Date.now() - toolStartedAt };
        })
      );

      let phaseLockRunCommandFailuresThisTurn = 0;

      for (const { tc, execResult, durationMs } of executions) {
        if (signal?.aborted) break;

        if (execResult.pendingApproval) {
          pendingApproval = true;
          callbacks?.onToolEnd?.(tc.function.name, false, 'Awaiting approval');
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
  stream = true
): Promise<CollectedCompletion> {
  let content = '';
  const toolCallsMap = new Map<number, ToolCall>();

  for await (const delta of provider.complete({
    messages,
    tools,
    toolChoice: 'auto',
    stream,
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
 * counted across steps. Phase-lock failures are excluded — they already have their own
 * graduated escalation (nudge, then hard stop) and would otherwise get short-circuited here
 * before that instructional message ever reaches the model.
 */
function repeatedToolFailureKey(toolName: string, output: string): string | undefined {
  if (!output) return undefined;
  if (['write_file', 'apply_patch'].includes(toolName) && isPhaseLockWriteError(output)) return undefined;
  if (toolName === 'run_command' && isPhaseLockRunCommandError(output)) return undefined;
  return `${toolName}:${normalizeToolFailure(output)}`;
}

function normalizeToolFailure(output: string): string {
  return output.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function buildRepeatedToolInputFailureMessage(toolName: string, output: string, count: number): string {
  const detail = normalizeToolFailure(output).slice(0, 320);
  return [
    `\n\n### ${REPEATED_TOOL_INPUT_FAILURE_PREFIX}`,
    '',
    `The agent stopped after ${count} consecutive \`${toolName}\` calls that failed with the same error: ${detail}`,
    '',
    'I will not keep retrying the same failing tool call. The next attempt should use a different tool, different arguments, or explain the blocker instead.',
  ].join('\n');
}
