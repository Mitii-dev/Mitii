/** Known mutate / external tool ids — generic table, not fixture-specific. */
const MUTATE_TOOLS = new Set([
  "apply_patch",
  "write_file",
  "delete_file",
  "rename_file",
  "run_mutating_command",
]);

const EXTERNAL_TOOLS = new Set([
  "fetch_url",
  "http_request",
  "web_search",
]);

export type ToolEffectClass = "none" | "read" | "mutate" | "external";

/**
 * Classify a tool id into an effect class for grant checks.
 * Unknown tools default to read (deny still happens via allowedTools).
 */
export function classifyToolEffect(toolId: string): ToolEffectClass {
  if (MUTATE_TOOLS.has(toolId)) return "mutate";
  if (EXTERNAL_TOOLS.has(toolId)) return "external";
  return "read";
}
