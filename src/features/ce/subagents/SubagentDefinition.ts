import type { SubagentDefinition } from './types';
import { SUBAGENT_READ_TOOL_IDS } from '../tools/toolMetadata';
import { ToolId } from '../tools/toolIds';

const READ_TOOLS = [...SUBAGENT_READ_TOOL_IDS];

export const BUILTIN_SUBAGENTS: SubagentDefinition[] = [
  {
    id: 'research',
    displayName: 'Research',
    allowedTools: READ_TOOLS,
    deniedTools: [ToolId.WriteFile, ToolId.ApplyPatch, ToolId.MemoryWrite, ToolId.SpawnSubagent, ToolId.SpawnResearchAgent],
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
      ToolId.WriteFile,
      ToolId.ApplyPatch,
      ToolId.ExecuteWorkspaceScript,
      'search_script_catalog',
    ],
    deniedTools: [ToolId.SpawnSubagent, ToolId.SpawnResearchAgent, ToolId.MemoryWrite],
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
    deniedTools: [ToolId.WriteFile, ToolId.ApplyPatch, ToolId.MemoryWrite, ToolId.SpawnSubagent, ToolId.SpawnResearchAgent],
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
    allowedTools: [
      ToolId.RunCommand,
      ToolId.ReadFile,
      ToolId.ReadFiles,
      'list_files',
      'search',
      ToolId.Diagnostics,
      ToolId.ExecuteWorkspaceScript,
    ],
    deniedTools: [ToolId.WriteFile, ToolId.ApplyPatch, ToolId.MemoryWrite, ToolId.SpawnSubagent, ToolId.SpawnResearchAgent],
    writable: false,
    risk: 'medium',
    maxSteps: 6,
    timeoutMs: 180_000,
    systemPrompt: `You are a verification subagent.
Run the requested test, lint, typecheck, build, or diagnostic commands. Interpret failures without making edits.
Return pass/fail, key output excerpts, likely cause, and suggested fix surface in under 500 words.`,
  },
];
