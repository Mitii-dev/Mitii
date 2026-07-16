import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../src/core/llm/types';
import type { ToolDefinition } from '../../src/core/llm/toolTypes';
import type { SkillCatalogService } from '../../src/core/skills/SkillCatalogService';

describe('Plan mode orchestration', () => {
  it('forces structured planning for non-trivial codebase questions', async () => {
    const { analyzeTask } = await import('../../src/core/runtime/TaskAnalyzer');

    const analysis = analyzeTask('How does authentication work in this repo?', 'plan');

    expect(analysis.shouldPlan).toBe(true);
    expect(analysis.shouldVerify).toBe(false);
    expect(analysis.summary).toContain('Plan mode');
  });

  it('keeps trivial general knowledge out of the planner', async () => {
    const { analyzeTask } = await import('../../src/core/runtime/TaskAnalyzer');

    const analysis = analyzeTask('What is a binary search tree?', 'plan');

    expect(analysis.shouldPlan).toBe(false);
    expect(analysis.shouldVerify).toBe(false);
  });

  it('prepares a scoped SDK-compatible plan boundary', async () => {
    const { PlanOrchestrator, createSdkCompatibilityNote } = await import('../../src/core/modes/plan/PlanOrchestrator');

    const prepared = PlanOrchestrator.prepare('Implement the SDK plan runner in packages/sdk', {
      configuredMaxSteps: 20,
      catalog: {
        workspaceRoot: '/repo',
        generatedAt: '2026-07-01T00:00:00.000Z',
        projects: [
          {
            id: 'packages-sdk',
            root: 'packages/sdk',
            name: '@mitii/sdk',
            type: 'lib',
            entryFiles: ['src/index.ts'],
            scripts: { test: 'vitest run' },
          },
          {
            id: 'apps-docs',
            root: 'apps/docs',
            name: 'docs',
            type: 'docs',
            entryFiles: ['docusaurus.config.ts'],
            scripts: { build: 'docusaurus build' },
          },
        ],
      },
    });

    expect(prepared.route.forcePlan).toBe(true);
    expect(prepared.route.intent).toBe('feature');
    expect(prepared.scope.status).toBe('matched');
    expect(prepared.scope.scopeRoot).toBe('packages/sdk');
    expect(prepared.promptContext).toContain('SDK/headless agent boundary');
    expect(createSdkCompatibilityNote()).toContain('Agent.plan()');
  });

  it('uses catalog-only skill discovery for lean Plan tiers', async () => {
    const { PlanOrchestrator } = await import('../../src/core/modes/plan/PlanOrchestrator');
    const prepared = PlanOrchestrator.prepare('Implement the SDK plan runner', {
      skillCatalog: createSkillCatalog({
        'using-agent-skills': '# Agent Skills\n\nFull playbook.',
        'planning-and-task-breakdown': '# Planning\n\nFull playbook.',
      }),
      tierPolicy: {
        skillInjection: 'catalog',
        maxSkillChars: 0,
        rulesMaxTotalChars: 6_000,
        rulesMaxCharsPerFile: 2_000,
      },
    });

    expect(prepared.skillPlaybookContext).toBe('');
    expect(prepared.appliedSkills).toEqual([]);
  });

  it('fully injects Plan skills within the tier budget', async () => {
    const { PlanOrchestrator } = await import('../../src/core/modes/plan/PlanOrchestrator');
    const prepared = PlanOrchestrator.prepare('Implement the SDK plan runner', {
      skillCatalog: createSkillCatalog({
        'using-agent-skills': '# Agent Skills\n\nShort playbook.',
        'planning-and-task-breakdown': '# Planning\n\n'.repeat(80),
      }),
      tierPolicy: {
        skillInjection: 'full',
        maxSkillChars: 180,
        rulesMaxTotalChars: 20_000,
        rulesMaxCharsPerFile: 5_000,
      },
    });

    expect(prepared.skillPlaybookContext).toContain('Planning skill playbooks');
    expect(prepared.appliedSkills).toEqual(['using-agent-skills']);
    expect(prepared.skillPlaybookContext).toContain('Short playbook');
    expect(prepared.skillPlaybookContext.match(/### Skill:/g)).toHaveLength(1);
  });

  it('filters Plan mode tools to planning capabilities with approval-gated mutators', async () => {
    const { filterPlanModeTools, PLAN_ALLOWED_TOOLS } = await import('../../src/core/modes/plan/planMode');
    const tools = [
      tool('read_file'),
      tool('search_batch'),
      tool('execute_workspace_script'),
      tool('write_file'),
      tool('apply_patch'),
      tool('memory_write'),
      tool('save_task_state'),
      tool('mcp__github__search'),
    ];

    const filtered = filterPlanModeTools(tools).map((t) => t.function.name);

    expect(PLAN_ALLOWED_TOOLS.has('read_file')).toBe(true);
    expect(PLAN_ALLOWED_TOOLS.has('write_file')).toBe(true);
    expect(PLAN_ALLOWED_TOOLS.has('apply_patch')).toBe(true);
    expect(filtered).toEqual([
      'read_file',
      'search_batch',
      'execute_workspace_script',
      'write_file',
      'apply_patch',
      'mcp__github__search',
    ]);
  });

  it('passes planning discovery into isolated plan compilation', async () => {
    const { PlanExecutor } = await import('../../src/core/runtime/PlanExecutor');
    const { analyzeTask } = await import('../../src/core/runtime/TaskAnalyzer');
    let capturedMessages: ChatMessage[] = [];
    const provider = {
      id: 'fake',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: false,
        supportsTools: false,
        supportsEmbeddings: false,
      },
      async *complete(input: { messages: ChatMessage[] }) {
        capturedMessages = input.messages;
        yield {
          content: `\`\`\`json
{
  "goal": "Improve planner",
  "assumptions": [],
  "steps": [
    {
      "id": "step-1",
      "title": "Inspect Existing Planner",
      "objective": "Confirm current planner boundaries",
      "tools": ["read_file"],
      "dependsOn": [],
      "successCriteria": ["Planner files are identified"],
      "files": ["src/core/runtime/PlanExecutor.ts"],
      "risk": "low",
      "phase": "diagnostics"
    },
    {
      "id": "step-2",
      "title": "Update Plan Compiler",
      "objective": "Use discovery facts in isolated compilation",
      "tools": ["apply_patch"],
      "dependsOn": ["step-1"],
      "successCriteria": ["Generated prompt contains discovery"],
      "files": ["src/core/plans/promptBuilder.ts"],
      "risk": "medium",
      "phase": "execute"
    }
  ],
  "requiredApprovals": []
}
\`\`\``,
        };
      },
    };
    const pack = {
      items: [
        {
          id: 'repo-map',
          source: 'repo-map',
          content: 'src/core/runtime/PlanExecutor.ts',
          score: 1,
          reason: 'repo map',
          tokenEstimate: 8,
        },
      ],
      totalTokens: 8,
      formatted: 'repo map',
      budgetLimit: 100,
      retrievedCount: 1,
      truncatedCount: 0,
      dropped: [],
    };
    const executor = new PlanExecutor({} as never, { save: () => 'plan-id' } as never);
    const discovery = 'DISCOVERY_SUMMARY: PlanExecutor.generatePlan currently uses isolated planning.';

    const plan = await executor.generatePlan(
      provider,
      'plan',
      pack,
      'Implement the planner fix',
      'Need the generated plan to use discovery.',
      discovery,
      analyzeTask('Implement the planner fix', 'plan'),
      'session-1',
      { useIsolatedPlanning: true }
    );

    expect(plan?.steps).toHaveLength(2);
    expect(capturedMessages.map((m) => m.content).join('\n')).toContain(discovery);
  });

  it('tells planning discovery to ask material clarifying questions before compiling', async () => {
    const { buildPlanningDiscoveryPrompt } = await import('../../src/core/plans/promptBuilder');
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: 'repo map',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };

    const messages = buildPlanningDiscoveryPrompt(
      'plan',
      pack,
      'Implement the settings workflow',
      {
        kind: 'implementation',
        complexity: 'medium',
        summary: 'Implementation task.',
      }
    );
    const prompt = messages.map((m) => m.content).join('\n');

    expect(prompt).toContain('Use ask_question when a missing user decision would materially change the plan');
    expect(prompt).toContain('call ask_question before producing DISCOVERY_SUMMARY');
  });

  it('returns a best-effort fallback in Plan mode when quality gate rejects a parsed plan', async () => {
    const { PlanExecutor } = await import('../../src/core/runtime/PlanExecutor');
    const provider = {
      id: 'fake',
      capabilities: {
        contextWindow: 8192,
        supportsStreaming: false,
        supportsTools: false,
        supportsEmbeddings: false,
      },
      async *complete() {
        yield {
          content: `\`\`\`json
{
  "goal": "Large refactor",
  "assumptions": [],
  "steps": [
    {
      "id": "step-1",
      "title": "Refactor Core Planner",
      "objective": "Make the planner better",
      "tools": ["read_file"],
      "successCriteria": ["Planner is understood"],
      "files": ["src/core/runtime/PlanExecutor.ts"],
      "risk": "medium",
      "phase": "diagnostics"
    }
  ],
  "requiredApprovals": []
}
\`\`\``,
        };
      },
    };
    const executor = new PlanExecutor({} as never, { save: () => 'plan-id' } as never);
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: '',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };

    const plan = await executor.generatePlan(
      provider,
      'plan',
      pack,
      'Refactor the planner across the entire codebase',
      'This is a broad refactor.',
      'Discovery found PlanExecutor and promptBuilder.',
      {
        kind: 'implementation',
        complexity: 'high',
        shouldPlan: true,
        shouldVerify: false,
        shouldUseSubagents: true,
        summary: 'High-complexity implementation task.',
      }
    );

    expect(plan?.steps).toHaveLength(1);
    expect(plan?.assumptions.join('\n')).toContain('Planning quality warning');
  });
});

function tool(name: string): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: name,
      parameters: {},
    },
  };
}

function createSkillCatalog(contents: Record<string, string>): SkillCatalogService {
  return {
    get(name: string) {
      const content = contents[name];
      if (!content) return undefined;
      return {
        entry: {
          name,
          description: `${name} description`,
          relPath: `.mitii/skills/${name}/SKILL.md`,
        },
        content,
      };
    },
  } as unknown as SkillCatalogService;
}
