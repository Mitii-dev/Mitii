import type { ToolRuntime } from '../../../kernel/tools/ToolRuntime';
import {
  DANGEROUS_COMMAND_APPROVAL_FIELD,
  readApprovedExternalFile,
  readApprovedExternalFiles,
} from '../tools/builtinTools';
import { isDangerousCommand, type ToolPolicyEngine, type PolicyResult } from './ToolPolicyEngine';
import type { ApprovalQueue } from './ApprovalQueue';
import type { AgentTaskState } from '../../../features/ce/runtime/AgentTaskState';
import {
  isWriteAllowed,
  isShellAllowed,
  isPatchAllowed,
  isReadOnlyCommand,
  classifyCommandEffect,
  isToolAllowedInPlanPhase,
  isPhaseLockWriteError,
  type PlanPhase,
} from '../../../features/ce/plans/PlanActEngine';
import { resolveToolName } from '../../../kernel/tools/toolAliases';
import { normalizeThunderMode } from '../../../features/ce/session/ThunderSession';
import { isAskAllowedTool } from '../../../features/ce/runtime/askMode';
import { isMcpFilesystemWriteTool } from './ToolPolicyEngine';
import { createLogger } from '../../../kernel/telemetry/Logger';
import type { SessionLogService } from '../../../kernel/telemetry/SessionLogService';
import { fingerprintApprovalInput, type ApprovalKind, type ApprovalRequest } from './ApprovalQueue';

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
  allowedToolNames?: ReadonlySet<string>;
}

type PhaseState = {
  override?: PlanPhase;
  lastEffectivePhase?: PlanPhase;
  writeBlocks: number;
};

export class ToolExecutor {
  private phaseStates = new Map<string, PhaseState>();

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
    const sessionId = this.getSessionId();
    if (!sessionId) return;
    this.phaseStates.set(sessionId, { override: phase, writeBlocks: 0 });
  }

  clearPlanPhaseLock(): void {
    const sessionId = this.getSessionId();
    if (!sessionId) return;
    this.phaseStates.set(sessionId, { writeBlocks: 0 });
  }

  async execute(
    toolName: string,
    input: Record<string, unknown>,
    context?: ToolExecuteContext
  ): Promise<ToolExecutionResult> {
    input = stripInternalApprovalFields(input);
    const resolvedName = resolveToolName(toolName);
    const mode = this.getMode();
    const normalizedMode = normalizeThunderMode(mode);
    const sessionId = this.getSessionId();

    if (
      context?.allowedToolNames &&
      !context.allowedToolNames.has(toolName) &&
      !context.allowedToolNames.has(resolvedName)
    ) {
      return this.finishBlocked(resolvedName, input, `Tool ${resolvedName} was not offered for this turn`, context?.toolCallId);
    }

    if (normalizedMode === 'ask' && !isAskAllowedTool(resolvedName)) {
      return this.finishBlocked(resolvedName, input, `Tool ${resolvedName} is not available in Ask mode`, context?.toolCallId);
    }

    if (!this.isRegisteredTool(resolvedName)) {
      return this.finishBlocked(resolvedName, input, `Unknown tool: ${resolvedName}`, context?.toolCallId);
    }

    const phaseState = this.getPhaseState(sessionId);
    const effectivePhaseLock = context?.phaseLock ?? phaseState.override;
    this.resetPhaseCounterIfChanged(phaseState, effectivePhaseLock);
    const phaseCheck = isToolAllowedInPlanPhase(effectivePhaseLock, resolvedName, input);
    if (!phaseCheck.allowed) {
      if (
        ['write_file', 'apply_patch'].includes(resolvedName) &&
        isPhaseLockWriteError(phaseCheck.reason)
      ) {
        phaseState.writeBlocks += 1;
        if (phaseState.writeBlocks >= 3) {
          this.onPhaseLockEscalate?.();
          phaseState.writeBlocks = 0;
        }
      }
      if (!phaseCheck.allowed) {
        return this.finishBlocked(
          resolvedName,
          input,
          phaseCheck.reason ?? 'Tool blocked by current plan phase',
          context?.toolCallId
        );
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

    const policy = this.policyEngine.evaluate(resolvedName, input);

    if (policy.decision === 'block') {
      return this.finishBlocked(resolvedName, input, policy.reason, context?.toolCallId);
    }

    const planModeBlock = getPlanModeMutationBlockReason(resolvedName, input, normalizedMode);
    const dangerousShell = isDangerousShellCall(resolvedName, input);
    if (planModeBlock && !dangerousShell) {
      return this.finishBlocked(resolvedName, input, planModeBlock, context?.toolCallId);
    }

    const modeApprovalReason = this.getModeApprovalReason(resolvedName, input, mode, readOnlyMode, normalizedMode);
    const approvalKind = getApprovalKind(Boolean(modeApprovalReason), policy.decision === 'require_approval');
    if (approvalKind) {
      const reason = combineApprovalReasons(modeApprovalReason, policy.decision === 'require_approval' ? policy.reason : undefined);
      if (!this.approvalQueue.hasApprovalGrant(sessionId, resolvedName, input, approvalKind)) {
        return this.enqueueApproval(
          sessionId,
          resolvedName,
          input,
          { decision: 'require_approval', reason },
          context?.toolCallId,
          approvalKind
        );
      }
    }

    const result: ToolExecutionResult = await this.toolRuntime.execute(resolvedName, input, context?.toolCallId);
    log.info('Tool executed via executor', { tool: resolvedName, success: result.success });
    if (result.success) {
      if (['write_file', 'apply_patch'].includes(resolvedName)) {
        phaseState.writeBlocks = 0;
      }
      this.getTaskState?.()?.recordToolSuccess(resolvedName, input, result.output);
    } else if (!result.pendingApproval && !result.skipped) {
      this.getTaskState?.()?.recordToolFailure(resolvedName, input);
    }
    return result;
  }

  private getPhaseState(sessionId: string): PhaseState {
    const key = sessionId || '__default__';
    let state = this.phaseStates.get(key);
    if (!state) {
      state = { writeBlocks: 0 };
      this.phaseStates.set(key, state);
    }
    return state;
  }

  private resetPhaseCounterIfChanged(state: PhaseState, phase?: PlanPhase): void {
    if (state.lastEffectivePhase !== phase) {
      state.lastEffectivePhase = phase;
      state.writeBlocks = 0;
    }
  }

  private getModeApprovalReason(
    resolvedName: string,
    input: Record<string, unknown>,
    mode: string,
    readOnlyMode: boolean,
    normalizedMode: string
  ): string | undefined {
    if (['write_file', 'apply_patch', 'memory_write', 'save_task_state'].includes(resolvedName) && !isWriteAllowed(mode)) {
      return 'File writes in Ask/Plan/Review require your approval';
    }
    if (resolvedName === 'apply_patch' && !isPatchAllowed(mode)) {
      return 'Patch apply in Ask/Plan/Review requires your approval';
    }
    if ((readOnlyMode || normalizedMode === 'review') && isMcpFilesystemWriteTool(resolvedName)) {
      return 'MCP filesystem writes in Ask/Plan/Review require your approval';
    }
    if (resolvedName === 'run_command' && !isShellAllowed(mode, typeof input.command === 'string' ? input.command : undefined)) {
      return 'Mutating shell commands in Ask/Plan/Review require your approval (read-only grep/rg/ls/etc. are allowed without approval)';
    }
    return undefined;
  }

  private enqueueApproval(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    policy: PolicyResult,
    toolCallId?: string,
    approvalKind: ApprovalKind = 'policy'
  ): ToolExecutionResult {
    const request = this.approvalQueue.createRequest(sessionId, toolName, input, policy, {
      toolCallId,
      approvalKind,
    });
    this.sessionLog?.append('approval_request', `${request.kind ?? 'approval'}: ${toolName}`, {
      id: request.id,
      toolName: request.toolName,
      kind: request.kind,
      approvalKind: request.approvalKind,
      inputFingerprint: request.inputFingerprint,
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

  private finishBlocked(toolName: string, input: Record<string, unknown>, error: string, toolCallId?: string): ToolExecutionResult {
    this.logRejectedToolCall(toolName, input, false, error, error, toolCallId);
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
    error?: string,
    providerToolCallId?: string
  ): void {
    const toolCallId = providerToolCallId ?? createToolCallId(toolName);
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

  async executeApproved(approvalRequestId: string): Promise<ToolExecutionResult> {
    const request = this.approvalQueue.consumeApprovedRequest(approvalRequestId);
    if (!request) {
      return {
        success: false,
        output: '',
        error: 'Approval request is missing, expired, or already consumed.',
      };
    }

    const result = await this.executeApprovedRequest(request);
    if (!result.success && !result.pendingApproval && !result.skipped) {
      this.getTaskState?.()?.recordToolFailure(request.toolName, request.input);
    }
    return result;
  }

  private async executeApprovedRequest(request: ApprovalRequest & { input: Record<string, unknown> }): Promise<ToolExecutionResult> {
    const toolName = resolveToolName(request.toolName);
    const input = request.input;
    const sessionId = this.getSessionId();
    if (request.sessionId !== sessionId) {
      return this.finishBlocked(toolName, input, 'Approval request does not belong to the active session', request.toolCallId);
    }
    if (request.toolName !== toolName && resolveToolName(request.toolName) !== toolName) {
      return this.finishBlocked(toolName, input, 'Approval request tool identity mismatch', request.toolCallId);
    }
    if (request.inputFingerprint !== fingerprintApprovalInput(toolName, input)) {
      return this.finishBlocked(toolName, input, 'Approval request input changed before execution', request.toolCallId);
    }

    const mode = this.getMode();
    const normalizedMode = normalizeThunderMode(mode);
    if (normalizedMode === 'ask' && !isAskAllowedTool(toolName)) {
      return this.finishBlocked(toolName, input, `Tool ${toolName} is not available in Ask mode`, request.toolCallId);
    }

    const phaseState = this.getPhaseState(sessionId);
    this.resetPhaseCounterIfChanged(phaseState, phaseState.override);
    const phaseCheck = isToolAllowedInPlanPhase(phaseState.override, toolName, input);
    if (!phaseCheck.allowed) {
      return this.finishBlocked(toolName, input, phaseCheck.reason ?? 'Tool blocked by current plan phase', request.toolCallId);
    }

    const readOnlyMode = normalizedMode === 'ask' || normalizedMode === 'plan';
    const scopeBlocked = this.getTaskState?.()?.checkScopeGate(toolName, input);
    if (scopeBlocked) {
      const soft = this.getTaskState?.()?.buildSoftBlockResponse(toolName, input);
      return this.finishSoftBlock(toolName, input, soft ?? scopeBlocked);
    }

    const mcpCap = readOnlyMode ? null : this.getTaskState?.()?.checkMcpCap(toolName);
    if (mcpCap) {
      return this.finishSoftBlock(toolName, input, mcpCap);
    }

    const shouldCheckTaskBlock = !readOnlyMode || toolName === 'execute_workspace_script';
    const blocked = shouldCheckTaskBlock ? this.getTaskState?.()?.checkBlocked(toolName, input) : null;
    if (blocked) {
      const soft = this.getTaskState?.()?.buildSoftBlockResponse(toolName, input);
      return this.finishSoftBlock(toolName, input, soft ?? blocked);
    }

    const policy = this.policyEngine.evaluate(toolName, input);
    if (policy.decision === 'block') {
      return this.finishBlocked(toolName, input, policy.reason, request.toolCallId);
    }

    const planModeBlock = getPlanModeMutationBlockReason(toolName, input, normalizedMode);
    const dangerousShell = isDangerousShellCall(toolName, input);
    if (planModeBlock && !dangerousShell) {
      return this.finishBlocked(toolName, input, planModeBlock, request.toolCallId);
    }

    const modeApprovalReason = this.getModeApprovalReason(toolName, input, mode, readOnlyMode, normalizedMode);
    const requiredKind = getApprovalKind(Boolean(modeApprovalReason), policy.decision === 'require_approval');
    if (requiredKind && !approvalKindCovers(request.approvalKind, requiredKind)) {
      return this.finishBlocked(
        toolName,
        input,
        'Approved request does not cover the currently required approval gate',
        request.toolCallId
      );
    }

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

    if (!this.isRegisteredTool(toolName)) {
      return this.finishBlocked(toolName, input, `Unknown tool: ${toolName}`, request.toolCallId);
    }

    const runtimeInput = dangerousShell
      ? { ...input, [DANGEROUS_COMMAND_APPROVAL_FIELD]: true }
      : input;
    const result = await this.toolRuntime.execute(toolName, runtimeInput, request.toolCallId);
    if (result.success) {
      this.getTaskState?.()?.recordToolSuccess(toolName, input, result.output);
    }
    return result;
  }

  private isRegisteredTool(toolName: string): boolean {
    const runtime = this.toolRuntime as ToolRuntime & { get?: (name: string) => unknown };
    return typeof runtime.get !== 'function' || Boolean(runtime.get(toolName));
  }
}

function getApprovalKind(modeRequired: boolean, policyRequired: boolean): ApprovalKind | undefined {
  if (modeRequired && policyRequired) return 'mode+policy';
  if (modeRequired) return 'mode';
  if (policyRequired) return 'policy';
  return undefined;
}

function isDangerousShellCall(toolName: string, input: Record<string, unknown>): boolean {
  return (
    toolName === 'run_command' &&
    typeof input.command === 'string' &&
    isDangerousCommand(input.command)
  );
}

function stripInternalApprovalFields(input: Record<string, unknown>): Record<string, unknown> {
  if (!(DANGEROUS_COMMAND_APPROVAL_FIELD in input)) return input;
  const sanitized = { ...input };
  delete sanitized[DANGEROUS_COMMAND_APPROVAL_FIELD];
  return sanitized;
}

function getPlanModeMutationBlockReason(
  toolName: string,
  input: Record<string, unknown>,
  normalizedMode: string
): string | undefined {
  if (normalizedMode !== 'plan' && normalizedMode !== 'ask') return undefined;
  const modeLabel = normalizedMode === 'ask' ? 'Ask' : 'Plan';
  if (['write_file', 'apply_patch', 'memory_write', 'save_task_state'].includes(toolName)) {
    return `Tool ${toolName} is not available in ${modeLabel} mode; switch to Agent mode to make changes.`;
  }
  if (isMcpFilesystemWriteTool(toolName)) {
    return `Tool ${toolName} is not available in ${modeLabel} mode; MCP filesystem writes are disabled.`;
  }
  if (toolName === 'run_command') {
    const command = typeof input.command === 'string' ? input.command : '';
    if (classifyCommandEffect(command) !== 'inspect_only') {
      return `${modeLabel} mode allows only inspect-only shell commands.`;
    }
  }
  return undefined;
}

function approvalKindCovers(actual: ApprovalKind | undefined, required: ApprovalKind): boolean {
  if (actual === required) return true;
  if (actual === 'mode+policy') return true;
  return false;
}

function combineApprovalReasons(modeReason?: string, policyReason?: string): string {
  if (modeReason && policyReason && modeReason !== policyReason) {
    return `${modeReason}. Policy: ${policyReason}`;
  }
  return modeReason ?? policyReason ?? 'Tool execution requires approval';
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
