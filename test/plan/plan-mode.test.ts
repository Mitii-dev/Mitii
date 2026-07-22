import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../src/kernel/llm/types';
import type { ToolDefinition } from '../../src/kernel/llm/toolTypes';
import type { SkillCatalogService } from '../../src/features/ce/skills/SkillCatalogService';

describe('Plan mode orchestration', () => {
  it('forces structured planning for non-trivial codebase questions', async () => {
    const { analyzeTask } = await import('../../src/features/ce/runtime/TaskAnalyzer');

    const analysis = analyzeTask('How does authentication work in this repo?', 'plan');

    expect(analysis.shouldPlan).toBe(true);
    expect(analysis.shouldVerify).toBe(false);
    expect(analysis.summary).toContain('Plan mode');
  });

  it('keeps trivial general knowledge out of the planner', async () => {
    const { analyzeTask } = await import('../../src/features/ce/runtime/TaskAnalyzer');

    const analysis = analyzeTask('What is a binary search tree?', 'plan');

    expect(analysis.shouldPlan).toBe(false);
    expect(analysis.shouldVerify).toBe(false);
  });

  it('prepares a scoped SDK-compatible plan boundary', async () => {
    const { PlanOrchestrator, createSdkCompatibilityNote } = await import('../../src/features/ce/modes/plan/PlanOrchestrator');

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
    const { PlanOrchestrator } = await import('../../src/features/ce/modes/plan/PlanOrchestrator');
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
    const { PlanOrchestrator } = await import('../../src/features/ce/modes/plan/PlanOrchestrator');
    const prepared = PlanOrchestrator.prepare('Implement the SDK plan runner', {
      skillCatalog: createSkillCatalog({
        'using-agent-skills': '# Agent Skills\n\nShort playbook.',
        'planning-and-task-breakdown': '# Planning\n\nShort planning playbook.',
        'agent-plan': '# Agent Plan\n\n'.repeat(80),
      }),
      tierPolicy: {
        skillInjection: 'full',
        maxSkillChars: 180,
        rulesMaxTotalChars: 20_000,
        rulesMaxCharsPerFile: 5_000,
      },
    });

    expect(prepared.skillPlaybookContext).toContain('Planning skill playbooks');
    expect(prepared.appliedSkills).toEqual(['planning-and-task-breakdown']);
    expect(prepared.skillPlaybookContext).toContain('Short planning playbook');
    expect(prepared.skillPlaybookContext.match(/### Skill:/g)).toHaveLength(1);
  });

  it('filters Plan mode tools to read-only planning capabilities', async () => {
    const { filterPlanModeTools, PLAN_ALLOWED_TOOLS } = await import('../../src/features/ce/modes/plan/planMode');
    const tools = [
      tool('read_file'),
      tool('search_batch'),
      tool('execute_workspace_script'),
      tool('write_file'),
      tool('apply_patch'),
      tool('memory_write'),
      tool('save_task_state'),
      tool('mcp__github__search'),
      tool('mcp__slack__post_message'),
      tool('mcp__filesystem__write_file'),
    ];

    const filtered = filterPlanModeTools(tools).map((t) => t.function.name);

    expect(PLAN_ALLOWED_TOOLS.has('read_file')).toBe(true);
    expect(PLAN_ALLOWED_TOOLS.has('write_file')).toBe(false);
    expect(PLAN_ALLOWED_TOOLS.has('apply_patch')).toBe(false);
    expect(filtered).toEqual([
      'read_file',
      'search_batch',
      'mcp__github__search',
    ]);
  });

  it('counts only repository-read MCP tools as Plan grounding', async () => {
    const { isPlanGroundingToolCall, isPlanAllowedTool } = await import('../../src/features/ce/modes/plan/planMode');

    expect(isPlanAllowedTool('mcp__github__search')).toBe(true);
    expect(isPlanGroundingToolCall('mcp__github__search')).toBe(false);
    expect(isPlanGroundingToolCall('mcp__github__search_code')).toBe(true);
    expect(isPlanGroundingToolCall('mcp__filesystem__read_text_file')).toBe(true);
    expect(isPlanAllowedTool('mcp__slack__search')).toBe(false);
    expect(isPlanGroundingToolCall('mcp__slack__search')).toBe(false);
  });

  it('passes planning discovery into isolated plan compilation', async () => {
    const { PlanExecutor } = await import('../../src/features/ce/runtime/PlanExecutor');
    const { analyzeTask } = await import('../../src/features/ce/runtime/TaskAnalyzer');
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

  it('marks duplicate reproduction steps done when discovery already captured the failing signal', async () => {
    const { PlanExecutor } = await import('../../src/features/ce/runtime/PlanExecutor');
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
  "goal": "Fix build",
  "assumptions": [],
  "steps": [
    {
      "id": "step-1",
      "title": "Reproduce build failure — capture initial failing signal",
      "objective": "Run pnpm run build and preserve current TypeScript errors",
      "tools": ["run_command"],
      "dependsOn": [],
      "successCriteria": ["Build output captured showing current errors"],
      "files": ["ai-service/package.json"],
      "risk": "low",
      "phase": "diagnostics"
    },
    {
      "id": "step-2",
      "title": "Diagnose captured TypeScript errors",
      "objective": "Read files from the captured TS errors and identify the root cause",
      "tools": ["read_file"],
      "dependsOn": ["step-1"],
      "successCriteria": ["Root cause is identified from captured build output"],
      "files": ["ai-service/src/features/document-parser/services/manual-resume-service.ts"],
      "risk": "low",
      "phase": "diagnostics"
    },
    {
      "id": "step-3",
      "title": "Apply minimal TypeScript fix",
      "objective": "Patch the confirmed type mismatch",
      "tools": ["apply_patch"],
      "dependsOn": ["step-2"],
      "successCriteria": ["Patch only touches the confirmed root cause"],
      "files": ["ai-service/src/features/document-parser/services/manual-resume-service.ts"],
      "risk": "medium",
      "phase": "execute"
    },
    {
      "id": "step-4",
      "title": "Verify build passes",
      "objective": "Rerun pnpm run build after the fix",
      "tools": ["run_command"],
      "dependsOn": ["step-3"],
      "successCriteria": ["pnpm run build exits successfully"],
      "files": ["ai-service/package.json"],
      "risk": "medium",
      "phase": "verify"
    }
  ],
  "requiredApprovals": []
}
\`\`\``,
        };
      },
    };
    const pack = {
      items: [],
      totalTokens: 0,
      formatted: '',
      budgetLimit: 100,
      retrievedCount: 0,
      truncatedCount: 0,
      dropped: [],
    };
    const executor = new PlanExecutor({} as never, { save: () => 'plan-id' } as never);
    const discovery = [
      'DISCOVERY_TOOL_EVIDENCE:',
      '- run_command (cd ai-service && pnpm run build) failed: Command failed with exit code 2',
      "src/features/document-parser/services/manual-resume-service.ts(415,25): error TS2339: Property 'subtitle' does not exist on type 'ResumeProject'.",
    ].join('\n');

    const userMessage =
      'Fix the failing build after a half implemented restructuring, restore the original structure, and verify ai-service';
    const plan = await executor.generatePlan(
      provider,
      'agent',
      pack,
      userMessage,
      'Need to repair the failing build.',
      discovery,
      {
        kind: 'implementation',
        complexity: 'medium',
        shouldPlan: true,
        shouldVerify: true,
        shouldUseSubagents: false,
        actIntent: 'bugfix',
        summary: 'Repository restoration bugfix — fix failing build after half implemented restructuring.',
      }
    );

    expect(plan?.steps[0].status).toBe('done');
    expect(plan?.steps[1].status).toBe('pending');
    expect(plan?.assumptions.join('\n')).toContain('skipped duplicate reproduction step step-1');
  });

  it('tells planning discovery to ask material clarifying questions before compiling', async () => {
    const { buildPlanningDiscoveryPrompt } = await import('../../src/features/ce/plans/promptBuilder');
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
    const { PlanExecutor } = await import('../../src/features/ce/runtime/PlanExecutor');
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
