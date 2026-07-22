import type { ToolDefinition } from '../../../../kernel/llm/toolTypes';
import {
  PLANNING_DISCOVERY_TOOL_IDS,
  PLAN_ALLOWED_TOOL_IDS,
  PLAN_GROUNDING_TOOL_IDS,
} from '../../tools/toolMetadata';
import { routePlanIntent } from './PlanIntentRouter';

/** @deprecated Use PLAN_ALLOWED_TOOL_IDS from toolMetadata. */
export const PLAN_ALLOWED_TOOLS = PLAN_ALLOWED_TOOL_IDS;

/** @deprecated Use PLANNING_DISCOVERY_TOOL_IDS from toolMetadata. */
export { PLANNING_DISCOVERY_TOOL_IDS as PLANNING_DISCOVERY_TOOLS };

const PLAN_GROUNDING_TOOLS = PLAN_GROUNDING_TOOL_IDS;

export function filterPlanModeTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.filter((tool) => isPlanAllowedTool(tool.function.name));
}

export function isPlanAllowedTool(toolName: string): boolean {
  return PLAN_ALLOWED_TOOL_IDS.has(toolName) || isPlanAllowedMcpReadTool(toolName);
}

export function needsPlanGrounding(userMessage: string): boolean {
  return routePlanIntent(userMessage).groundingRequired;
}

export function isPlanGroundingToolCall(toolName: string): boolean {
  return PLAN_GROUNDING_TOOLS.has(toolName) || isPlanGroundingMcpReadTool(toolName);
}

export function isPlanAllowedMcpReadTool(toolName: string): boolean {
  return PLAN_ALLOWED_MCP_READ_TOOL_PATTERNS.some((pattern) => pattern.test(toolName));
}

export function isPlanGroundingMcpReadTool(toolName: string): boolean {
  return PLAN_GROUNDING_MCP_READ_TOOL_PATTERNS.some((pattern) => pattern.test(toolName));
}

const PLAN_ALLOWED_MCP_READ_TOOL_PATTERNS = [
  /^mcp__filesystem__(?:read_text_file|read_multiple_files|read_media_file|read_file|list_directory|directory_tree|search_files|get_file_info|list_allowed_directories)$/i,
  /^mcp__(?:memory|agentmemory)__(?:search|retrieve|lookup|query)$/i,
  /^mcp__github__(?:search|search_code|get_file_contents|get_repository|get_issue|get_pull_request|list_issues|list_pull_requests)$/i,
];

const PLAN_GROUNDING_MCP_READ_TOOL_PATTERNS = [
  /^mcp__filesystem__(?:read_text_file|read_multiple_files|read_file|list_directory|directory_tree|search_files|get_file_info)$/i,
  /^mcp__github__(?:search_code|get_file_contents|get_repository)$/i,
];

export const PLAN_SYNTHESIS_NUDGE = `Read-only discovery for this Plan-mode turn is complete.

Output a concise DISCOVERY_SUMMARY NOW in plain text:
- Key facts, relevant file paths, risks, and verification commands.
- Note which planning skill workflows apply.
- Do NOT call any more tools in this turn.
- The orchestrator will compile the structured plan from your summary.`;

export const NO_TOOLS_PLAN_NUDGE = `You are in Plan mode and answered without reading or searching the codebase. Plan mode MUST be grounded before compiling steps.

In this turn, call at least one read-only discovery tool:
- use_skill — load documentation, planning-and-task-breakdown, or another deferred skill when playbooks are not pre-loaded
- Prefer builtin read tools; MCP filesystem duplicates are usually excluded
- read_file / read_files — inspect specific files
- search / search_batch — find symbols, routes, or patterns
- retrieve_context / repo_map / project_catalog — widen project context
- diagnostics / git_diff — inspect current problems or changes when relevant

Then produce a concrete plan with goal, assumptions, files, steps, risks, and verification. Do NOT write files in Plan mode.`;
