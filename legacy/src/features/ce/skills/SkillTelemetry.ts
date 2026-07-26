import type { SessionLogService } from '../../../kernel/telemetry/SessionLogService';
import type { SkillEngineResolution, SkillResolutionContext } from './SkillEngine';
import type { SkillInjectionResult } from './SkillInjectionBuilder';

export interface SkillUsageMetric {
  skillId: string;
  suggested: number;
  selected: number;
  loaded: number;
  rejected: number;
  successes: number;
  failures: number;
  averageScore: number;
  averageInjectionChars: number;
  intents: Record<string, number>;
  repositories: Record<string, number>;
  rejectionReasons: Record<string, number>;
}

interface MutableSkillUsageMetric extends SkillUsageMetric {
  scoreTotal: number;
  scoreCount: number;
  injectionTotal: number;
  injectionCount: number;
}

export class SkillTelemetry {
  private readonly metrics = new Map<string, MutableSkillUsageMetric>();

  constructor(private readonly sessionLog?: SessionLogService) {}

  recordResolution(
    context: SkillResolutionContext,
    resolution: SkillEngineResolution,
    plannerVersion?: string
  ): void {
    for (const candidate of resolution.candidateSkills) {
      const metric = this.metric(candidate.id);
      metric.suggested += 1;
      metric.scoreTotal += candidate.score;
      metric.scoreCount += 1;
      if (resolution.selectedSkillIds.includes(candidate.id)) metric.selected += 1;
      increment(metric.intents, context.intent ?? 'unknown');
      increment(metric.repositories, context.repository.repositoryId ?? 'anonymous');
      this.recalculate(metric);
    }
    for (const rejected of resolution.rejectedSkills) {
      const metric = this.metric(rejected.id);
      metric.rejected += 1;
      for (const reason of rejected.rejectionReasons) increment(metric.rejectionReasons, reason);
    }
    this.sessionLog?.append('info', 'Skill engine resolution', {
      event: 'skill_resolution',
      engineVersion: resolution.engineVersion,
      plannerVersion,
      mode: context.mode,
      intent: context.intent,
      taskKind: context.taskKind,
      taskSubtype: context.taskSubtype,
      repositoryProfileVersion: context.repository.version,
      candidates: resolution.candidateSkills.map((item) => ({
        id: item.id,
        score: item.score,
        factors: item.factors,
        pinningEffects: item.pinningEffects,
        manifestVersion: item.manifest.version,
        manifestPath: item.manifestPath,
        manifestHash: item.manifestHash,
        supportedModes: item.manifest.supportedModes,
      })),
      selected: resolution.selectedSkillIds,
      rejected: resolution.rejectedSkills.map((item) => ({
        id: item.id,
        reasons: item.rejectionReasons,
        manifestVersion: item.manifest.version,
        manifestPath: item.manifestPath,
        manifestHash: item.manifestHash,
        supportedModes: item.manifest.supportedModes,
      })),
    });
  }

  recordInjection(mode: string, injection: SkillInjectionResult): void {
    for (const loaded of injection.loaded) {
      const metric = this.metric(loaded.id);
      metric.loaded += 1;
      metric.injectionTotal += loaded.chars;
      metric.injectionCount += 1;
      this.recalculate(metric);
    }
    this.sessionLog?.append('info', 'Skill contributions injected', {
      event: 'skill_injection',
      mode,
      loaded: injection.loaded.map(({ id, chars, sections }) => ({ id, chars, sections })),
      skipped: injection.skipped,
      injectedChars: injection.totalChars,
      estimatedTokens: injection.estimatedTokens,
    });
  }

  recordOutcome(skillIds: string[], success: boolean): void {
    for (const id of skillIds) {
      const metric = this.metric(id);
      if (success) metric.successes += 1;
      else metric.failures += 1;
    }
  }

  snapshot(): SkillUsageMetric[] {
    return [...this.metrics.values()]
      .map(({ scoreTotal: _scoreTotal, scoreCount: _scoreCount, injectionTotal: _injectionTotal, injectionCount: _injectionCount, ...metric }) => metric)
      .sort((a, b) => b.selected - a.selected || a.skillId.localeCompare(b.skillId));
  }

  private metric(skillId: string): MutableSkillUsageMetric {
    const existing = this.metrics.get(skillId);
    if (existing) return existing;
    const metric: MutableSkillUsageMetric = {
      skillId,
      suggested: 0,
      selected: 0,
      loaded: 0,
      rejected: 0,
      successes: 0,
      failures: 0,
      averageScore: 0,
      averageInjectionChars: 0,
      intents: {},
      repositories: {},
      rejectionReasons: {},
      scoreTotal: 0,
      scoreCount: 0,
      injectionTotal: 0,
      injectionCount: 0,
    };
    this.metrics.set(skillId, metric);
    return metric;
  }

  private recalculate(metric: MutableSkillUsageMetric): void {
    metric.averageScore = metric.scoreCount ? metric.scoreTotal / metric.scoreCount : 0;
    metric.averageInjectionChars = metric.injectionCount ? metric.injectionTotal / metric.injectionCount : 0;
  }
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}
