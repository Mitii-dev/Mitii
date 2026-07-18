import type { AgentDepth } from '../config/agentDepth';

export interface SkillRuntimeContext {
  mode: 'ask' | 'plan' | 'agent' | 'review' | string;
  depth: AgentDepth | string;
  askDepth?: AgentDepth | string;
  planDepth?: AgentDepth | string;
  actDepth?: AgentDepth | string;
  model?: string;
  modelSource?: 'session' | 'mode' | 'global' | string;
}

export function formatSkillRuntimeContext(context?: SkillRuntimeContext | null): string {
  if (!context) return '';
  return [
    '## Runtime mode/depth contract',
    `- mode: ${context.mode}`,
    `- activeDepth: ${context.depth}`,
    context.askDepth ? `- askDepth: ${context.askDepth}` : '',
    context.planDepth ? `- planDepth: ${context.planDepth}` : '',
    context.actDepth ? `- agentDepth: ${context.actDepth}` : '',
    context.model ? `- model: ${context.model}` : '',
    context.modelSource ? `- modelSource: ${context.modelSource}` : '',
    '- Skills must follow the active mode and activeDepth above when choosing scope, step count, verification, and whether writes are allowed.',
  ].filter(Boolean).join('\n');
}
