import type { SubagentDefinition } from './types';

const READ_TOOLS = [
  'read_file',
  'read_files',
  'list_files',
  'search',
  'search_batch',
  'repo_map',
  'retrieve_context',
  'git_diff',
  'diagnostics',
  'memory_search',
  'run_command',
];

export const BUILTIN_SUBAGENTS: SubagentDefinition[] = [
  {
    id: 'research',
    displayName: 'Research',
    allowedTools: READ_TOOLS,
    deniedTools: ['write_file', 'apply_patch', 'memory_write', 'spawn_subagent', 'spawn_research_agent'],
    writable: false,
    risk: 'low',
    maxSteps: 6,
    timeoutMs: 90_000,
    systemPrompt: `You are a read-only research subagent. Investigate ONLY the assigned task.
Use batched reads/searches when possible. Complete quickly and return a concise report with findings, file paths, and confidence.
Do NOT edit files or explore unrelated areas.`,
  },
  {
    id: 'implementer',
    displayName: 'Implementer',
    allowedTools: [
      ...READ_TOOLS,
      'write_file',
      'apply_patch',
      'execute_workspace_script',
      'search_script_catalog',
    ],
    deniedTools: ['spawn_subagent', 'spawn_research_agent', 'memory_write'],
    writable: true,
    risk: 'high',
    maxSteps: 8,
    timeoutMs: 120_000,
    requiresScope: true,
    systemPrompt: `You are a scoped implementation subagent.
Implement ONLY the assigned scope. Do not refactor unrelated code. Before writing, confirm the target files or scope root.
Run diagnostics or targeted verification after edits. Return summary, files changed, and verification output.`,
  },
  {
    id: 'reviewer',
    displayName: 'Reviewer',
    allowedTools: [...READ_TOOLS, 'analyze_change_impact'],
    deniedTools: ['write_file', 'apply_patch', 'memory_write', 'spawn_subagent', 'spawn_research_agent'],
    writable: false,
    risk: 'low',
    maxSteps: 8,
    timeoutMs: 120_000,
    systemPrompt: `You are a read-only reviewer subagent.
Review the requested task or diff for bugs, regressions, missing tests, and maintainability risks.
Return structured sections: Critical, Major, Minor, Suggestions. Include file paths and evidence.`,
  },
  {
    id: 'verifier',
    displayName: 'Verifier',
    allowedTools: ['run_command', 'read_file', 'read_files', 'list_files', 'search', 'diagnostics', 'execute_workspace_script'],
    deniedTools: ['write_file', 'apply_patch', 'memory_write', 'spawn_subagent', 'spawn_research_agent'],
    writable: false,
    risk: 'medium',
    maxSteps: 6,
    timeoutMs: 180_000,
    systemPrompt: `You are a verification subagent.
Run the requested test, lint, typecheck, build, or diagnostic commands. Interpret failures without making edits.
Return pass/fail, key output excerpts, likely cause, and suggested fix surface in under 500 words.`,
  },
];
