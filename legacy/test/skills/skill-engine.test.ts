import { describe, expect, it } from 'vitest';
import type { SkillManifest } from '../../src/interfaces/skills/SkillManifest';
import type { SkillCatalogEntry, SkillCatalogService } from '../../src/features/ce/skills/SkillCatalogService';
import {
  CatalogSkillCandidateRetriever,
  ExplainableSkillRanker,
  SkillResolver,
  type SkillResolutionContext,
} from '../../src/features/ce/skills/SkillEngine';
import { SkillInjectionBuilder } from '../../src/features/ce/skills/SkillInjectionBuilder';
import { validateSkillManifest } from '../../src/features/ce/skills/SkillManifestSchema';

describe('Skill Engine', () => {
  it('rejects invalid and incompatible manifests', () => {
    expect(validateSkillManifest({ id: '../bad' }).success).toBe(false);
    expect(validateSkillManifest({ ...manifest('future'), apiVersion: '99' }).issues[0]?.code).toBe('incompatible_api_version');
  });

  it('hard-filters only safety and compatibility constraints', () => {
    const ranker = new ExplainableSkillRanker();
    const context = baseContext();
    const cases: Array<[Partial<SkillManifest>, string]> = [
      [{ supportedModes: ['ask'] }, 'Mode agent is not supported'],
      [{ negativeTriggers: ['fix'] }, 'Negative trigger matched: fix'],
      [{ requiredTools: ['missing_tool'] }, 'Missing required tools'],
      [{ frameworks: ['docusaurus'] }, 'No repository framework match'],
    ];
    for (const [patch, reason] of cases) {
      const report = ranker.rank(entry({ ...manifest(reason), ...patch }), context);
      expect(report.eligible).toBe(false);
      expect(report.rejectionReasons.join(' ')).toContain(reason);
    }
  });

  it('keeps a trigger-matched bugfix skill eligible when intent classification is wrong', () => {
    const ranker = new ExplainableSkillRanker();
    const report = ranker.rank(entry({
      ...manifest('bugfix-workflow'),
      intents: ['bugfix'],
      taskKinds: ['implementation'],
      triggers: ['fix', 'build errors'],
      priority: 20,
    }), {
      ...baseContext(),
      request: 'Fix the build errors from a half implemented migration',
      intent: 'audit',
      taskKind: 'implementation',
    });

    expect(report.eligible).toBe(true);
    expect(report.score).toBeGreaterThan(0);
    expect(report.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'intent_mismatch', score: -20 }),
      expect.objectContaining({ key: 'task_kind', score: 20 }),
      expect.objectContaining({ key: 'trigger' }),
    ]));
  });

  it('applies explainable pinning without bypassing safety filters', () => {
    const ranker = new ExplainableSkillRanker();
    const pinned = entry({
      ...manifest('pinned'),
      pinningRules: [{ id: 'bugs', scope: 'intent', value: 'bugfix', action: 'recommend', priority: 50 }],
    });
    const report = ranker.rank(pinned, baseContext());
    expect(report.eligible).toBe(true);
    expect(report.pinningEffects).toContain('recommend:intent=bugfix');
    expect(report.factors.some((factor) => factor.key === 'pin_rule' && factor.score === 50)).toBe(true);

    const unsafe = ranker.rank(entry({ ...pinned.manifest, requiredTools: ['not_available'] }), baseContext());
    expect(unsafe.eligible).toBe(false);
  });

  it('selects at most one primary and one non-conflicting support skill', () => {
    const entries = [
      entry({ ...manifest('primary'), priority: 30, triggers: ['fix'], conflicts: ['conflict'] }),
      entry({ ...manifest('conflict'), priority: 29, triggers: ['fix'] }),
      entry({ ...manifest('support'), priority: 20, triggers: ['fix'] }),
    ];
    const resolver = new SkillResolver(new StaticRetriever(entries), new ExplainableSkillRanker());
    const result = resolver.resolve(baseContext());
    expect(result.primarySkillId).toBe('primary');
    expect(result.supportingSkillId).toBe('support');
    expect(result.selectedSkillIds).toHaveLength(2);
  });

  it('rejects frontend skills when the repository profile is scoped to a backend project', () => {
    const entries = [
      entry({
        ...manifest('bugfix-workflow'),
        intents: ['bugfix'],
        taskKinds: ['implementation'],
        triggers: ['fix'],
        priority: 20,
      }),
      entry({
        ...manifest('react-next-performance'),
        intents: ['bugfix', 'feature'],
        taskKinds: ['implementation'],
        frameworks: ['react', 'nextjs'],
        priority: 17,
      }),
    ];
    const resolver = new SkillResolver(new StaticRetriever(entries), new ExplainableSkillRanker());
    const result = resolver.resolve({
      ...baseContext(),
      request: 'Can you please fix all the issues in this project @ai-service',
      intent: 'bugfix',
      taskKind: 'implementation',
      artifacts: ['ai-service'],
      repository: {
        version: 'scoped',
        repositoryId: 'resumeAI',
        projectIds: ['ai-service'],
        languages: ['typescript'],
        frameworks: ['fastify'],
        packageManagers: ['pnpm'],
        paths: ['ai-service/src/index.ts', 'ai-service/package.json'],
      },
    });

    expect(result.primarySkillId).toBe('bugfix-workflow');
    expect(result.supportingSkillId).toBeUndefined();
    expect(result.selectedSkillIds).toEqual(['bugfix-workflow']);
    expect(result.rejectedSkills.some((skill) =>
      skill.id === 'react-next-performance' &&
      skill.rejectionReasons.some((reason) => /framework/i.test(reason))
    )).toBe(true);
  });

  it('does not select an env/secrets skill solely because a .env file exists in the repo', () => {
    const entries = [
      entry({
        ...manifest('bugfix-workflow'),
        intents: ['bugfix'],
        taskKinds: ['implementation'],
        triggers: ['fix'],
        priority: 20,
      }),
      entry({
        ...manifest('environment-and-secrets'),
        intents: ['feature', 'diagnose'],
        taskKinds: ['implementation', 'debugging', 'question'],
        triggers: ['.env', 'env.example', 'missing environment variable', 'api key'],
        pathPatterns: ['.env*', '**/.env*', '**/*.env.example', '**/env.example'],
        pinningRules: [{ id: 'env-path', scope: 'path', value: '**/.env*', action: 'recommend', priority: 45 }],
        priority: 25,
      }),
    ];
    const resolver = new SkillResolver(new StaticRetriever(entries), new ExplainableSkillRanker());
    const result = resolver.resolve({
      ...baseContext(),
      request: "Cannot find module '../../../../infrastructure/ai/parser-service-config' — fix the ai-service build",
      intent: 'bugfix',
      taskKind: 'implementation',
      artifacts: ['ai-service'],
      repository: {
        version: 'scoped',
        repositoryId: 'resumeAI',
        projectIds: ['ai-service'],
        languages: ['typescript'],
        frameworks: ['fastify'],
        packageManagers: ['pnpm'],
        paths: ['ai-service/src/index.ts', 'ai-service/.env'],
      },
    });

    expect(result.primarySkillId).toBe('bugfix-workflow');
    expect(result.supportingSkillId).toBeUndefined();
    expect(result.selectedSkillIds).toEqual(['bugfix-workflow']);
  });

  it('still selects an env/secrets skill when the task itself references env keys', () => {
    const entries = [
      entry({
        ...manifest('environment-and-secrets'),
        intents: ['feature', 'diagnose'],
        taskKinds: ['implementation', 'debugging', 'question'],
        triggers: ['.env', 'env.example', 'missing environment variable', 'api key'],
        pathPatterns: ['.env*', '**/.env*', '**/*.env.example', '**/env.example'],
        pinningRules: [{ id: 'env-path', scope: 'path', value: '**/.env*', action: 'recommend', priority: 45 }],
        priority: 25,
      }),
    ];
    const resolver = new SkillResolver(new StaticRetriever(entries), new ExplainableSkillRanker());
    const result = resolver.resolve({
      ...baseContext(),
      request: 'Check which .env keys are missing compared to .env.example',
      intent: 'diagnose',
      taskKind: 'question',
      repository: {
        ...baseContext().repository,
        paths: ['.env', '.env.example'],
      },
    });

    expect(result.selectedSkillIds).toContain('environment-and-secrets');
  });

  it('does not inject documentation solely because the repository contains markdown files', () => {
    const entries = [
      entry({
        ...manifest('bugfix-workflow'),
        intents: ['bugfix'],
        taskKinds: ['implementation'],
        triggers: ['fix'],
        priority: 20,
      }),
      entry({
        ...manifest('documentation'),
        intents: ['docs'],
        taskKinds: ['implementation'],
        taskSubtypes: ['readme'],
        pathPatterns: ['**/*.md'],
        priority: 20,
      }),
    ];
    const resolver = new SkillResolver(new StaticRetriever(entries), new ExplainableSkillRanker());
    const result = resolver.resolve({
      ...baseContext(),
      request: 'Fix build errors from a half implemented folder migration',
      intent: 'bugfix',
      taskKind: 'implementation',
      repository: {
        ...baseContext().repository,
        paths: ['docs/README.md', 'src/index.ts'],
      },
    });

    expect(result.primarySkillId).toBe('bugfix-workflow');
    expect(result.supportingSkillId).toBeUndefined();
    expect(result.selectedSkillIds).toEqual(['bugfix-workflow']);
  });

  it('returns a no-skill result when no eligible candidate has a positive score', () => {
    const resolver = new SkillResolver(
      new StaticRetriever([entry(manifest('generic'))]),
      new ExplainableSkillRanker()
    );
    const result = resolver.resolve({ ...baseContext(), request: 'hello', intent: 'greeting' });
    expect(result.selectedSkillIds).toEqual([]);
  });

  it('loads full content only for selected skills and enforces injection limits', () => {
    const entries = [entry({ ...manifest('one'), priority: 20 }), entry({ ...manifest('two'), priority: 10 })];
    let loads = 0;
    const catalog = {
      get(id: string) {
        loads += 1;
        const found = entries.find((item) => item.id === id);
        return found ? { entry: found, content: '# Skill\n\n## Quick Reference\n\nUse bounded guidance.\n\n'.repeat(20) } : undefined;
      },
    } as SkillCatalogService;
    const result = new SkillInjectionBuilder(catalog).build({
      skillIds: ['one', 'two', 'never'],
      mode: 'agent',
      style: 'quick-ref',
      maxChars: 2_000,
    });
    expect(loads).toBeLessThanOrEqual(2);
    expect(result.loaded.length).toBeLessThanOrEqual(2);
    expect(result.totalChars).toBeLessThanOrEqual(2_000);
    expect(result.context).not.toContain('never');
  });

  it('retrieves a bounded report from 10,000 manifests without catalog prompt growth', () => {
    const entries = Array.from({ length: 10_000 }, (_, index) => entry({
      ...manifest(`skill-${index}`),
      description: index === 9_999 ? 'Exact migration workflow' : `Generated skill ${index}`,
      triggers: index === 9_999 ? ['cross-package migration'] : [`generated-${index}`],
      priority: index === 9_999 ? 100 : 0,
    }));
    const byId = new Map(entries.map((item) => [item.id, item]));
    const catalog = {
      search(query: string, limit: number) {
        const terms = query.toLowerCase().split(/\s+/);
        return entries
          .filter((item) => terms.some((term) =>
            `${item.name} ${item.description} ${(item.manifest.triggers ?? []).join(' ')}`.toLowerCase().includes(term)))
          .sort((a, b) => b.manifest.priority - a.manifest.priority)
          .slice(0, limit);
      },
      get(id: string) {
        const found = byId.get(id);
        return found ? { entry: found, content: '# Skill' } : undefined;
      },
    } as SkillCatalogService;
    const resolver = new SkillResolver(
      new CatalogSkillCandidateRetriever(catalog),
      new ExplainableSkillRanker(),
      40,
      10
    );
    const result = resolver.resolve({
      ...baseContext(),
      request: 'Plan a cross-package migration',
      intent: 'refactor',
    });
    expect(result.primarySkillId).toBe('skill-9999');
    expect(result.candidateSkills.length).toBeLessThanOrEqual(10);
    expect(result.rejectedSkills.length).toBeLessThanOrEqual(10);
    expect(result.estimatedCatalogChars).toBeLessThan(2_000);
  });
});

class StaticRetriever {
  constructor(private readonly entries: SkillCatalogEntry[]) {}
  retrieve(): SkillCatalogEntry[] {
    return this.entries;
  }
}

function baseContext(): SkillResolutionContext {
  return {
    request: 'Fix the failing test',
    mode: 'agent',
    intent: 'bugfix',
    taskKind: 'debugging',
    repository: {
      version: 'test',
      repositoryId: 'repo',
      languages: ['typescript'],
      frameworks: ['react'],
      packageManagers: ['pnpm'],
      paths: ['src/auth.ts'],
    },
    availableTools: new Set(['read_file', 'search', 'apply_patch']),
    availableCapabilities: new Set(['repository-read', 'workspace-write']),
    edition: 'ce',
  };
}

function manifest(id: string): SkillManifest {
  return {
    schemaVersion: 1,
    id: id.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
    name: id,
    description: `Description for ${id}`,
    version: '1.0.0',
    apiVersion: '1',
    owner: 'test',
    edition: 'ce',
    enabled: true,
    status: 'active',
    kind: 'workflow',
    supportedModes: ['agent'],
    entrypoint: 'SKILL.md',
    maxInjectionChars: 4_000,
    injectionStrategy: 'lazy-references',
    trust: 'builtin',
    priority: 0,
  };
}

function entry(skillManifest: SkillManifest): SkillCatalogEntry {
  return {
    id: skillManifest.id,
    name: skillManifest.name,
    description: skillManifest.description,
    relPath: `.mitii/skills/${skillManifest.id}/SKILL.md`,
    manifest: skillManifest,
    valid: true,
    issues: [],
    manifestPath: `.mitii/skills/${skillManifest.id}/skill.json`,
    manifestHash: 'test-hash',
  };
}
