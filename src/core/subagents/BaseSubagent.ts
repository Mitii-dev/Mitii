import { relative } from 'path';
import { AgentLoop } from '../runtime/AgentLoop';
import type { ChatMessage, LlmProvider } from '../llm/types';
import type { ToolDefinition } from '../llm/toolTypes';
import type { ToolExecutor, ToolExecutionResult, ToolExecuteContext } from '../safety/ToolExecutor';
import type { SubagentDefinition, SubagentRunInput } from './types';

export class BaseSubagent {
  constructor(private readonly definition: SubagentDefinition, private readonly toolExecutor: ToolExecutor) {}

  async run(provider: LlmProvider, input: SubagentRunInput, allTools: ToolDefinition[]): Promise<string> {
    if (this.definition.requiresScope && !input.scopeRoot && (!input.targetFiles || input.targetFiles.length === 0)) {
      return `${this.definition.displayName} subagent refused: explicit targetFiles or scopeRoot is required.`;
    }

    const tools = this.filterTools(allTools);
    const executor = this.definition.writable
      ? new ScopedSubagentExecutor(this.toolExecutor, input.scopeRoot, input.targetFiles)
      : new ReadOnlySubagentExecutor(this.toolExecutor, new Set(this.definition.allowedTools));
    const loop = new AgentLoop(executor as unknown as ToolExecutor, this.definition.maxSteps);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.definition.timeoutMs);
    input.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.definition, input.personaInstructions) },
      { role: 'user', content: buildUserPrompt(input) },
    ];

    try {
      const result = await loop.runToCompletion(provider, messages, tools, controller.signal, undefined, false, {
        maxSteps: this.definition.maxSteps,
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
      return allowed.has(name) && !denied.has(name) && !name.startsWith('mcp__');
    });
  }
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

function buildSystemPrompt(definition: SubagentDefinition, personaInstructions?: string): string {
  const persona = personaInstructions?.trim()
    ? `\n\nAdditional workspace/persona instructions:\n${personaInstructions.trim().slice(0, 1600)}`
    : '';
  return `${definition.systemPrompt}${persona}`;
}

function buildUserPrompt(input: SubagentRunInput): string {
  const parts = [`## Task\n${input.task}`];
  if (input.focus) parts.push(`## Focus\n${input.focus}`);
  if (input.scopeRoot) parts.push(`## Scope root\n${input.scopeRoot}`);
  if (input.targetFiles?.length) parts.push(`## Target files\n${input.targetFiles.join('\n')}`);
  if (input.commands?.length) parts.push(`## Commands\n${input.commands.join('\n')}`);
  return parts.join('\n\n');
}
