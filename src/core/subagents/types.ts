import type { LlmProvider } from '../llm/types';
import type { ToolDefinition } from '../llm/toolTypes';
import type { ToolExecutor } from '../safety/ToolExecutor';
import type { TierPolicy } from '../agentic/tierPolicy';
import type { SkillCatalogService } from '../skills/SkillCatalogService';

export type SubagentType = 'research' | 'implementer' | 'reviewer' | 'verifier' | string;
export type SubagentRisk = 'low' | 'medium' | 'high';

export interface SubagentDefinition {
  id: SubagentType;
  displayName: string;
  allowedTools: string[];
  deniedTools?: string[];
  systemPrompt: string;
  maxSteps: number;
  timeoutMs: number;
  writable: boolean;
  risk: SubagentRisk;
  requiresScope?: boolean;
}

export interface SubagentRunInput {
  task: string;
  focus?: string;
  targetFiles?: string[];
  scopeRoot?: string;
  commands?: string[];
  personaInstructions?: string;
  signal?: AbortSignal;
}

export interface SubagentRuntime {
  toolExecutor: ToolExecutor;
  getProvider: () => LlmProvider | undefined;
  getTools: () => ToolDefinition[];
  maxSteps?: number;
  timeoutMs?: number;
  enabledTypes?: string[];
  maxConcurrent?: number;
  workspace?: string;
  tierPolicy?: TierPolicy;
  skillCatalog?: SkillCatalogService;
}
