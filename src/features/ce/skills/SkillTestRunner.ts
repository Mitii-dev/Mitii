import type { SkillRoutingTestCase } from '../../../interfaces/skills/SkillManifest';
import type { SkillCatalogService, SkillCatalogEntry } from './SkillCatalogService';
import {
  CatalogSkillCandidateRetriever,
  ExplainableSkillRanker,
  SkillResolver,
  type RepositoryProfile,
  type SkillCandidateRetriever,
  type SkillResolutionContext,
} from './SkillEngine';
import { SkillInjectionBuilder } from './SkillInjectionBuilder';

export interface SkillTestCaseResult {
  id: string;
  name: string;
  passed: boolean;
  expected: SkillRoutingTestCase['expected'];
  actual: 'selected' | 'suggested' | 'rejected' | 'not-selected';
  reasons: string[];
}

export interface SkillTestRunResult {
  skillId: string;
  passed: number;
  failed: number;
  results: SkillTestCaseResult[];
}

export class SkillTestRunner {
  private readonly ranker = new ExplainableSkillRanker();
  private readonly injectionBuilder: SkillInjectionBuilder;

  constructor(private readonly catalog: SkillCatalogService) {
    this.injectionBuilder = new SkillInjectionBuilder(catalog);
  }

  run(skillId: string): SkillTestRunResult {
    const skill = this.catalog.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    const resolver = new SkillResolver(
      new SkillTestCandidateRetriever(this.catalog, skillId),
      this.ranker
    );
    const results = (skill.entry.manifest.tests ?? []).map((test) => this.runCase(skillId, test, resolver));
    return {
      skillId,
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed).length,
      results,
    };
  }

  private runCase(skillId: string, test: SkillRoutingTestCase, resolver: SkillResolver): SkillTestCaseResult {
    const skill = this.catalog.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    const repository: RepositoryProfile = {
      version: 'test-1',
      languages: [...(test.repositoryFacts?.languages ?? [])],
      frameworks: [...(test.repositoryFacts?.frameworks ?? [])],
      packageManagers: [...(test.repositoryFacts?.packageManagers ?? [])],
      paths: [...(test.repositoryFacts?.paths ?? [])],
    };
    const artifacts = [...(test.repositoryFacts?.paths ?? [])];
    const context: SkillResolutionContext = {
      request: test.request,
      mode: test.mode ?? 'agent',
      artifacts,
      repository,
      availableTools: new Set(test.availableTools ?? []),
      availableCapabilities: new Set(test.availableCapabilities ?? []),
      edition: 'ce',
      manualSkillIds: test.manualAttachment ? [skillId] : [],
    };
    const resolution = resolver.resolve(context);
    // Rank the skill under test directly rather than searching the report-limited
    // (top `reportLimit`) candidate/rejected lists — with dozens of bundled skills in the
    // catalog, this skill's own report can be truncated out of those lists even though its
    // eligibility is well-defined, which previously showed up as a false 'not-selected'.
    const report = this.ranker.rank(skill.entry, context);
    const selected = resolution.selectedSkillIds.includes(skillId);
    const actual = selected
      ? 'selected'
      : !report.eligible
        ? 'rejected'
        : report.score > 0
          ? 'suggested'
          : 'not-selected';
    const injection = actual === 'selected'
      ? this.injectionBuilder.build({
          skillIds: [skillId],
          mode: context.mode,
          maxChars: test.maxInjectionChars,
          style: 'quick-ref',
        })
      : undefined;
    const reasons = [
      ...report.rejectionReasons,
      ...report.factors.map((factor) => `${factor.key}: ${factor.reason}`),
    ];
    if (test.maxInjectionChars && injection && injection.totalChars > test.maxInjectionChars) {
      reasons.push(`Injection ${injection.totalChars} exceeds ${test.maxInjectionChars}`);
    }
    const passed =
      actual === test.expected &&
      (!test.maxInjectionChars || !injection || injection.totalChars <= test.maxInjectionChars);
    return { id: test.id, name: test.name, passed, expected: test.expected, actual, reasons };
  }
}

class SkillTestCandidateRetriever implements SkillCandidateRetriever {
  constructor(
    private readonly catalog: SkillCatalogService,
    private readonly skillId: string
  ) {}

  retrieve(context: SkillResolutionContext, limit = 40): SkillCatalogEntry[] {
    const base = new CatalogSkillCandidateRetriever(this.catalog).retrieve(context, limit);
    const entry = this.catalog.get(this.skillId)?.entry;
    if (!entry || base.some((item) => item.id === this.skillId)) return base;
    return [entry, ...base].slice(0, limit);
  }
}
