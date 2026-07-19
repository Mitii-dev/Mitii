import type { SkillRoutingTestCase } from '../../../interfaces/skills/SkillManifest';
import type { SkillCatalogService } from './SkillCatalogService';
import {
  CatalogSkillCandidateRetriever,
  ExplainableSkillRanker,
  SkillResolver,
  type RepositoryProfile,
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
  private readonly resolver: SkillResolver;
  private readonly injectionBuilder: SkillInjectionBuilder;

  constructor(private readonly catalog: SkillCatalogService) {
    this.resolver = new SkillResolver(
      new CatalogSkillCandidateRetriever(catalog),
      new ExplainableSkillRanker()
    );
    this.injectionBuilder = new SkillInjectionBuilder(catalog);
  }

  run(skillId: string): SkillTestRunResult {
    const skill = this.catalog.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    const results = (skill.entry.manifest.tests ?? []).map((test) => this.runCase(skillId, test));
    return {
      skillId,
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed).length,
      results,
    };
  }

  private runCase(skillId: string, test: SkillRoutingTestCase): SkillTestCaseResult {
    const repository: RepositoryProfile = {
      version: 'test-1',
      languages: [...(test.repositoryFacts?.languages ?? [])],
      frameworks: [...(test.repositoryFacts?.frameworks ?? [])],
      packageManagers: [...(test.repositoryFacts?.packageManagers ?? [])],
      paths: [...(test.repositoryFacts?.paths ?? [])],
    };
    const context: SkillResolutionContext = {
      request: test.request,
      mode: test.mode ?? 'agent',
      repository,
      availableTools: new Set(test.availableTools ?? []),
      availableCapabilities: new Set(test.availableCapabilities ?? []),
      edition: 'ce',
      manualSkillIds: [skillId],
    };
    const resolution = this.resolver.resolve(context);
    const report = [...resolution.candidateSkills, ...resolution.rejectedSkills].find((candidate) => candidate.id === skillId);
    const actual =
      resolution.primarySkillId === skillId || resolution.supportingSkillId === skillId
        ? 'selected'
        : report?.eligible
          ? 'suggested'
          : report
            ? 'rejected'
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
      ...(report?.rejectionReasons ?? []),
      ...(report?.factors.map((factor) => `${factor.key}: ${factor.reason}`) ?? []),
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
