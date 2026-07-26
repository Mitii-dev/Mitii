import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const modulesRoot = join(repoRoot, 'src/v8/modules');

const PUBLIC_MODULES = [
  'request-intake',
  'request-understanding',
  'repository-state',
  'repository-context',
  'decision-policy',
  'prompt-construction',
  'model-gateway',
  'tool-runtime',
  'verification',
  'agent-engine',
] as const;

describe('v8 module boundaries (Phase 0/1/2/3/4/5/6/7)', () => {
  it('places all runtime code under src/v8/modules/', () => {
    expect(existsSync(modulesRoot)).toBe(true);
    expect(existsSync(join(repoRoot, 'src/v8/core'))).toBe(false);
    expect(existsSync(join(repoRoot, 'src/v8/repository'))).toBe(false);
    expect(existsSync(join(repoRoot, 'src/v8/intent'))).toBe(false);
  });

  it('exposes Phase 1 public facades from src/v8/index.ts', () => {
    const index = readFileSync(join(repoRoot, 'src/v8/index.ts'), 'utf8');
    expect(index).toContain('RequestIntakePipeline');
    expect(index).toContain('UserRequestEnvelopeBuilder');
    expect(index).toContain('RequestUnderstandingPipeline');
    expect(index).toContain('WorkspaceIndexingPipeline');
    expect(index).toContain('RepositoryStatePipeline');
    expect(index).toContain('repositoryStateReferenceSchema');
    expect(index).toContain('RepositoryContextPipeline');
    expect(index).toContain('repositoryContextPipelineInputSchema');
    expect(index).not.toContain('buildPublishCandidateFromIndexing');
    expect(index).toContain('DecisionPolicyPipeline');
    expect(index).toContain('decisionPolicyInputSchema');
    expect(index).toContain('executionDecisionSchema');
    expect(index).toContain('PromptConstructionPipeline');
    expect(index).toContain('promptConstructionInputSchema');
    expect(index).toContain('promptConstructionResultSchema');
    expect(index).toContain('EchoLlmPort');
    expect(index).toContain('OpenAiCompatibleLlmPort');
    expect(index).toContain('MODEL_PROVIDER_SUPPORT');
    expect(index).toContain('LanguageProfileRegistry');
    expect(index).toContain('ToolRuntimePipeline');
    expect(index).toContain('toolInvocationInputSchema');
    expect(index).toContain('toolResultSchema');
    expect(index).toContain('VerificationPipeline');
    expect(index).toContain('verificationInputSchema');
    expect(index).toContain('verificationResultSchema');
    expect(index).toContain('AgentEnginePipeline');
    expect(index).toContain('agentEngineStartInputSchema');
    expect(index).toContain('agentRunResultSchema');
    expect(index).toContain('runEventSchema');
    expect(index).toContain('composeReadOnlyAgentEngine');
    expect(index).not.toContain('IntentRouter');
    expect(index).not.toContain('TaskAnalyzer');
    expect(index).not.toContain('resolveRoute');
    expect(index).not.toContain('export *');
  });

  it('keeps agent-engine actions private at the module root', () => {
    const index = readFileSync(
      join(modulesRoot, 'agent-engine/index.ts'),
      'utf8',
    );
    expect(index).toContain('AgentEnginePipeline');
    expect(index).toContain('agentRunResultSchema');
    expect(index).not.toContain('export * from "./actions"');
    expect(index).not.toContain('assembleToolCalls');
    expect(index).not.toContain('runModelToolLoop');
  });

  it('keeps verification actions private at the module root', () => {
    const index = readFileSync(
      join(modulesRoot, 'verification/index.ts'),
      'utf8',
    );
    expect(index).toContain('VerificationPipeline');
    expect(index).toContain('verificationResultSchema');
    expect(index).not.toContain('export * from "./actions"');
    expect(index).not.toContain('mapAffectedProjects');
    expect(index).not.toContain('discoverApplicableChecks');
    expect(index).not.toContain('recommendCompletion');
  });

  it('keeps tool-runtime actions private at the module root', () => {
    const index = readFileSync(
      join(modulesRoot, 'tool-runtime/index.ts'),
      'utf8',
    );
    expect(index).toContain('ToolRuntimePipeline');
    expect(index).toContain('toolResultSchema');
    expect(index).not.toContain('export * from "./actions"');
    expect(index).not.toContain('validateToolAgainstGrant');
    expect(index).not.toContain('executeReadFile');
  });

  it('keeps request-understanding classifiers private at the module root', () => {
    const index = readFileSync(
      join(modulesRoot, 'request-understanding/index.ts'),
      'utf8',
    );
    expect(index).toContain('RequestUnderstandingPipeline');
    expect(index).not.toContain('export * from "./intent"');
    expect(index).not.toContain('RuleIntentClassifier');
    expect(index).not.toContain('LlmIntentClassifier');
    expect(index).not.toContain('export { IntentRouter');
    expect(index).not.toContain('export { TaskAnalyzer');
  });

  it('keeps prompt-construction actions private at the module root', () => {
    const index = readFileSync(
      join(modulesRoot, 'prompt-construction/index.ts'),
      'utf8',
    );
    expect(index).toContain('PromptConstructionPipeline');
    expect(index).toContain('promptConstructionResultSchema');
    expect(index).not.toContain('export * from "./actions"');
    expect(index).not.toContain('allocateBudget');
    expect(index).not.toContain('serializeRepositoryContext');
  });

  it('keeps decision-policy actions private at the module root', () => {
    const index = readFileSync(
      join(modulesRoot, 'decision-policy/index.ts'),
      'utf8',
    );
    expect(index).toContain('DecisionPolicyPipeline');
    expect(index).toContain('executionDecisionSchema');
    expect(index).not.toContain('export * from "./actions"');
    expect(index).not.toContain('resolveRoute');
    expect(index).not.toContain('buildToolGrant');
    expect(index).not.toContain('scanPromptInjection');
  });

  it('blocks other modules from importing agent-engine', () => {
    const violations: string[] = [];

    for (const file of listTypeScriptFiles(modulesRoot)) {
      const relFile = relative(modulesRoot, file);
      const owningModule = relFile.split('/')[0];
      if (owningModule === 'agent-engine') continue;

      const content = readFileSync(file, 'utf8');
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (
          /from ['"][^'"]*agent-engine/.test(line) ||
          /from ['"]\.\.\/agent-engine/.test(line)
        ) {
          violations.push(
            `${relative(repoRoot, file)}:${index + 1}: ${line.trim()}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('does not import features/ce or legacy host code from v8 modules', () => {
    const violations = scanImports(modulesRoot, [
      /from ['"].*(?:^|\/)features\/ce(?:\/|['"])/,
      /from ['"](?:\.\.\/)+adapters(?:\/|['"])/,
      /from ['"]adapters(?:\/|['"])/,
      /from ['"]vscode['"]/,
    ]).filter((line) => !line.includes('VsCodeFileSystemAdapter'));

    expect(violations).toEqual([]);
  });

  it('blocks cross-module internal imports', () => {
    const violations: string[] = [];

    for (const file of listTypeScriptFiles(modulesRoot)) {
      const relFile = relative(modulesRoot, file);
      const owningModule = relFile.split('/')[0];
      if (owningModule === 'model-gateway') continue;

      const content = readFileSync(file, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(
          /from ['"]((?:\.\.\/)+)(request-intake|request-understanding|repository-state|repository-context|decision-policy|prompt-construction|model-gateway|tool-runtime|verification|agent-engine)\/internal\//,
        );
        if (!match) continue;

        const targetModule = match[2];
        if (targetModule !== owningModule) {
          violations.push(`${relative(repoRoot, file)}: ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('registers all expected public module folders', () => {
    const dirs = readdirSync(modulesRoot).filter((entry) =>
      statSync(join(modulesRoot, entry)).isDirectory(),
    );
    expect(dirs.sort()).toEqual([...PUBLIC_MODULES].sort());
  });

  it('keeps module root barrels free of wildcard re-exports', () => {
    const violations: string[] = [];

    for (const moduleName of PUBLIC_MODULES) {
      const indexPath = join(modulesRoot, moduleName, 'index.ts');
      const content = readFileSync(indexPath, 'utf8');
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (/^\s*export\s+\*/.test(line)) {
          violations.push(
            `${relative(repoRoot, indexPath)}:${index + 1}: ${line.trim()}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps module root barrels free of internal/ and actions/ export paths', () => {
    const violations: string[] = [];

    for (const moduleName of PUBLIC_MODULES) {
      const indexPath = join(modulesRoot, moduleName, 'index.ts');
      const content = readFileSync(indexPath, 'utf8');
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!/^\s*export\s+/.test(line)) {
          continue;
        }
        if (
          /from\s+['"]\.\/(?:internal|actions)(?:\/|['"])/.test(line) ||
          /from\s+['"]\.\/(?:internal|actions)$/.test(line)
        ) {
          violations.push(
            `${relative(repoRoot, indexPath)}:${index + 1}: ${line.trim()}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

function scanImports(root: string, patterns: readonly RegExp[]): string[] {
  return listTypeScriptFiles(root).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => patterns.some((pattern) => pattern.test(line)))
      .map(
        ({ line, index }) =>
          `${relative(repoRoot, file)}:${index + 1}: ${line.trim()}`,
      ),
  );
}

function listTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const stats = statSync(abs);
      if (stats.isDirectory()) walk(abs);
      else if (entry.endsWith('.ts')) files.push(abs);
    }
  };
  walk(root);
  return files;
}
