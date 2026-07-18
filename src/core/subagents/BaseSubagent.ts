import { relative } from 'path';
import { AgentLoop } from '../runtime/AgentLoop';
import type { ChatMessage, LlmProvider } from '../llm/types';
import type { ToolDefinition } from '../llm/toolTypes';
import type { ToolExecutor, ToolExecutionResult, ToolExecuteContext } from '../safety/ToolExecutor';
import type { TierPolicy } from '../agentic/tierPolicy';
import { scaleTierSteps } from '../agentic/tierPolicy';
import { ProjectRulesService } from '../rules/ProjectRulesService';
import type { SkillCatalogService } from '../skills/SkillCatalogService';
import { AGENT_NAME } from '../../shared/brand';
import { loadActSkillPlaybooks } from '../modes/agent/actSkillRouting';
import type { SubagentDefinition, SubagentRunInput } from './types';

export class BaseSubagent {
  constructor(
    private readonly definition: SubagentDefinition,
    private readonly toolExecutor: ToolExecutor,
    private readonly options: { tierPolicy?: TierPolicy; workspace?: string; skillCatalog?: SkillCatalogService } = {}
  ) {}

  async run(provider: LlmProvider, input: SubagentRunInput, allTools: ToolDefinition[]): Promise<string> {
    if (this.definition.requiresScope && !input.scopeRoot && (!input.targetFiles || input.targetFiles.length === 0)) {
      return `${this.definition.displayName} subagent refused: explicit targetFiles or scopeRoot is required.`;
    }

    const tools = this.filterTools(allTools);
    const maxSteps = scaleTierSteps(this.definition.maxSteps, this.options.tierPolicy, 50);
    const executor = this.definition.writable
      ? new ScopedSubagentExecutor(this.toolExecutor, input.scopeRoot, input.targetFiles)
      : new ReadOnlySubagentExecutor(this.toolExecutor, new Set(this.definition.allowedTools));
    const loop = new AgentLoop(executor as unknown as ToolExecutor, maxSteps);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.definition.timeoutMs);
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.definition, input.personaInstructions, this.buildTierContext()) },
      { role: 'user', content: buildUserPrompt(input) },
    ];

    try {
      const result = await loop.runToCompletion(provider, messages, tools, controller.signal, undefined, false, {
        maxSteps,
        reasoningEffort: this.options.tierPolicy?.reasoningEffort,
      });
      return result.fullContent || '(no subagent report)';
    } finally {
      clearTimeout(timer);
    }
  }

  private filterTools(allTools: ToolDefinition[]): ToolDefinition[] {
    const allowed = new Set(this.definition.allowedTools);
    const denied = new Set(this.definition.deniedTools ?? []);
    return allTools.filter((tool) => {
      const name = tool.function.name;
      if (!allowed.has(name) || denied.has(name)) return false;
      const exposure = this.options.tierPolicy?.toolExposure ?? 'standard';
      if (name.startsWith('mcp__') && exposure !== 'full') return false;
      if (exposure === 'minimal' && MINIMAL_SUBAGENT_EXCLUDED_TOOLS.has(name)) return false;
      return true;
    });
  }

  private buildTierContext(): string {
    const blocks: string[] = [];
    const policy = this.options.tierPolicy;
    if (this.options.workspace) {
      const rules = new ProjectRulesService(this.options.workspace)
        .load(policy?.rulesMaxCharsPerFile, policy?.rulesMaxTotalChars);
      if (rules.length > 0) {
        blocks.push([
          '## Project rules',
          ...rules.map((rule) => `### ${rule.relPath}\n${rule.content}`),
        ].join('\n\n'));
      }
    }

    if (this.options.skillCatalog && (policy?.skillInjection === 'quick-ref' || policy?.skillInjection === 'full')) {
      const loaded = loadActSkillPlaybooks(
        this.options.skillCatalog,
        resolveSubagentSkillNames(this.definition.id),
        {
          style: policy.skillInjection,
          maxChars: policy.maxSkillChars,
          runtimeContext: {
            mode: `agent:${this.definition.id}`,
            depth: 'auto',
          },
        }
      );
      if (loaded.context) blocks.push(loaded.context);
    } else if (policy?.skillInjection !== 'none' && this.options.skillCatalog) {
      const entries = this.options.skillCatalog.list();
      if (entries.length > 0) {
        blocks.push([
          `## Available ${AGENT_NAME} Skills`,
          'Use the use_skill tool only when one of these playbooks directly applies:',
          ...entries.map((entry) => `- ${entry.name}: ${entry.description} (${entry.relPath})`),
        ].join('\n'));
      }
    }
    return blocks.join('\n\n');
  }
}

const MINIMAL_SUBAGENT_EXCLUDED_TOOLS = new Set([
  'use_skill',
  'fetch_web',
  'memory_write',
  'save_task_state',
  'spawn_research_agent',
  'spawn_subagent',
]);

function resolveSubagentSkillNames(id: string): string[] {
  if (id === 'reviewer') return ['using-agent-skills', 'code-review-and-quality'];
  if (id === 'verifier') return ['using-agent-skills', 'test-driven-development'];
  if (id === 'implementer') return ['using-agent-skills', 'test-driven-development'];
  return ['using-agent-skills'];
}

class ReadOnlySubagentExecutor {
  constructor(private readonly inner: ToolExecutor, private readonly allowed: Set<string>) {}

  clearPlanPhaseLock(): void {
    this.inner.clearPlanPhaseLock?.();
  }

  execute(toolName: string, input: Record<string, unknown>, context?: ToolExecuteContext): Promise<ToolExecutionResult> {
    if (!this.allowed.has(toolName)) {
      return Promise.resolve({ success: false, output: '', error: `Tool ${toolName} is not allowed for this subagent` });
    }
    return this.inner.execute(toolName, input, { ...context, restrictRunCommandToReadOnly: true });
  }
}

class ScopedSubagentExecutor {
  constructor(
    private readonly inner: ToolExecutor,
    private readonly scopeRoot?: string,
    private readonly targetFiles?: string[]
  ) {}

  clearPlanPhaseLock(): void {
    this.inner.clearPlanPhaseLock?.();
  }

  execute(toolName: string, input: Record<string, unknown>, context?: ToolExecuteContext): Promise<ToolExecutionResult> {
    if ((toolName === 'write_file' || toolName === 'apply_patch') && !this.isPathInScope(input.path)) {
      return Promise.resolve({
        success: false,
        output: '',
        error: `Write blocked: ${String(input.path ?? '')} is outside the subagent scope`,
      });
    }
    return this.inner.execute(toolName, input, context);
  }

  private isPathInScope(path: unknown): boolean {
    if (typeof path !== 'string') return false;
    const normalized = path.replace(/\\/g, '/').replace(/^\.?\//, '');
    if (this.targetFiles?.some((target) => normalized === target.replace(/\\/g, '/').replace(/^\.?\//, ''))) {
      return true;
    }
    if (!this.scopeRoot) return false;
    const rel = relative(this.scopeRoot, normalized).replace(/\\/g, '/');
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
  }
}

function buildSystemPrompt(definition: SubagentDefinition, personaInstructions?: string, tierContext?: string): string {
  const persona = personaInstructions?.trim()
    ? `\n\nAdditional workspace/persona instructions:\n${personaInstructions.trim().slice(0, 1600)}`
    : '';
  const context = tierContext?.trim() ? `\n\n${tierContext.trim()}` : '';
  return `${definition.systemPrompt}${context}${persona}`;
}

function buildUserPrompt(input: SubagentRunInput): string {
  const parts = [`## Task\n${input.task}`];
  if (input.focus) parts.push(`## Focus\n${input.focus}`);
  if (input.scopeRoot) parts.push(`## Scope root\n${input.scopeRoot}`);
  if (input.targetFiles?.length) parts.push(`## Target files\n${input.targetFiles.join('\n')}`);
  if (input.commands?.length) parts.push(`## Commands\n${input.commands.join('\n')}`);
  return parts.join('\n\n');
}
