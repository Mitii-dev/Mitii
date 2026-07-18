import type { ToolRuntime } from '../tools/ToolRuntime';
import { readApprovedExternalFile, readApprovedExternalFiles } from '../tools/builtinTools';
import type { ToolPolicyEngine, PolicyResult } from './ToolPolicyEngine';
import type { ApprovalQueue } from './ApprovalQueue';
import type { AgentTaskState } from '../runtime/AgentTaskState';
import {
  isWriteAllowed,
  isShellAllowed,
  isPatchAllowed,
  isReadOnlyCommand,
  isToolAllowedInPlanPhase,
  isPhaseLockWriteError,
  type PlanPhase,
} from '../plans/PlanActEngine';
import { resolveToolName } from '../tools/toolAliases';
import { normalizeThunderMode } from '../session/ThunderSession';
import { isAskAllowedTool } from '../runtime/askMode';
import { isMcpFilesystemWriteTool } from './ToolPolicyEngine';
import { createLogger } from '../telemetry/Logger';
import type { SessionLogService } from '../telemetry/SessionLogService';

const log = createLogger('ToolExecutor');

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  pendingApproval?: boolean;
  /** Intentional dedup / policy skip — not a real failure. */
  skipped?: boolean;
}

export interface ToolExecuteContext {
  toolCallId?: string;
  phaseLock?: PlanPhase;
  restrictRunCommandToReadOnly?: boolean;
}

export class ToolExecutor {
  private planPhaseLockOverride?: PlanPhase;
  private phaseLockWriteBlocks = 0;

  constructor(
    private readonly toolRuntime: ToolRuntime,
    private readonly policyEngine: ToolPolicyEngine,
    private readonly approvalQueue: ApprovalQueue,
    private readonly getSessionId: () => string,
    private readonly getMode: () => string,
    private readonly onPendingApproval?: () => void,
    private readonly getTaskState?: () => AgentTaskState | undefined,
    private readonly sessionLog?: SessionLogService,
    private readonly onPhaseLockEscalate?: () => void
  ) {}

  setPlanPhaseLock(phase?: PlanPhase): void {
    this.planPhaseLockOverride = phase;
  }

  clearPlanPhaseLock(): void {
    this.planPhaseLockOverride = undefined;
  }

  async execute(
    toolName: string,
    input: Record<string, unknown>,
    context?: ToolExecuteContext
  ): Promise<ToolExecutionResult> {
    const resolvedName = resolveToolName(toolName);
    const mode = this.getMode();

    const effectivePhaseLock = context?.phaseLock ?? this.planPhaseLockOverride;
    let phaseCheck = isToolAllowedInPlanPhase(effectivePhaseLock, resolvedName, input);
    if (!phaseCheck.allowed) {
      if (
        ['write_file', 'apply_patch'].includes(resolvedName) &&
        isPhaseLockWriteError(phaseCheck.reason)
      ) {
        this.phaseLockWriteBlocks += 1;
        if (this.phaseLockWriteBlocks >= 3 && this.onPhaseLockEscalate) {
          this.onPhaseLockEscalate();
          this.phaseLockWriteBlocks = 0;
          phaseCheck = isToolAllowedInPlanPhase(
            context?.phaseLock ?? this.planPhaseLockOverride,
            resolvedName,
            input
          );
        }
      }
      if (!phaseCheck.allowed) {
        return this.finishBlocked(resolvedName, input, phaseCheck.reason ?? 'Tool blocked by current plan phase');
      }
    }

    if (
      context?.restrictRunCommandToReadOnly &&
      resolvedName === 'run_command' &&
      !isReadOnlyCommand(typeof input.command === 'string' ? input.command : '')
    ) {
      return this.finishBlocked(
        resolvedName,
        input,
        'Generic run_command is restricted to read-only commands during high-complexity audit tasks. Use execute_workspace_script for approved helper scripts.'
      );
    }

    const readOnlyMode = normalizeThunderMode(mode) === 'ask' || normalizeThunderMode(mode) === 'plan';
    const scopeBlocked = this.getTaskState?.()?.checkScopeGate(resolvedName, input);
    if (scopeBlocked) {
      const soft = this.getTaskState?.()?.buildSoftBlockResponse(resolvedName, input);
      return this.finishSoftBlock(resolvedName, input, soft ?? scopeBlocked);
    }

    const mcpCap = readOnlyMode ? null : this.getTaskState?.()?.checkMcpCap(resolvedName);
    if (mcpCap) {
      return this.finishSoftBlock(resolvedName, input, mcpCap);
    }

    const shouldCheckTaskBlock = !readOnlyMode || resolvedName === 'execute_workspace_script';
    const blocked = shouldCheckTaskBlock ? this.getTaskState?.()?.checkBlocked(resolvedName, input) : null;
    if (blocked) {
      const soft = this.getTaskState?.()?.buildSoftBlockResponse(resolvedName, input);
      const output = soft ?? blocked;
      return this.finishSoftBlock(resolvedName, input, output);
    }

    const sessionId = this.getSessionId();
    const normalizedMode = normalizeThunderMode(mode);

    // Ask/Plan/Review: mutating actions request user approval instead of hard-blocking.
    // After the user approves (once or for the task), grants allow the call to proceed.
    if (['write_file', 'apply_patch', 'memory_write', 'save_task_state'].includes(resolvedName) && !isWriteAllowed(mode)) {
      const gated = this.requestModeEscalationApproval(
        sessionId,
        resolvedName,
        input,
        'File writes in Ask/Plan/Review require your approval',
        context?.toolCallId
      );
      if (gated) return gated;
    }
    if (resolvedName === 'apply_patch' && !isPatchAllowed(mode)) {
      const gated = this.requestModeEscalationApproval(
        sessionId,
        resolvedName,
        input,
        'Patch apply in Ask/Plan/Review requires your approval',
        context?.toolCallId
      );
      if (gated) return gated;
    }
    if ((readOnlyMode || normalizedMode === 'review') && isMcpFilesystemWriteTool(resolvedName)) {
      const gated = this.requestModeEscalationApproval(
        sessionId,
        resolvedName,
        input,
        'MCP filesystem writes in Ask/Plan/Review require your approval',
        context?.toolCallId
      );
      if (gated) return gated;
    }
    if (resolvedName === 'run_command' && !isShellAllowed(mode, typeof input.command === 'string' ? input.command : undefined)) {
      const gated = this.requestModeEscalationApproval(
        sessionId,
        resolvedName,
        input,
        'Mutating shell commands in Ask/Plan/Review require your approval (read-only grep/rg/ls/etc. are allowed without approval)',
        context?.toolCallId
      );
      if (gated) return gated;
    }

    if (normalizedMode === 'ask' && !isAskAllowedTool(resolvedName)) {
      return this.finishBlocked(resolvedName, input, `Tool ${resolvedName} is not available in Ask mode`);
    }

    const policy = this.policyEngine.evaluate(resolvedName, input);

    if (policy.decision === 'block') {
      return this.finishBlocked(resolvedName, input, policy.reason);
    }

    if (policy.decision === 'require_approval') {
      if (!this.approvalQueue.hasApprovalGrant(sessionId, resolvedName)) {
        return this.enqueueApproval(sessionId, resolvedName, input, policy, context?.toolCallId);
      }
    }

    const result: ToolExecutionResult = await this.toolRuntime.execute(resolvedName, input, context?.toolCallId);
    log.info('Tool executed via executor', { tool: resolvedName, success: result.success });
    if (result.success) {
      if (['write_file', 'apply_patch'].includes(resolvedName)) {
        this.phaseLockWriteBlocks = 0;
      }
      this.getTaskState?.()?.recordToolSuccess(resolvedName, input, result.output);
    } else if (!result.pendingApproval && !result.skipped) {
      this.getTaskState?.()?.recordToolFailure(resolvedName, input);
    }
    return result;
  }

  private requestModeEscalationApproval(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    reason: string,
    toolCallId?: string
  ): ToolExecutionResult | null {
    if (this.approvalQueue.hasApprovalGrant(sessionId, toolName)) {
      return null;
    }
    return this.enqueueApproval(sessionId, toolName, input, { decision: 'require_approval', reason }, toolCallId);
  }

  private enqueueApproval(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    policy: PolicyResult,
    toolCallId?: string
  ): ToolExecutionResult {
    const request = this.approvalQueue.createRequest(sessionId, toolName, input, policy, {
      toolCallId,
    });
    this.sessionLog?.append('approval_request', `${request.kind ?? 'approval'}: ${toolName}`, {
      id: request.id,
      toolName: request.toolName,
      kind: request.kind,
      risk: request.risk,
      reason: request.reason,
      files: request.files,
      contentLength: request.contentLength,
      question: request.question,
      options: request.options,
      optionCount: request.options?.length ?? 0,
      toolCallId: request.toolCallId,
    });
    this.onPendingApproval?.();
    this.logRejectedToolCall(toolName, input, false, 'Awaiting approval', 'Awaiting approval');
    return { success: false, output: '', pendingApproval: true, error: 'Awaiting approval' };
  }

  private finishSoftBlock(toolName: string, input: Record<string, unknown>, output: string): ToolExecutionResult {
    this.logSkippedToolCall(toolName, input, output);
    return { success: false, skipped: true, output, error: 'Skipped redundant tool call' };
  }

  private finishBlocked(toolName: string, input: Record<string, unknown>, error: string): ToolExecutionResult {
    this.logRejectedToolCall(toolName, input, false, error, error);
    return { success: false, output: '', error };
  }

  private logSkippedToolCall(toolName: string, input: Record<string, unknown>, output: string): void {
    const toolCallId = createToolCallId(toolName);
    const inputPreview = previewInput(input);
    this.sessionLog?.append('info', `tool skipped: ${toolName}`, {
      toolCallId,
      tool: toolName,
      detail: output.slice(0, 500),
    });
    this.sessionLog?.append('tool_start', toolName, {
      toolCallId,
      tool: toolName,
      toolName,
      path: typeof input.path === 'string' ? input.path : undefined,
      command: typeof input.command === 'string' ? input.command : undefined,
      inputPreview,
      skipped: true,
    });
    this.sessionLog?.append('tool_end', toolName, {
      toolCallId,
      tool: toolName,
      toolName,
      path: typeof input.path === 'string' ? input.path : undefined,
      command: typeof input.command === 'string' ? input.command : undefined,
      success: true,
      failure: false,
      skipped: true,
      durationMs: 0,
      inputPreview,
      outputPreview: output.slice(0, 500),
    });
    this.sessionLog?.appendDebug('info', `debug tool_skipped ${toolName}`, {
      eventType: 'tool_skipped',
      toolCallId,
      tool: toolName,
      toolName,
      input,
      output,
    });
  }

  private logRejectedToolCall(
    toolName: string,
    input: Record<string, unknown>,
    success: boolean,
    output: string,
    error?: string
  ): void {
    const toolCallId = createToolCallId(toolName);
    const inputPreview = previewInput(input);
    this.sessionLog?.append('tool_start', toolName, {
      toolCallId,
      tool: toolName,
      toolName,
      path: typeof input.path === 'string' ? input.path : undefined,
      command: typeof input.command === 'string' ? input.command : undefined,
      inputPreview,
    });
    this.sessionLog?.appendDebug('info', `debug tool_start ${toolName}`, {
      eventType: 'tool_start',
      toolCallId,
      tool: toolName,
      toolName,
      input,
    });
    this.sessionLog?.append('tool_end', toolName, {
      toolCallId,
      tool: toolName,
      toolName,
      path: typeof input.path === 'string' ? input.path : undefined,
      command: typeof input.command === 'string' ? input.command : undefined,
      success,
      failure: !success,
      durationMs: 0,
      inputPreview,
      outputPreview: output.slice(0, 500),
      error,
    });
    this.sessionLog?.appendDebug('info', `debug tool_end ${toolName}`, {
      eventType: 'tool_end',
      toolCallId,
      tool: toolName,
      toolName,
      input,
      result: { success, output, error },
      durationMs: 0,
    });
  }

  async executeApproved(toolName: string, input: Record<string, unknown>): Promise<ToolExecutionResult> {
    // read_file/read_files only ever land here via approval when the target path is
    // outside the workspace (see ToolPolicyEngine.findExternalFilePath) — the tools'
    // own implementations always refuse those paths outright as a defense-in-depth
    // boundary, so the actual read happens here instead, once approval is granted.
    if (toolName === 'read_file' && typeof input.path === 'string') {
      const result = await readApprovedExternalFile(input.path);
      if (result.success) this.getTaskState?.()?.recordToolSuccess(toolName, input, result.output);
      return result;
    }
    if (toolName === 'read_files' && Array.isArray(input.paths)) {
      const paths = input.paths.filter((p): p is string => typeof p === 'string');
      const result = await readApprovedExternalFiles(paths);
      if (result.success) this.getTaskState?.()?.recordToolSuccess(toolName, input, result.output);
      return result;
    }

    const result = await this.toolRuntime.execute(toolName, input);
    if (result.success) {
      this.getTaskState?.()?.recordToolSuccess(toolName, input, result.output);
    }
    return result;
  }
}

function previewInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input).slice(0, 500);
  } catch {
    return String(input).slice(0, 500);
  }
}

function createToolCallId(toolName: string): string {
  return `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
