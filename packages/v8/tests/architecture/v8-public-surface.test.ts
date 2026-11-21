import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  engineRoot,
  modulesRoot,
  PUBLIC_ROOTS,
  toRepoPath,
  v8SrcRoot,
} from './support/v8Sources';

function readIndex(root: string): string {
  return readFileSync(join(root, 'index.ts'), 'utf8');
}

describe('v8 public surface', () => {
  it('exposes public facades from packages/v8/src/index.ts', () => {
    const index = readFileSync(join(v8SrcRoot, 'index.ts'), 'utf8');
    for (const symbol of [
      'RequestIntakePipeline',
      'UserRequestEnvelopeBuilder',
      'createUserRequestInputSchema',
      'RequestUnderstandingPipeline',
      'WorkspaceIndexingPipeline',
      'createWorkspaceIndexRuntime',
      'createWorkspaceRetrievalRuntime',
      'RepositoryStatePipeline',
      'repositoryStateReferenceSchema',
      'RepositoryContextPipeline',
      'repositoryContextPipelineInputSchema',
      'DecisionPolicyPipeline',
      'decisionPolicyInputSchema',
      'executionDecisionSchema',
      'PromptConstructionPipeline',
      'promptConstructionInputSchema',
      'promptConstructionResultSchema',
      'EchoLlmPort',
      'OpenAiCompatibleLlmPort',
      'AnthropicLlmPort',
      'GeminiLlmPort',
      'MODEL_PROVIDER_SUPPORT',
      'LanguageProfileRegistry',
      'ToolRuntimePipeline',
      'toolInvocationInputSchema',
      'toolResultSchema',
      'VerificationPipeline',
      'verificationInputSchema',
      'verificationResultSchema',
      'verificationRecordSchema',
      'ReviewPipeline',
      'reviewInputSchema',
      'reviewRecordSchema',
      'AgentEnginePipeline',
      'agentEngineStartInputSchema',
      'agentRunResultSchema',
      'runEventSchema',
      'composeReadOnlyAgentEngine',
      'SkillsPipeline',
      'skillsSelectInputSchema',
      'MemoryPipeline',
      'memoryRetrieveInputSchema',
      'memoryFactSchema',
      'CodeNavigationPipeline',
      'codeNavigationInputSchema',
      'TaskListPipeline',
      'taskListSchema',
    ]) {
      expect(index, `missing public export ${symbol}`).toContain(symbol);
    }
    expect(index).not.toContain('buildPublishCandidateFromIndexing');
    expect(index).not.toContain('IntentRouter');
    expect(index).not.toContain('TaskAnalyzer');
    expect(index).not.toContain('resolveRoute');
    expect(index).not.toContain('export *');
  });

  const PRIVATE_SYMBOLS: ReadonlyArray<{
    readonly label: string;
    readonly root: string;
    readonly public: readonly string[];
    readonly private: readonly string[];
  }> = [
    {
      label: 'v8-engine',
      root: join(engineRoot, 'v8-engine'),
      public: ['V8EnginePipeline', 'AgentEnginePipeline', 'agentRunResultSchema'],
      private: ['assembleToolCalls', 'runModelToolLoop'],
    },
    {
      label: 'verification',
      root: join(modulesRoot, 'verification'),
      public: [
        'VerificationPipeline',
        'verificationResultSchema',
        'verificationRecordSchema',
      ],
      private: [
        'mapAffectedProjects',
        'discoverApplicableChecks',
        'recommendCompletion',
      ],
    },
    {
      label: 'tool-runtime',
      root: join(engineRoot, 'tool-runtime'),
      public: ['ToolRuntimePipeline', 'toolResultSchema'],
      private: ['validateToolAgainstGrant', 'executeReadFile'],
    },
    {
      label: 'request-understanding',
      root: join(modulesRoot, 'request-understanding'),
      public: ['RequestUnderstandingPipeline'],
      private: [
        'RuleIntentClassifier',
        'LlmIntentClassifier',
        'export { IntentRouter',
        'export { TaskAnalyzer',
      ],
    },
    {
      label: 'prompt-construction',
      root: join(modulesRoot, 'prompt-construction'),
      public: ['PromptConstructionPipeline', 'promptConstructionResultSchema'],
      private: ['allocateBudget', 'serializeRepositoryContext'],
    },
    {
      label: 'skills',
      root: join(modulesRoot, 'skills'),
      public: ['SkillsPipeline', 'skillsSelectResultSchema'],
      private: ['matchSkills', 'applySkillBudget'],
    },
    {
      label: 'memory',
      root: join(modulesRoot, 'memory'),
      public: ['MemoryPipeline', 'memoryRetrieveResultSchema'],
      private: ['scoreMemoryRelevance', 'prepareMemoryCommit'],
    },
    {
      label: 'task-list',
      root: join(modulesRoot, 'task-list'),
      public: ['TaskListPipeline', 'taskListSchema'],
      private: ['applyTaskListUpdate', 'deriveTaskListFromPlan'],
    },
    {
      label: 'decision-policy',
      root: join(modulesRoot, 'decision-policy'),
      public: ['DecisionPolicyPipeline', 'executionDecisionSchema'],
      private: ['resolveRoute', 'buildToolGrant', 'scanPromptInjection'],
    },
  ];

  it.each(PRIVATE_SYMBOLS)(
    'keeps $label actions private at the module root',
    ({ root, public: publicSymbols, private: privateSymbols }) => {
      const index = readIndex(root);
      for (const symbol of publicSymbols) expect(index).toContain(symbol);
      expect(index).not.toContain('export * from "./actions"');
      for (const symbol of privateSymbols) expect(index).not.toContain(symbol);
    },
  );

  it('keeps v8-engine from re-exporting its actions barrel', () => {
    expect(readIndex(join(engineRoot, 'v8-engine'))).not.toContain(
      'export * from "./actions"',
    );
  });

  it('keeps module root barrels free of wildcard re-exports', () => {
    const violations: string[] = [];
    for (const { root } of PUBLIC_ROOTS) {
      const indexPath = join(root, 'index.ts');
      for (const [index, line] of readFileSync(indexPath, 'utf8')
        .split(/\r?\n/)
        .entries()) {
        if (/^\s*export\s+\*/.test(line)) {
          violations.push(`${toRepoPath(indexPath)}:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps module root barrels free of value exports from internal/ and actions/', () => {
    const violations: string[] = [];
    for (const { root } of PUBLIC_ROOTS) {
      const indexPath = join(root, 'index.ts');
      for (const [index, line] of readFileSync(indexPath, 'utf8')
        .split(/\r?\n/)
        .entries()) {
        // Type-only re-exports may surface public types owned beside actions.
        if (!/^\s*export\s+/.test(line) || /^\s*export\s+type\s+/.test(line)) {
          continue;
        }
        if (/from\s+['"]\.\/(?:internal|actions)(?:\/|['"]|$)/.test(line)) {
          violations.push(`${toRepoPath(indexPath)}:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
