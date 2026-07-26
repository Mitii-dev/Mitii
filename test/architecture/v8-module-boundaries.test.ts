import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const v8PackageRoot = join(repoRoot, 'packages/v8');
const v8SrcRoot = join(v8PackageRoot, 'src');
const modulesRoot = join(v8SrcRoot, 'modules');
const engineRoot = join(v8SrcRoot, 'engine');

const PUBLIC_MODULES = [
  'request-intake',
  'request-understanding',
  'repository-state',
  'repository-context',
  'decision-policy',
  'prompt-construction',
  'model-gateway',
  'verification',
  'skills',
  'memory',
] as const;

const PUBLIC_ENGINE_COMPONENTS = [
  'agent-engine',
  'tool-runtime',
] as const;

const PUBLIC_ROOTS = [
  ...PUBLIC_MODULES.map((name) => ({
    name,
    root: join(modulesRoot, name),
  })),
  ...PUBLIC_ENGINE_COMPONENTS.map((name) => ({
    name,
    root: join(engineRoot, name),
  })),
] as const;

const FORBIDDEN_V8_IMPORT_PATTERNS = [
  /from ['"]vscode['"]/,
  /from ['"].*webview(?:-ui)?(?:\/|['"])/,
  /from ['"]@mitii\/sdk['"]/,
  /from ['"].*(?:^|\/)(?:apps\/|packages\/sdk)(?:\/|['"])/,
  /from ['"].*(?:^|\/)(?:kernel|interfaces|features|composition)(?:\/|['"])/,
  /from ['"](?:\.\.\/)+(?:kernel|interfaces|features|composition|adapters)(?:\/|['"])/,
] as const;

describe('v8 module boundaries (Phase 0/1/2/3/4/5/6/7/8/9/11/12/13)', () => {
  it('places live V8 under packages/v8 with no parallel src/v8 tree', () => {
    expect(existsSync(v8PackageRoot)).toBe(true);
    expect(existsSync(modulesRoot)).toBe(true);
    expect(existsSync(engineRoot)).toBe(true);
    expect(existsSync(join(v8PackageRoot, 'package.json'))).toBe(true);
    expect(existsSync(join(repoRoot, 'src/v8'))).toBe(false);
    expect(existsSync(join(modulesRoot, 'agent-engine'))).toBe(false);
    expect(existsSync(join(modulesRoot, 'tool-runtime'))).toBe(false);
    expect(existsSync(join(v8SrcRoot, 'core'))).toBe(false);
    expect(existsSync(join(v8SrcRoot, 'repository'))).toBe(false);
    expect(existsSync(join(v8SrcRoot, 'intent'))).toBe(false);
  });

  it('names the package @mitii/v8 without vscode or sdk runtime deps', () => {
    const pkg = JSON.parse(
      readFileSync(join(v8PackageRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe('@mitii/v8');
    const runtimeDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    };
    expect(runtimeDeps).not.toHaveProperty('vscode');
    expect(runtimeDeps).not.toHaveProperty('@mitii/sdk');
    expect(runtimeDeps).not.toHaveProperty('@types/vscode');
  });

  it('exposes Phase 1 public facades from packages/v8/src/index.ts', () => {
    const index = readFileSync(join(v8SrcRoot, 'index.ts'), 'utf8');
    expect(index).toContain('RequestIntakePipeline');
    expect(index).toContain('UserRequestEnvelopeBuilder');
    expect(index).toContain('createUserRequestInputSchema');
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
    expect(index).toContain('SkillsPipeline');
    expect(index).toContain('skillsSelectInputSchema');
    expect(index).toContain('MemoryPipeline');
    expect(index).toContain('memoryRetrieveInputSchema');
    expect(index).not.toContain('IntentRouter');
    expect(index).not.toContain('TaskAnalyzer');
    expect(index).not.toContain('resolveRoute');
    expect(index).not.toContain('export *');
  });

  it('keeps agent-engine actions private at the module root', () => {
    const index = readFileSync(
      join(engineRoot, 'agent-engine/index.ts'),
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
      join(engineRoot, 'tool-runtime/index.ts'),
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

  it('keeps skills actions private at the module root', () => {
    const index = readFileSync(join(modulesRoot, 'skills/index.ts'), 'utf8');
    expect(index).toContain('SkillsPipeline');
    expect(index).toContain('skillsSelectResultSchema');
    expect(index).not.toContain('export * from "./actions"');
    expect(index).not.toContain('matchSkills');
    expect(index).not.toContain('applySkillBudget');
  });

  it('keeps memory actions private at the module root', () => {
    const index = readFileSync(join(modulesRoot, 'memory/index.ts'), 'utf8');
    expect(index).toContain('MemoryPipeline');
    expect(index).toContain('memoryRetrieveResultSchema');
    expect(index).not.toContain('export * from "./actions"');
    expect(index).not.toContain('scoreMemoryRelevance');
    expect(index).not.toContain('prepareMemoryCommit');
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

    for (const file of listRuntimeTypeScriptFiles()) {
      const owningUnit = owningPublicUnit(file);
      if (owningUnit === 'agent-engine') continue;

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

  it('does not import features/ce, legacy host, sdk, apps, or vscode from v8', () => {
    const violations = [
      ...scanImports(modulesRoot, FORBIDDEN_V8_IMPORT_PATTERNS),
      ...scanImports(engineRoot, FORBIDDEN_V8_IMPORT_PATTERNS),
    ].filter((line) => !line.includes('VsCodeFileSystemAdapter'));

    expect(violations).toEqual([]);
  });

  it('blocks cross-module internal imports', () => {
    const violations: string[] = [];

    for (const file of listRuntimeTypeScriptFiles()) {
      const owningUnit = owningPublicUnit(file);
      if (owningUnit === 'model-gateway') continue;

      const content = readFileSync(file, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const specifier = line.match(/from ['"]([^'"]+)['"]/)?.[1];
        if (!specifier?.startsWith('.')) continue;

        const target = join(dirname(file), specifier);
        const targetUnit = owningPublicUnit(target);
        const targetParts = specifier.split('/');
        if (
          targetParts.includes('internal') &&
          targetUnit &&
          targetUnit !== owningUnit
        ) {
          violations.push(`${relative(repoRoot, file)}: ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('blocks deep actions/internal imports from outside the owning module', () => {
    const violations: string[] = [];

    for (const file of listRuntimeTypeScriptFiles()) {
      const owningUnit = owningPublicUnit(file);
      if (!owningUnit) continue;

      const content = readFileSync(file, 'utf8');
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        const specifier = line.match(/from ['"]([^'"]+)['"]/)?.[1];
        if (!specifier?.startsWith('.')) continue;

        const target = join(dirname(file), specifier);
        const targetUnit = owningPublicUnit(target);
        if (!targetUnit || targetUnit === owningUnit) continue;

        const relToTarget = relative(
          PUBLIC_ROOTS.find((unit) => unit.name === targetUnit)!.root,
          target,
        );
        if (
          relToTarget.startsWith(`actions${sep}`) ||
          relToTarget === 'actions' ||
          relToTarget.startsWith(`internal${sep}`) ||
          relToTarget === 'internal'
        ) {
          violations.push(
            `${relative(repoRoot, file)}:${index + 1}: ${line.trim()}`,
          );
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

  it('registers all expected public engine folders', () => {
    const dirs = readdirSync(engineRoot).filter((entry) =>
      statSync(join(engineRoot, entry)).isDirectory(),
    );
    expect(dirs.sort()).toEqual([...PUBLIC_ENGINE_COMPONENTS].sort());
  });

  it('keeps module root barrels free of wildcard re-exports', () => {
    const violations: string[] = [];

    for (const { root: publicRoot } of PUBLIC_ROOTS) {
      const indexPath = join(publicRoot, 'index.ts');
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

    for (const { root: publicRoot } of PUBLIC_ROOTS) {
      const indexPath = join(publicRoot, 'index.ts');
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

  it('keeps @mitii/sdk host-neutral over public @mitii/v8 only (Phase 12)', () => {
    const sdkRoot = join(repoRoot, 'packages/sdk');
    const sdkSrc = join(sdkRoot, 'src');
    expect(existsSync(sdkRoot)).toBe(true);
    expect(existsSync(join(sdkRoot, 'package.json'))).toBe(true);

    const pkg = JSON.parse(
      readFileSync(join(sdkRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    expect(pkg.name).toBe('@mitii/sdk');
    expect(pkg.dependencies?.['@mitii/v8']).toBeTruthy();
    expect(pkg.dependencies).not.toHaveProperty('vscode');
    expect(pkg.peerDependencies ?? {}).not.toHaveProperty('vscode');
    expect(pkg.exports).not.toHaveProperty('./daemon');

    const forbiddenSdkPatterns = [
      /from ['"]vscode['"]/,
      /from ['"].*webview(?:-ui)?(?:\/|['"])/,
      /from ['"].*(?:kernel|HeadlessAgentHost|ThunderController)(?:\/|['"])/,
      /from ['"]@mitii\/v8\/.*(?:actions|internal)(?:\/|['"])/,
      /from ['"].*packages\/v8\/src\/.*\/(?:actions|internal)(?:\/|['"])/,
      /from ['"].*\/(?:actions|internal)\/[^'"]+['"]/,
    ] as const;

    const violations = scanImports(sdkSrc, forbiddenSdkPatterns).filter(
      (line) =>
        // Allow documenting forbidden paths in comments only — scanImports
        // matches import lines; keep filter for defensive clarity.
        /from ['"]/.test(line),
    );
    expect(violations).toEqual([]);

    const index = readFileSync(join(sdkSrc, 'index.ts'), 'utf8');
    expect(index).toContain('createMitiiClient');
    expect(index).toContain('MitiiClient');
    expect(index).not.toContain('HeadlessAgentHost');
    expect(index).not.toContain('DaemonClient');
  });

  it('places host packages under apps/ over @mitii/sdk (Phase 13)', () => {
    const cliRoot = join(repoRoot, 'apps/cli');
    const vscodeRoot = join(repoRoot, 'apps/vscode');
    const rootPkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as {
      private?: boolean;
      bin?: unknown;
      contributes?: unknown;
      activationEvents?: unknown;
      main?: unknown;
      engines?: { vscode?: string };
    };

    expect(rootPkg.private).toBe(true);
    expect(rootPkg.bin).toBeUndefined();
    expect(rootPkg.contributes).toBeUndefined();
    expect(rootPkg.activationEvents).toBeUndefined();
    expect(rootPkg.main).toBeUndefined();
    expect(rootPkg.engines?.vscode).toBeUndefined();

    expect(existsSync(cliRoot)).toBe(true);
    expect(existsSync(vscodeRoot)).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/cli'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/daemon'))).toBe(false);
    expect(existsSync(join(repoRoot, 'legacy/packages/daemon'))).toBe(true);

    const cliPkg = JSON.parse(
      readFileSync(join(cliRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(cliPkg.name).toBe('@mitii/cli');
    expect(cliPkg.bin?.mitii).toBeTruthy();
    expect(cliPkg.dependencies?.['@mitii/sdk']).toBeTruthy();

    const vscodePkg = JSON.parse(
      readFileSync(join(vscodeRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      contributes?: unknown;
      activationEvents?: unknown;
      engines?: { vscode?: string };
      main?: string;
      dependencies?: Record<string, string>;
    };
    expect(vscodePkg.name).toBe('@mitii/vscode');
    expect(vscodePkg.contributes).toBeTruthy();
    expect(vscodePkg.activationEvents).toBeTruthy();
    expect(vscodePkg.engines?.vscode).toBeTruthy();
    expect(vscodePkg.main).toContain('extension.js');
    expect(vscodePkg.dependencies?.['@mitii/sdk']).toBeTruthy();

    const forbiddenHostPatterns = [
      /from ['"].*(?:kernel|HeadlessAgentHost|ThunderController)(?:\/|['"])/,
      /from ['"]@mitii\/v8\/.*(?:actions|internal)(?:\/|['"])/,
      /from ['"].*packages\/v8\/src\/.*\/(?:actions|internal)(?:\/|['"])/,
      /from ['"].*\/(?:actions|internal)\/[^'"]+['"]/,
    ] as const;

    expect(scanImports(join(cliRoot, 'src'), forbiddenHostPatterns)).toEqual(
      [],
    );
    expect(
      scanImports(join(vscodeRoot, 'src'), forbiddenHostPatterns),
    ).toEqual([]);

    const vscodeExtension = readFileSync(
      join(vscodeRoot, 'src/extension.ts'),
      'utf8',
    );
    expect(vscodeExtension).toContain('@mitii/sdk');
    expect(vscodeExtension).toContain('createMitiiClient');
    expect(vscodeExtension).not.toMatch(
      /from ['"].*ThunderController['"]/,
    );

    const cliSrc = readFileSync(join(cliRoot, 'src/cli.ts'), 'utf8');
    expect(cliSrc).toContain('@mitii/sdk');
    expect(cliSrc).toContain('createMitiiClient');
  });

  it('forbids V8 from importing apps packages (Phase 13)', () => {
    const violations = scanImports(v8SrcRoot, [
      /from ['"]@mitii\/(?:cli|vscode|daemon)['"]/,
      /from ['"].*(?:^|\/)apps\/(?:cli|vscode|daemon)/,
    ]);
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

function owningPublicUnit(file: string): string | undefined {
  for (const { name, root } of PUBLIC_ROOTS) {
    const rel = relative(root, file);
    if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) {
      return name;
    }
  }
  return undefined;
}

function listRuntimeTypeScriptFiles(): string[] {
  return [modulesRoot, engineRoot].flatMap(listTypeScriptFiles);
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
