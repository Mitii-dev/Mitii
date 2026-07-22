import { existsSync, statSync } from 'fs';
import { isAbsolute } from 'path';
import { isReadOnlyCommand } from '../../../features/ce/plans/PlanActEngine';
import {
  GIT_EXPLICIT_APPROVAL_TOOL_IDS,
  GIT_POLICY_WRITE_TOOL_IDS,
  LOG_AUDIT_PATH_TOOL_IDS,
  MCP_FILESYSTEM_WRITE_PATTERN,
  PATH_READ_TOOL_IDS,
  POLICY_READ_ONLY_TOOL_IDS,
  SHELL_TOOL_IDS,
  WRITE_TOOL_IDS,
  isMcpFilesystemReadToolName,
  isMcpFilesystemWriteToolName,
  usesReadPathSemanticsTool,
} from '../tools/toolMetadata';
import { ToolId } from '../tools/toolIds';

export type PolicyDecision = 'allow' | 'require_approval' | 'block';

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

export type IgnoredPathChecker = (path: string, options?: { forRead?: boolean }) => boolean;

const DANGEROUS_COMMANDS = [
  /\bsudo\b/i, /chmod\s+-R/i, /chown\s+-R/i,
  /\bmkfs\b/i, /\bdd\b/i, /\bshutdown\b/i, /\breboot\b/i,
  /curl\s+.*\|\s*sh/i, /wget\s+.*\|\s*sh/i,
  /\bnpm\s+publish\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+checkout\s+--\s+\.\b/i,
  /\bgit\s+restore\s+\.\b/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bgit\s+rebase\s+--onto\b/i,
  /\bgit\s+(?:filter-branch|filter-repo)\b/i,
];

export interface SafetyConfig {
  requireApprovalForWrites: boolean;
  requireApprovalForShell: boolean;
  allowNetwork: boolean;
  blockDangerousCommands: boolean;
  approvalMode?: 'review_all' | 'ask_edits' | 'ask_deletes' | 'ask_commands' | 'auto';
  autonomyPreset?: string;
  allowUntrustedWorkspace?: boolean;
}

export class ToolPolicyEngine {
  constructor(
    private safetyConfig: SafetyConfig,
    private readonly isIgnoredPath: IgnoredPathChecker,
    private readonly isWorkspaceTrusted: () => boolean = () => true,
    /** Resolves a raw path to a workspace-relative path, or null if it falls outside the workspace. */
    private readonly resolveWorkspaceRelPath: (path: string) => string | null = () => null
  ) {}

  updateSafetyConfig(safetyConfig: SafetyConfig): void {
    this.safetyConfig = safetyConfig;
  }

  evaluate(toolName: string, input: Record<string, unknown>): PolicyResult {
    const forRead = usesReadPathSemantics(toolName);
    const blockedPath = this.findIgnoredInputPath(toolName, input, forRead);
    if (blockedPath) {
      return { decision: 'block', reason: 'Path is ignored' };
    }

    if (
      !this.isWorkspaceTrusted() &&
      !this.safetyConfig.allowUntrustedWorkspace &&
      (WRITE_TOOL_IDS.has(toolName) || SHELL_TOOL_IDS.has(toolName) || isMcpFilesystemWriteTool(toolName))
    ) {
      return {
        decision: 'block',
        reason: 'Workspace is not trusted — file writes and shell commands are disabled',
      };
    }

    if (POLICY_READ_ONLY_TOOL_IDS.has(toolName) || isMcpFilesystemReadTool(toolName)) {
      if (toolName === ToolId.FetchWeb && !this.safetyConfig.allowNetwork) {
        return { decision: 'block', reason: 'Network access disabled' };
      }
      if (toolName === ToolId.AskQuestion) {
        return { decision: 'require_approval', reason: 'Clarifying question requires user response' };
      }
      if (PATH_READ_TOOL_IDS.has(toolName) || isMcpFilesystemReadTool(toolName)) {
        const externalPath = this.findExternalFilePath(toolName, input);
        if (externalPath) {
          return {
            decision: 'require_approval',
            reason: `Reading a file outside the workspace requires approval: ${externalPath}`,
          };
        }
      }
      return { decision: 'allow', reason: 'Read-only tool' };
    }

    if (GIT_POLICY_WRITE_TOOL_IDS.has(toolName)) {
      if (this.requiresWriteApproval()) {
        return { decision: 'require_approval', reason: 'Git workspace/local write requires approval by policy' };
      }
      return { decision: 'allow', reason: 'Git policy-write auto-approved by current policy' };
    }

    if (GIT_EXPLICIT_APPROVAL_TOOL_IDS.has(toolName)) {
      return { decision: 'require_approval', reason: 'Git or GitHub operation requires explicit approval' };
    }

    if (toolName === ToolId.MemoryWrite) {
      return { decision: 'allow', reason: 'Memory writes are low risk' };
    }

    if (WRITE_TOOL_IDS.has(toolName) || isMcpFilesystemWriteTool(toolName)) {
      if (this.requiresWriteApproval()) {
        return { decision: 'require_approval', reason: 'Write operations require approval' };
      }
      return { decision: 'allow', reason: 'Writes auto-approved by policy' };
    }

    if (SHELL_TOOL_IDS.has(toolName)) {
      const command = typeof input.command === 'string' ? input.command : '';
      if (this.safetyConfig.blockDangerousCommands && isDangerousCommand(command)) {
        return {
          decision: 'require_approval',
          reason: 'Dangerous command requires explicit user approval',
        };
      }
      if (isReadOnlyCommand(command)) {
        return { decision: 'allow', reason: 'Read-only inspection command' };
      }
      if (this.requiresShellApproval(command)) {
        return { decision: 'require_approval', reason: 'Shell commands require approval' };
      }
      return { decision: 'allow', reason: 'Shell auto-approved by policy' };
    }

    if (this.safetyConfig.approvalMode === 'auto') {
      return { decision: 'allow', reason: 'Unknown tool auto-approved by policy' };
    }
    return { decision: 'require_approval', reason: 'Unknown tool requires approval' };
  }

  private findIgnoredInputPath(
    toolName: string,
    input: Record<string, unknown>,
    forRead: boolean
  ): string | undefined {
    const candidates: string[] = [];
    if (typeof input.path === 'string') candidates.push(input.path);
    if (Array.isArray(input.paths)) {
      candidates.push(...input.paths.filter((p): p is string => typeof p === 'string'));
    }
    for (const raw of candidates) {
      if (LOG_AUDIT_PATH_TOOL_IDS.has(toolName) && isLogAuditReadablePath(raw)) continue;
      if (this.isIgnoredPath(raw, { forRead })) return raw;
    }
    void toolName;
    return undefined;
  }

  /** Returns the raw path if a read tool targets a real, existing file outside the
   *  workspace — null otherwise (missing/typo'd paths still fall through to the
   *  tool's normal "not found" error rather than prompting for approval). */
  private findExternalFilePath(toolName: string, input: Record<string, unknown>): string | undefined {
    const candidates: string[] = [];
    if ((toolName === ToolId.ReadFile || isMcpFilesystemReadTool(toolName)) && typeof input.path === 'string') {
      candidates.push(input.path);
    }
    if (toolName === ToolId.ReadFiles && Array.isArray(input.paths)) {
      candidates.push(...input.paths.filter((p): p is string => typeof p === 'string'));
    }

    for (const rawPath of candidates) {
      if (!isAbsolute(rawPath)) continue;
      if (this.resolveWorkspaceRelPath(rawPath) !== null) continue;
      try {
        if (existsSync(rawPath) && statSync(rawPath).isFile()) {
          return rawPath;
        }
      } catch {
        // Not a real file — leave it to the tool's normal not-found handling.
      }
    }
    return undefined;
  }

  private requiresWriteApproval(): boolean {
    switch (this.safetyConfig.approvalMode) {
      case 'auto':
      case 'ask_deletes':
      case 'ask_commands':
        return false;
      case 'ask_edits':
      case 'review_all':
        return true;
      default:
        return this.safetyConfig.requireApprovalForWrites;
    }
  }

  private requiresShellApproval(command: string): boolean {
    switch (this.safetyConfig.approvalMode) {
      case 'auto':
        return false;
      case 'ask_deletes':
        return isDeleteLikeCommand(command);
      case 'ask_edits':
        return isDeleteLikeCommand(command);
      case 'ask_commands':
      case 'review_all':
        return true;
      default:
        return this.safetyConfig.requireApprovalForShell;
    }
  }
}

/** Native + MCP tools that inspect paths and should use IgnoreService forRead exceptions. */
export function usesReadPathSemantics(toolName: string): boolean {
  return usesReadPathSemanticsTool(toolName);
}

function isLogAuditReadablePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\/+/, '').trim().replace(/\/+$/, '');
  return /(?:^|\/)(?:\.mitii|\.miti|\.mtii|\.mitti)\/logs$/i.test(normalized) ||
    /(?:^|\/)(?:\.mitii|\.miti|\.mtii|\.mitti)\/logs\/[^/]+\.(?:jsonl|json|log)$/i.test(normalized) ||
    /(?:^|\/)logs$/i.test(normalized) ||
    /(?:^|\/)logs\/[^/]+\.(?:jsonl|json|log)$/i.test(normalized);
}

export function isMcpFilesystemReadTool(toolName: string): boolean {
  return isMcpFilesystemReadToolName(toolName);
}

export function isMcpFilesystemWriteTool(toolName: string): boolean {
  return isMcpFilesystemWriteToolName(toolName);
}

export function isDangerousCommand(command: string): boolean {
  return (
    DANGEROUS_COMMANDS.some((p) => p.test(command)) ||
    isRecursiveForcedDelete(command) ||
    isDestructiveGitClean(command) ||
    /\bgit\s+push\b[^;&|\n]*(?:--force(?:-with-lease)?|-f)(?:\s|$)/i.test(command)
  );
}

function isRecursiveForcedDelete(command: string): boolean {
  return /\brm\s+(?=[^;&|\n]*(?:-[a-z]*r[a-z]*|--recursive)(?:\s|$))(?=[^;&|\n]*(?:-[a-z]*f[a-z]*|--force)(?:\s|$))[^;&|\n]+/i.test(command);
}

function isDestructiveGitClean(command: string): boolean {
  return /\bgit\s+clean\s+(?=[^;&|\n]*(?:-[a-z]*f[a-z]*|--force)(?:\s|$))(?=[^;&|\n]*(?:-[a-z]*(?:d|x)[a-z]*|--directories|--ignored)(?:\s|$))[^;&|\n]*/i.test(command);
}

export function isDeleteLikeCommand(command: string): boolean {
  return [
    /\brm\s+(?:-[^\s]*\s+)*[^\s]/i,
    /\bgit\s+rm\b/i,
    /\b(?:npm|pnpm|yarn)\s+(?:uninstall|remove|rm|prune)\b/i,
    /\bunlink\b/i,
    /\brmdir\b/i,
    /\brimraf\b/i,
    /\btrash\b/i,
    /\bfind\b[\s\S]*\s-delete\b/i,
  ].some((p) => p.test(command));
}

/** @deprecated Use MCP_FILESYSTEM_WRITE_PATTERN from toolMetadata. */
export { MCP_FILESYSTEM_WRITE_PATTERN as MCP_FILESYSTEM_WRITE };
