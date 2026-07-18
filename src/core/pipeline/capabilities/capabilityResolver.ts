import type { ToolExposure } from '../../agentic/tierPolicy';
import type { CapabilityResolution, McpPolicy, RouteResolution } from '../types';

export type CapabilityMode = 'ask' | 'plan' | 'agent' | 'review' | string;

/** Git / release / GitHub tools — only for git routes (or read-only git_status/diff when useful). */
export const GIT_WRITE_AND_RELEASE_TOOLS = [
  'git_stage_files',
  'git_unstage_files',
  'git_commit',
  'git_branch_create',
  'git_branch_switch',
  'git_branch_delete',
  'git_merge',
  'git_rebase',
  'git_tag_create',
  'git_tag_delete_local',
  'detect_changelog_strategy',
  'aggregate_changelog',
  'generate_changelog_patch',
  'release_plan_controller',
  'discover_github_workflows',
  'analyze_github_workflow',
  'github_dispatch_workflow',
  'github_get_workflow_run',
  'github_verify_repository',
  'github_draft_pull_request',
  'github_create_pull_request',
  'github_draft_issue',
  'github_find_duplicate_issues',
  'github_create_issue',
  'github_create_release',
] as const;

/** MCP filesystem tools that duplicate Mitii builtins. */
export const MCP_FILESYSTEM_TOOLS = [
  'mcp__filesystem__read_text_file',
  'mcp__filesystem__read_multiple_files',
  'mcp__filesystem__read_media_file',
  'mcp__filesystem__read_file',
  'mcp__filesystem__list_directory',
  'mcp__filesystem__directory_tree',
  'mcp__filesystem__search_files',
  'mcp__filesystem__get_file_info',
  'mcp__filesystem__list_allowed_directories',
  'mcp__filesystem__create_directory',
  'mcp__filesystem__move_file',
  'mcp__filesystem__write_file',
  'mcp__filesystem__edit_file',
] as const;

const PLAN_CONTROL_TOOLS = ['mark_step_complete', 'propose_plan_mutation'] as const;

export interface ResolveCapabilitiesOptions {
  mode: CapabilityMode;
  toolExposure?: ToolExposure;
  /** True when running inside PlanExecutor with phase locks (tools filtered elsewhere too). */
  planExecution?: boolean;
  supportsTools?: boolean;
}

function mcpPolicyFor(route: RouteResolution, toolExposure?: ToolExposure): McpPolicy {
  if (route.intent === 'log_audit' || route.executionPath === 'log_audit') return 'none';
  if (toolExposure && toolExposure !== 'full') return 'none';
  // Local workspace work: keep MCP servers that aren't filesystem duplicates.
  return 'no_filesystem';
}

/**
 * Exact tool / MCP / approval policy for this turn.
 * Provider `supportsTools` stays a separate binary gate in ChatOrchestrator.
 */
export function resolveCapabilities(
  route: RouteResolution,
  options: ResolveCapabilitiesOptions
): CapabilityResolution {
  const excluded = new Set<string>();
  const mcpPolicy = mcpPolicyFor(route, options.toolExposure);
  const preferBuiltinFilesystem = true;

  if (mcpPolicy === 'none') {
    // Caller strips all mcp__*
  } else if (mcpPolicy === 'no_filesystem' || preferBuiltinFilesystem) {
    for (const name of MCP_FILESYSTEM_TOOLS) excluded.add(name);
  }

  // Never expose release/git-write tools on non-git routes (docs README bug).
  if (!route.isGitTask || route.operationClass === 'edit' || route.operationClass === 'read') {
    if (route.operationClass !== 'git_write' && route.operationClass !== 'release') {
      for (const name of GIT_WRITE_AND_RELEASE_TOOLS) excluded.add(name);
    }
  }

  if (route.operationClass === 'release') {
    // release path keeps release tools; still hide unrelated github issue tools? keep allow-all git set via git intents
  } else if (route.isGitTask && route.operationClass === 'read') {
    for (const name of GIT_WRITE_AND_RELEASE_TOOLS) excluded.add(name);
  }

  // Direct Act loop: plan-control tools are not available (phase orchestrator advances steps).
  if (options.mode === 'agent' && !options.planExecution) {
    for (const name of PLAN_CONTROL_TOOLS) excluded.add(name);
  }

  // mark_step_complete is orchestrator-owned during plan execution — hide from model to avoid
  // "tool not available" loops (prompt must not advertise it either).
  if (options.planExecution) {
    excluded.add('mark_step_complete');
    excluded.add('propose_plan_mutation');
    // Extra safety: release controller must never appear mid plan unless release op.
    if (route.operationClass !== 'release') {
      excluded.add('release_plan_controller');
    }
  }

  let approvalProfile: CapabilityResolution['approvalProfile'] = 'default';
  if (route.operationClass === 'release') approvalProfile = 'release';
  else if (route.operationClass === 'git_write') approvalProfile = 'git';
  else if (options.mode === 'ask' || options.mode === 'plan') approvalProfile = 'read_only';

  return {
    excludedTools: excluded,
    mcpPolicy,
    preferBuiltinFilesystem,
    maxProposeFileScopePerStep: route.intent === 'docs' ? 3 : 6,
    approvalProfile,
  };
}

export function filterToolsByCapabilities<T extends { function: { name: string } }>(
  tools: T[],
  capabilities: CapabilityResolution
): T[] {
  return tools.filter((tool) => {
    const name = tool.function.name;
    if (capabilities.excludedTools.has(name)) return false;
    if (capabilities.mcpPolicy === 'none' && name.startsWith('mcp__')) return false;
    if (capabilities.allowedTools && !capabilities.allowedTools.has(name)) return false;
    return true;
  });
}
