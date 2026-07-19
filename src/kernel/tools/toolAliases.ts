/** Map hallucinated / legacy tool names to registered builtins. */
export const TOOL_NAME_ALIASES: Record<string, string> = {
  search_files: 'search',
  grep: 'search',
  ripgrep: 'search',
  rg: 'search',
  resolve_file: 'resolve_path',
  read_file_batch: 'read_files',
  read_files_batch: 'read_files',
  list_directory: 'list_files',
  list_dir: 'list_files',
  write: 'write_file',
  patch: 'apply_patch',
  shell: 'run_command',
  execute_command: 'run_command',
  run_terminal_cmd: 'run_command',
};

export function resolveToolName(name: string): string {
  const trimmed = name.trim();
  return TOOL_NAME_ALIASES[trimmed] ?? TOOL_NAME_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** Plan-management tools the model must not call during direct agent execution. */
export const DIRECT_AGENT_EXCLUDED_TOOLS = new Set([
  'mark_step_complete',
  'propose_plan_mutation',
]);

export function filterDirectAgentTools<T extends { function: { name: string } }>(tools: T[]): T[] {
  return tools.filter((tool) => !DIRECT_AGENT_EXCLUDED_TOOLS.has(tool.function.name));
}
