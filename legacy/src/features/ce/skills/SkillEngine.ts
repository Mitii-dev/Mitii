import type {
  SkillManifest,
  SkillMode,
  SkillPinRule,
} from '../../../interfaces/skills/SkillManifest';
import type { SkillCatalogEntry, SkillCatalogService } from './SkillCatalogService';

export const SKILL_ENGINE_VERSION = '1';

export interface RepositoryProfile {
  version: string;
  repositoryId?: string;
  projectIds?: string[];
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  paths: string[];
}

export interface SkillResolutionContext {
  request: string;
  mode: SkillMode;
  intent?: string;
  taskKind?: string;
  taskSubtype?: string;
  operationType?: string;
  complexity?: string;
  artifacts?: string[];
  repository: RepositoryProfile;
  availableTools: ReadonlySet<string>;
  availableCapabilities: ReadonlySet<string>;
  edition: 'ce' | 'ee';
  manualSkillIds?: string[];
  userPinnedSkillIds?: string[];
  repositoryPinnedSkillIds?: string[];
  historical?: Record<string, { successes: number; failures: number; rejections: number }>;
}

export type SkillCandidateStatus =
  | 'recommended'
  | 'suggested'
  | 'available'
  | 'incompatible'
  | 'disabled'
  | 'missing_required_tools'
  | 'missing_required_capabilities'
  | 'rejected_by_negative_trigger'
  | 'invalid';

export interface SkillScoreFactor {
  key: string;
  score: number;
  reason: string;
}

export interface SkillCandidateReport {
  id: string;
  name: string;
  status: SkillCandidateStatus;
  eligible: boolean;
  score: number;
  confidence: number;
  factors: SkillScoreFactor[];
  rejectionReasons: string[];
  pinningEffects: string[];
  missingTools: string[];
  missingCapabilities: string[];
  manifest: SkillManifest;
  manifestPath: string;
  manifestHash: string;
}

export interface SkillEngineResolution {
  engineVersion: string;
  primarySkillId?: string;
  supportingSkillId?: string;
  candidateSkills: SkillCandidateReport[];
  rejectedSkills: SkillCandidateReport[];
  selectedSkillIds: string[];
  estimatedCatalogChars: number;
}

export interface SkillCandidateRetriever {
  retrieve(context: SkillResolutionContext, limit?: number): SkillCatalogEntry[];
}

export interface SkillRanker {
  rank(entry: SkillCatalogEntry, context: SkillResolutionContext): SkillCandidateReport;
}

export class CatalogSkillCandidateRetriever implements SkillCandidateRetriever {
  constructor(private readonly catalog: SkillCatalogService) {}

  retrieve(context: SkillResolutionContext, limit = 40): SkillCatalogEntry[] {
    const explicitIds = new Set([
      ...(context.manualSkillIds ?? []),
      ...(context.userPinnedSkillIds ?? []),
      ...(context.repositoryPinnedSkillIds ?? []),
    ]);
    const query = [
      context.request,
      context.intent,
      context.taskKind,
      context.taskSubtype,
      ...context.repository.languages,
      ...context.repository.frameworks,
      ...context.repository.packageManagers,
      ...context.repository.paths,
    ].filter(Boolean).join(' ');
    const retrieved = this.catalog.search(query, limit);
    const byId = new Map(retrieved.map((entry) => [entry.id, entry]));
    for (const id of explicitIds) {
      const loaded = this.catalog.get(id)?.entry;
      if (loaded) byId.set(loaded.id, loaded);
    }
    return [...byId.values()].slice(0, limit);
  }
}

export class ExplainableSkillRanker implements SkillRanker {
  rank(entry: SkillCatalogEntry, context: SkillResolutionContext): SkillCandidateReport {
    const manifest = entry.manifest;
    const factors: SkillScoreFactor[] = [];
    const rejectionReasons: string[] = [];
    const pinningEffects: string[] = [];
    const request = context.request.toLowerCase();
    const missingTools = (manifest.requiredTools ?? []).filter((tool) => !context.availableTools.has(tool));
    const requiredCapabilities = manifest.requiredCapabilities ?? manifest.capabilities ?? [];
    const missingCapabilities = requiredCapabilities.filter((capability) => !context.availableCapabilities.has(capability));

    if (!entry.valid) rejectionReasons.push(...entry.issues.map((issue) => issue.message));
    if (!manifest.enabled) rejectionReasons.push('Skill is disabled');
    if (!manifest.supportedModes.includes(context.mode)) rejectionReasons.push(`Mode ${context.mode} is not supported`);
    if (manifest.edition === 'ee' && context.edition !== 'ee') rejectionReasons.push('Enterprise edition is required');
    if (manifest.apiVersion !== '1') rejectionReasons.push(`Unsupported API version ${manifest.apiVersion}`);
    if (missingTools.length > 0) rejectionReasons.push(`Missing required tools: ${missingTools.join(', ')}`);
    if (missingCapabilities.length > 0) rejectionReasons.push(`Missing required capabilities: ${missingCapabilities.join(', ')}`);

    const negative = (manifest.negativeTriggers ?? []).find((trigger) => matchesText(request, trigger));
    if (negative) rejectionReasons.push(`Negative trigger matched: ${negative}`);
    applyRepositoryConstraint('language', manifest.languages, context.repository.languages, rejectionReasons);
    applyRepositoryConstraint('framework', manifest.frameworks, context.repository.frameworks, rejectionReasons);
    applyRepositoryConstraint('package manager', manifest.packageManagers, context.repository.packageManagers, rejectionReasons);
    if ((manifest.pathPatterns?.length ?? 0) > 0 && !manifest.pathPatterns!.some((pattern) =>
      [...context.repository.paths, ...(context.artifacts ?? [])].some((path) => globMatches(path, pattern)))) {
      rejectionReasons.push('No project path matched');
    }

    addMatchFactor(factors, 'intent', manifest.intents, context.intent, 24);
    addMatchFactor(factors, 'task_kind', manifest.taskKinds, context.taskKind, 20);
    addMatchFactor(factors, 'task_subtype', manifest.taskSubtypes, context.taskSubtype, 18);
    addDimensionMismatchFactor(factors, 'intent_mismatch', manifest.intents, context.intent, -20);
    addDimensionMismatchFactor(factors, 'task_kind_mismatch', manifest.taskKinds, context.taskKind, -16);
    addDimensionMismatchFactor(factors, 'task_subtype_mismatch', manifest.taskSubtypes, context.taskSubtype, -14);
    addCollectionFactor(factors, 'language', manifest.languages, context.repository.languages, 10);
    addCollectionFactor(factors, 'framework', manifest.frameworks, context.repository.frameworks, 14);
    addCollectionFactor(factors, 'package_manager', manifest.packageManagers, context.repository.packageManagers, 6);
    const triggerMatches = (manifest.triggers ?? []).filter((trigger) => matchesText(request, trigger));
    if (triggerMatches.length > 0) {
      factors.push({ key: 'trigger', score: Math.min(24, triggerMatches.length * 12), reason: `Matched: ${triggerMatches.join(', ')}` });
    }
    // Score only against task-evidence paths (explicit mentions/@-references), not the
    // ambient repository file listing — a file merely existing somewhere in the repo is
    // not evidence this skill is relevant to the current request.
    const pathMatches = (manifest.pathPatterns ?? []).filter((pattern) =>
      (context.artifacts ?? []).some((path) => globMatches(path, pattern)));
    if (pathMatches.length > 0) {
      factors.push({ key: 'path', score: Math.min(16, pathMatches.length * 8), reason: `Matched: ${pathMatches.join(', ')}` });
    }
    if (manifest.priority) factors.push({ key: 'priority', score: manifest.priority, reason: `Manifest priority ${manifest.priority}` });
    if (manifest.status === 'recommended') factors.push({ key: 'recommended', score: 6, reason: 'Marked recommended' });

    const pinRules = manifest.pinningRules ?? [];
    for (const rule of pinRules) applyPinRule(rule, manifest.id, context, factors, rejectionReasons, pinningEffects);
    applyDirectPins(manifest.id, context, factors, pinningEffects);

    const history = context.historical?.[manifest.id];
    if (history) {
      const historicalScore = Math.max(-10, Math.min(10, history.successes - history.failures * 2 - history.rejections));
      factors.push({ key: 'history', score: historicalScore, reason: `${history.successes} successes, ${history.failures} failures, ${history.rejections} rejections` });
    }

    const specificity = [
      manifest.intents,
      manifest.taskKinds,
      manifest.taskSubtypes,
      manifest.languages,
      manifest.frameworks,
      manifest.pathPatterns,
    ].filter((items) => (items?.length ?? 0) > 0).length;
    if (specificity > 0) factors.push({ key: 'specificity', score: specificity * 2, reason: `${specificity} scoped dimensions` });

    const eligible = rejectionReasons.length === 0;
    const score = eligible ? factors.reduce((sum, factor) => sum + factor.score, 0) : 0;
    const confidence = eligible ? Math.max(0, Math.min(1, score / 80)) : 0;
    return {
      id: manifest.id,
      name: manifest.name,
      status: statusFor(entry, manifest, rejectionReasons, missingTools, missingCapabilities, negative, score),
      eligible,
      score,
      confidence,
      factors,
      rejectionReasons,
      pinningEffects,
      missingTools,
      missingCapabilities,
      manifest,
      manifestPath: entry.manifestPath,
      manifestHash: entry.manifestHash,
    };
  }
}

export class SkillResolver {
  constructor(
    private readonly retriever: SkillCandidateRetriever,
    private readonly ranker: SkillRanker,
    private readonly candidateLimit = 40,
    private readonly reportLimit = 10
  ) {}

  resolve(context: SkillResolutionContext): SkillEngineResolution {
    const entries = this.retriever.retrieve(context, this.candidateLimit);
    const reports = entries.map((entry) => this.ranker.rank(entry, context));
    const eligible = reports
      .filter((report) => report.eligible)
      .sort((a, b) => b.score - a.score || b.manifest.priority - a.manifest.priority || a.id.localeCompare(b.id));
    const primary = eligible.find((report) => report.score > 0 && hasStrongTaskMatch(report));
    const supporting = eligible.find((report) =>
      report.id !== primary?.id &&
      report.score >= 20 &&
      hasStrongTaskMatch(report) &&
      !hasConflict(report.manifest, primary?.manifest));
    const candidates = eligible.filter((report) => report.score > 0).slice(0, this.reportLimit);
    const rejected = reports.filter((report) => !report.eligible).slice(0, this.reportLimit);
    return {
      engineVersion: SKILL_ENGINE_VERSION,
      primarySkillId: primary?.id,
      supportingSkillId: supporting?.id,
      candidateSkills: candidates,
      rejectedSkills: rejected,
      selectedSkillIds: [primary?.id, supporting?.id].filter((id): id is string => Boolean(id)),
      estimatedCatalogChars: [...candidates, ...rejected].reduce((sum, report) => sum + report.id.length + report.name.length + 32, 0),
    };
  }
}

function hasStrongTaskMatch(report: SkillCandidateReport): boolean {
  // A skill that declares its own relevance signals (triggers/pathPatterns) is opting into
  // evidence-based matching: a bare intent/taskKind match (shared by many broadly-scoped
  // skills) isn't enough to rank it as primary/supporting unless one of ITS OWN signals
  // actually fired. Only skills that declare no such signals fall back to intent as strong
  // evidence, since they have no narrower way to demonstrate relevance.
  const declaresEvidenceSignals =
    (report.manifest.triggers?.length ?? 0) > 0 || (report.manifest.pathPatterns?.length ?? 0) > 0;
  const strongKeys = declaresEvidenceSignals
    ? ['task_subtype', 'trigger', 'path', 'pin', 'pin_rule']
    : ['intent', 'task_subtype', 'trigger', 'path', 'pin', 'pin_rule'];
  return report.factors.some((factor) => factor.score > 0 && strongKeys.includes(factor.key));
}

function statusFor(
  entry: SkillCatalogEntry,
  manifest: SkillManifest,
  reasons: string[],
  missingTools: string[],
  missingCapabilities: string[],
  negative: string | undefined,
  score: number
): SkillCandidateStatus {
  if (!entry.valid) return 'invalid';
  if (!manifest.enabled) return 'disabled';
  if (negative) return 'rejected_by_negative_trigger';
  if (missingTools.length > 0) return 'missing_required_tools';
  if (missingCapabilities.length > 0) return 'missing_required_capabilities';
  if (reasons.length > 0) return 'incompatible';
  if (manifest.status === 'recommended' || score >= 60) return 'recommended';
  if (score >= 20) return 'suggested';
  return 'available';
}

function applyRepositoryConstraint(label: string, expected: readonly string[] | undefined, actual: readonly string[], reasons: string[]): void {
  if ((expected?.length ?? 0) > 0 && !intersects(expected!, actual)) reasons.push(`No repository ${label} match`);
}

function addMatchFactor(factors: SkillScoreFactor[], key: string, expected: readonly string[] | undefined, actual: string | undefined, score: number): void {
  if (actual && expected?.some((item) => item.toLowerCase() === actual.toLowerCase())) {
    factors.push({ key, score, reason: `Matched ${actual}` });
  }
}

function addDimensionMismatchFactor(
  factors: SkillScoreFactor[],
  key: string,
  expected: readonly string[] | undefined,
  actual: string | undefined,
  score: number
): void {
  if (
    (expected?.length ?? 0) > 0 &&
    (!actual || !expected!.some((item) => item.toLowerCase() === actual.toLowerCase()))
  ) {
    factors.push({
      key,
      score,
      reason: actual
        ? `Expected one of ${expected!.join(', ')}, received ${actual}`
        : `Expected one of ${expected!.join(', ')}, but no value was classified`,
    });
  }
}

function addCollectionFactor(factors: SkillScoreFactor[], key: string, expected: readonly string[] | undefined, actual: readonly string[], score: number): void {
  const matches = expected?.filter((item) => actual.some((value) => value.toLowerCase() === item.toLowerCase())) ?? [];
  if (matches.length > 0) factors.push({ key, score, reason: `Matched ${matches.join(', ')}` });
}

function applyDirectPins(id: string, context: SkillResolutionContext, factors: SkillScoreFactor[], effects: string[]): void {
  const sources: Array<[string, string[] | undefined, number]> = [
    ['manual one-turn attachment', context.manualSkillIds, 100],
    ['user pin', context.userPinnedSkillIds, 45],
    ['repository pin', context.repositoryPinnedSkillIds, 50],
  ];
  for (const [label, ids, score] of sources) {
    if (ids?.includes(id)) {
      factors.push({ key: 'pin', score, reason: label });
      effects.push(label);
    }
  }
}

function applyPinRule(
  rule: SkillPinRule,
  id: string,
  context: SkillResolutionContext,
  factors: SkillScoreFactor[],
  reasons: string[],
  effects: string[]
): void {
  if (!pinRuleMatches(rule, context)) return;
  const effect = `${rule.action}:${rule.scope}${rule.value ? `=${rule.value}` : ''}`;
  effects.push(effect);
  if (rule.action === 'exclude') {
    reasons.push(`Excluded by pin rule ${rule.id}`);
    return;
  }
  factors.push({
    key: 'pin_rule',
    score: rule.priority ?? (rule.action === 'attach' ? 80 : 40),
    reason: `Pin rule ${rule.id} applied to ${id}`,
  });
}

function pinRuleMatches(rule: SkillPinRule, context: SkillResolutionContext): boolean {
  const value = rule.value?.toLowerCase();
  switch (rule.scope) {
    case 'global': return true;
    case 'repository': return Boolean(value && context.repository.repositoryId?.toLowerCase() === value);
    case 'project': return Boolean(value && context.repository.projectIds?.some((id) => id.toLowerCase() === value));
    case 'mode': return !value || context.mode === value;
    case 'intent': return Boolean(value && context.intent?.toLowerCase() === value);
    case 'task-kind': return Boolean(value && context.taskKind?.toLowerCase() === value);
    case 'task-subtype': return Boolean(value && context.taskSubtype?.toLowerCase() === value);
    // Task-evidence only: a `path` pin should reflect that the current task actually
    // references this file, not that it happens to exist somewhere in the repository.
    case 'path': return Boolean(value && (context.artifacts ?? []).some((path) => globMatches(path, value)));
  }
}

function hasConflict(left: SkillManifest, right?: SkillManifest): boolean {
  if (!right) return false;
  return (left.conflicts ?? []).includes(right.id) || (right.conflicts ?? []).includes(left.id);
}

function matchesText(text: string, trigger: string): boolean {
  const normalized = trigger.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('/') && normalized.endsWith('/') && normalized.length > 2) {
    try {
      return new RegExp(normalized.slice(1, -1), 'i').test(text);
    } catch {
      return false;
    }
  }
  return text.includes(normalized);
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const set = new Set(right.map((item) => item.toLowerCase()));
  return left.some((item) => set.has(item.toLowerCase()));
}

function globMatches(path: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '.');
  try {
    return new RegExp(`^${escaped}$`, 'i').test(path.replace(/\\/g, '/'));
  } catch {
    return false;
  }
}
