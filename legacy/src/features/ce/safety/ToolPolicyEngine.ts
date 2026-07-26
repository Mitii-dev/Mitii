import { existsSync, statSync } from 'fs';
import { isAbsolute } from 'path';
import { isReadOnlyCommand } from '../../../features/ce/plans/PlanActEngine';

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

const READ_ONLY_TOOLS = new Set([
  'read_file', 'read_files', 'resolve_path', 'list_files', 'search', 'search_batch', 'repo_map',
  'retrieve_context', 'git_diff', 'diagnostics', 'memory_search', 'spawn_research_agent', 'spawn_subagent',
  'save_task_state', 'search_script_catalog', 'execute_workspace_script', 'use_skill',
  'fetch_web', 'ask_question', 'mark_step_complete', 'propose_plan_mutation', 'propose_file_scope',
  'analyze_log_directory', 'analyze_jsonl', 'query_log_events', 'list_logs',
  'git_status', 'git_log', 'git_show', 'git_blame', 'git_compare_branches', 'git_tag_list',
  'detect_changelog_strategy', 'aggregate_changelog', 'discover_github_workflows', 'analyze_github_workflow',
  'github_verify_repository', 'github_draft_pull_request', 'github_draft_issue', 'github_find_duplicate_issues',
  'github_get_workflow_run',
]);

/** Read tools that take a workspace-relative path — checked against the workspace
 *  boundary so reaching outside it goes through approval instead of being silently allowed. */
const PATH_READ_TOOLS = new Set(['read_file', 'read_files', 'list_files', 'resolve_path']);
const LOG_AUDIT_PATH_TOOLS = new Set(['analyze_log_directory', 'analyze_jsonl', 'query_log_events']);

const WRITE_TOOLS = new Set(['write_file', 'apply_patch', 'memory_write']);
const SHELL_TOOLS = new Set(['run_command']);
const GIT_POLICY_WRITE_TOOLS = new Set([
  'git_stage_files', 'git_unstage_files', 'generate_changelog_patch',
  'git_branch_create', 'git_branch_switch',
]);
const GIT_EXPLICIT_TOOLS = new Set([
  'git_commit', 'git_branch_delete', 'git_merge', 'git_rebase', 'git_tag_create', 'git_tag_delete_local',
  'github_create_pull_request', 'github_create_issue', 'github_dispatch_workflow', 'github_create_release',
  'release_plan_controller',
]);

const MCP_FILESYSTEM_WRITE =
  /^mcp__filesystem__(create_directory|move_file|write_file|edit_file)$/i;

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
      (WRITE_TOOLS.has(toolName) || SHELL_TOOLS.has(toolName) || MCP_FILESYSTEM_WRITE.test(toolName))
    ) {
      return {
        decision: 'block',
        reason: 'Workspace is not trusted — file writes and shell commands are disabled',
      };
    }

    if (READ_ONLY_TOOLS.has(toolName) || isMcpFilesystemReadTool(toolName)) {
      if (toolName === 'fetch_web' && !this.safetyConfig.allowNetwork) {
        return { decision: 'block', reason: 'Network access disabled' };
      }
      if (toolName === 'ask_question') {
        return { decision: 'require_approval', reason: 'Clarifying question requires user response' };
      }
      if (PATH_READ_TOOLS.has(toolName) || isMcpFilesystemReadTool(toolName)) {
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

    if (GIT_POLICY_WRITE_TOOLS.has(toolName)) {
      if (this.requiresWriteApproval()) {
        return { decision: 'require_approval', reason: 'Git workspace/local write requires approval by policy' };
      }
      return { decision: 'allow', reason: 'Git policy-write auto-approved by current policy' };
    }

    if (GIT_EXPLICIT_TOOLS.has(toolName)) {
      return { decision: 'require_approval', reason: 'Git or GitHub operation requires explicit approval' };
    }

    if (toolName === 'memory_write') {
      return { decision: 'allow', reason: 'Memory writes are low risk' };
    }

    if (WRITE_TOOLS.has(toolName) || MCP_FILESYSTEM_WRITE.test(toolName)) {
      if (this.requiresWriteApproval()) {
        return { decision: 'require_approval', reason: 'Write operations require approval' };
      }
      return { decision: 'allow', reason: 'Writes auto-approved by policy' };
    }

    if (SHELL_TOOLS.has(toolName)) {
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
      if (LOG_AUDIT_PATH_TOOLS.has(toolName) && isLogAuditReadablePath(raw)) continue;
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
    if ((toolName === 'read_file' || isMcpFilesystemReadTool(toolName)) && typeof input.path === 'string') {
      candidates.push(input.path);
    }
    if (toolName === 'read_files' && Array.isArray(input.paths)) {
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
  if (PATH_READ_TOOLS.has(toolName) || LOG_AUDIT_PATH_TOOLS.has(toolName) || toolName === 'propose_file_scope') return true;
  return isMcpFilesystemReadTool(toolName);
}

function isLogAuditReadablePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\/+/, '').trim().replace(/\/+$/, '');
  return /(?:^|\/)(?:\.mitii|\.miti|\.mtii|\.mitti)\/logs$/i.test(normalized) ||
    /(?:^|\/)(?:\.mitii|\.miti|\.mtii|\.mitti)\/logs\/[^/]+\.(?:jsonl|json|log)$/i.test(normalized) ||
    /(?:^|\/)logs$/i.test(normalized) ||
    /(?:^|\/)logs\/[^/]+\.(?:jsonl|json|log)$/i.test(normalized);
}

export function isMcpFilesystemReadTool(toolName: string): boolean {
  if (!toolName.startsWith('mcp__filesystem__')) return false;
  return !MCP_FILESYSTEM_WRITE.test(toolName);
}

export function isMcpFilesystemWriteTool(toolName: string): boolean {
  return MCP_FILESYSTEM_WRITE.test(toolName);
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
