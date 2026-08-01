/**
 * Public tool-registration surface.
 * New tools register here (or via a custom ToolRegistry) — not in the pipeline.
 */
export {
  ToolRegistry,
} from "./internal/ToolRegistry";
export type {
  RegisteredTool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHandler,
} from "./internal/ToolRegistry";

export { defineTool } from "./internal/ToolCatalog";
export type { ToolDefinition } from "./internal/ToolCatalog";

export {
  toModelToolDefinition,
  listModelToolDefinitions,
} from "./internal/modelToolDefinitions";
export type { RuntimeModelToolDefinition } from "./internal/modelToolDefinitions";

export {
  createBuiltinToolRegistry,
  BUILTIN_TOOLS,
  listBuiltinModelToolDefinitions,
  listBuiltinReadOnlyModelToolDefinitions,
  listBuiltinMutationModelToolDefinitions,
} from "./actions/handlers";
