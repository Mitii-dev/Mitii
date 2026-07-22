/** Canonical built-in tool identifiers shared across runtime, modes, and safety layers. */
export const ToolId = {
  ReadFile: 'read_file',
  ReadFiles: 'read_files',
  WriteFile: 'write_file',
  ApplyPatch: 'apply_patch',
  RunCommand: 'run_command',
  ExecuteWorkspaceScript: 'execute_workspace_script',
  Diagnostics: 'diagnostics',
  MemorySearch: 'memory_search',
  MemoryWrite: 'memory_write',
  UseSkill: 'use_skill',
  SpawnSubagent: 'spawn_subagent',
  SpawnResearchAgent: 'spawn_research_agent',
  FetchWeb: 'fetch_web',
  AskQuestion: 'ask_question',
  ProposeFileScope: 'propose_file_scope',
  GitDiff: 'git_diff',
} as const;

export type ToolIdValue = typeof ToolId[keyof typeof ToolId];

export const WORKSPACE_WRITE_TOOL_IDS = new Set<string>([
  ToolId.WriteFile,
  ToolId.ApplyPatch,
  ToolId.MemoryWrite,
]);

/** Plan-management tools the model must not call during direct agent execution. */
export const PLAN_CONTROL_TOOL_IDS = new Set([
  'mark_step_complete',
  'propose_plan_mutation',
]);

export const VERIFICATION_CAPABILITY_KEYS = new Set([
  'docs-build',
  'build',
  'compile',
  'test',
  'lint',
  'typecheck',
  'check',
  'verify',
  'validate',
  'doctor',
  'tsc',
  'eslint',
]);

export function isWorkspaceWriteTool(toolName: string): boolean {
  return WORKSPACE_WRITE_TOOL_IDS.has(toolName);
}

export function isPostEditVerificationKey(key: string): boolean {
  const capability = key.split(':', 1)[0];
  return VERIFICATION_CAPABILITY_KEYS.has(capability);
}
