/**
 * MCP attach public surface.
 *
 * Prefer `McpAttachPipeline` for new call sites.
 * Free functions stay exported for engine/SDK during the rewrite.
 */

export { McpAttachPipeline } from "./flow/McpAttachPipeline";
export type {
  McpAttachPipelineDependencies,
  ResolveAttachListInput,
  ResolveAttachListResult,
} from "./flow/McpAttachPipeline";

export {
  MAX_REQUIRED_MCP_SERVERS,
  MCP_TOOL_NAME_PREFIX,
  MCP_MENTION_PATTERN,
  MCP_ATTACH_STAGES,
  MCP_ATTACH_INSTRUCTION,
} from "./constants";
export type { McpAttachStageName } from "./constants";

export {
  normalizeMcpServerId,
  parseRequiredMcpMentions,
  mergeRequiredMcpServerIds,
  mcpServerIdFromToolName,
  isMcpToolAttached,
  filterToolsByMcpAttach,
  withMcpAttachOnGrant,
  formatMcpAttachInstruction,
} from "./flow/steps";
export type { ParseRequiredMcpMentionsResult } from "./flow/steps";

export {
  mcpAttachInstructionSchema,
  noopModuleLogger,
} from "./contracts";
export type {
  McpAttachInstruction,
  ModuleLoggerPort,
} from "./contracts";
