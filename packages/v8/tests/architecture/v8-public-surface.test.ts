import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  diffAgainstBaseline,
  engineRoot,
  modulesRoot,
  PUBLIC_ROOTS,
  readBaseline,
  toRepoPath,
  v8SrcRoot,
  WRITE_BASELINES,
  writeBaseline,
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
    const current = listPrivateFolderReexports();
    if (WRITE_BASELINES) {
      writeBaseline(PRIVATE_REEXPORT_BASELINE, current);
    }
    const baseline = readBaseline<string[]>(PRIVATE_REEXPORT_BASELINE, []);
    const { added, stale } = diffAgainstBaseline(current, baseline);
    expect(
      added,
      'new value re-exports from ./actions or ./internal (including multi-line export blocks)',
    ).toEqual([]);
    expect(
      stale,
      `re-exports removed; rerun with MITII_ARCH_WRITE_BASELINES=1 to shrink ${PRIVATE_REEXPORT_BASELINE}`,
    ).toEqual([]);
  });
});

const PRIVATE_REEXPORT_BASELINE = 'private-reexport-baseline.json';

/** Strip comments so brace walks are not confused by `{` / `}` inside them. */
function stripCommentsForScan(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Detect value (non-type) re-exports from `./actions` or `./internal`, including
 * multi-line `export { … } from "./actions"` forms that a line-start check misses.
 */
function listPrivateFolderReexports(): string[] {
  const violations: string[] = [];
  for (const { root } of PUBLIC_ROOTS) {
    const indexPath = join(root, 'index.ts');
    const text = stripCommentsForScan(readFileSync(indexPath, 'utf8'));
    const fromRe =
      /\}\s*from\s*['"](\.\/(?:internal|actions)(?:\/[^'"]*)?)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = fromRe.exec(text))) {
      const fromPath = match[1]!;
      const closeIdx = match.index;
      let depth = 0;
      let openIdx = -1;
      for (let i = closeIdx; i >= 0; i -= 1) {
        const ch = text[i];
        if (ch === '}') depth += 1;
        else if (ch === '{') {
          depth -= 1;
          if (depth === 0) {
            openIdx = i;
            break;
          }
        }
      }
      if (openIdx < 0) continue;
      const before = text.slice(0, openIdx).replace(/\s+$/, '');
      const exportMatch = before.match(/\bexport(\s+type)?$/);
      if (!exportMatch || exportMatch[1]) continue;
      const lineNo = text.slice(0, openIdx).split(/\n/).length;
      violations.push(`${toRepoPath(indexPath)}:${lineNo}:${fromPath}`);
    }
    const starRe =
      /\bexport\s+\*\s+from\s*['"](\.\/(?:internal|actions)(?:\/[^'"]*)?)['"]/g;
    while ((match = starRe.exec(text))) {
      const lineNo = text.slice(0, match.index).split(/\n/).length;
      violations.push(`${toRepoPath(indexPath)}:${lineNo}:${match[1]}`);
    }
  }
  return violations.sort();
}
