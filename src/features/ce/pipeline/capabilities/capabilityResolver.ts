import type { ToolExposure } from '../../../../kernel/policy/tierPolicy';
import type { CapabilityResolution, McpPolicy, RouteResolution } from '../types';
import { PLAN_CONTROL_TOOL_IDS } from '../../tools/toolIds';
import {
  GIT_READ_TOOL_IDS,
  GIT_WRITE_TOOL_IDS,
  MCP_FILESYSTEM_TOOL_IDS,
  RELEASE_TOOL_IDS,
} from '../../tools/toolMetadata';

export type CapabilityMode = 'ask' | 'plan' | 'agent' | 'review' | string;

/** @deprecated Use GIT_READ_TOOL_IDS from toolMetadata. */
export const GIT_READ_TOOLS = GIT_READ_TOOL_IDS;

/** @deprecated Use GIT_WRITE_TOOL_IDS from toolMetadata. */
export const GIT_WRITE_TOOLS = GIT_WRITE_TOOL_IDS;

/** @deprecated Use RELEASE_TOOL_IDS from toolMetadata. */
export const RELEASE_TOOLS = RELEASE_TOOL_IDS;

/** @deprecated Kept for external callers; now correctly write/release-only (no longer includes read tools). */
export const GIT_WRITE_AND_RELEASE_TOOLS = [...GIT_WRITE_TOOL_IDS, ...RELEASE_TOOL_IDS] as const;

/** @deprecated Use MCP_FILESYSTEM_TOOL_IDS from toolMetadata. */
export const MCP_FILESYSTEM_TOOLS = MCP_FILESYSTEM_TOOL_IDS;

const PLAN_CONTROL_TOOLS = [...PLAN_CONTROL_TOOL_IDS] as const;

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
  if (options.supportsTools === false) {
    return {
      excludedTools: new Set(),
      mcpPolicy: 'none',
      preferBuiltinFilesystem: true,
      maxProposeFileScopePerStep: 0,
      approvalProfile: 'read_only',
    };
  }

  const excluded = new Set<string>();
  const mcpPolicy = mcpPolicyFor(route, options.toolExposure);
  const preferBuiltinFilesystem = true;

  if (mcpPolicy === 'none') {
    // Caller strips all mcp__*
  } else if (mcpPolicy === 'no_filesystem' || preferBuiltinFilesystem) {
    for (const name of MCP_FILESYSTEM_TOOL_IDS) excluded.add(name);
  }

  const allowsGitWrite =
    route.isGitTask &&
    (route.operationClass === 'local_git_write' ||
      route.operationClass === 'remote_write' ||
      route.operationClass === 'release');
  if (!allowsGitWrite) {
    for (const name of GIT_WRITE_TOOL_IDS) excluded.add(name);
    for (const name of RELEASE_TOOL_IDS) excluded.add(name);
  }
  if (!route.isGitTask) {
    for (const name of GIT_READ_TOOL_IDS) excluded.add(name);
  }

  if (options.mode === 'agent' && !options.planExecution) {
    for (const name of PLAN_CONTROL_TOOLS) excluded.add(name);
  }

  if (options.planExecution) {
    excluded.add('mark_step_complete');
    excluded.add('propose_plan_mutation');
    if (route.operationClass !== 'release') {
      excluded.add('release_plan_controller');
    }
  }

  let approvalProfile: CapabilityResolution['approvalProfile'] = 'default';
  if (route.operationClass === 'release') approvalProfile = 'release';
  else if (route.operationClass === 'local_git_write' || route.operationClass === 'remote_write') approvalProfile = 'git';
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
