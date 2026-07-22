import type { AuditSubtype } from '../types';

/**
 * Data-driven audit subtype registry. Add a new audit subtype by adding one entry here —
 * no other file needs to change. Highest `priority` wins when multiple rules match; ties
 * are broken by declaration order.
 */
export interface AuditRule {
  id: string;
  subtype: AuditSubtype;
  description: string;
  priority: number;
  /** Rule matches when any of these patterns test true against the (lowercased-by-regex-flag) text. */
  match: RegExp[];
}

/** Exported standalone so pipeline gating code (e.g. classifyTaskSignals) can reuse the exact pattern. */
export const LOG_AUDIT_RE =
  /\b(log\s*audit|analyze\s+(?:the\s+)?logs?|session\s*log|\.jsonl|mitii\/logs|jsonl)\b/i;

/** Exported standalone so callers can decide whether to even attempt subtype resolution. */
export const GENERIC_CLEANUP_RE =
  /\b(cleanup|clean\s+up|unused|dead\s*code|depcheck|knip|orphan\s+files?)\b/i;

export const AUDIT_RULES: readonly AuditRule[] = [
  {
    id: 'log-audit',
    subtype: 'log',
    description: 'Session / agent JSONL log analysis.',
    priority: 130,
    match: [LOG_AUDIT_RE],
  },
  {
    id: 'unused-deps',
    subtype: 'unused_deps',
    description: 'Unused npm/pnpm dependency cleanup.',
    priority: 120,
    match: [/\b(unus(?:ed)?\s+dependenc|depcheck|dependencies\s+audit|dependency\s+audit|remove\s+unused\s+(?:npm|pnpm|package))\b/i],
  },
  {
    id: 'dead-code',
    subtype: 'dead_code',
    description: 'Dead/orphaned code and unused export cleanup.',
    priority: 115,
    match: [/\b(dead\s*code|unus(?:ed)?\s+(?:export|file|import)|knip|ts-prune|orphan)\b/i],
  },
  {
    id: 'vulnerability',
    subtype: 'vulnerability',
    description: 'CVE / dependency vulnerability scan.',
    priority: 110,
    match: [/\b(cve|vulnerabilit|security\s+audit|npm\s+audit|pnpm\s+audit|dependabot)\b/i],
  },
  {
    id: 'prompt-audit',
    subtype: 'prompt',
    description: 'System prompt / prompt-injection review.',
    priority: 105,
    match: [/\b(prompt\s+audit|system\s+prompt\s+review|prompt\s+injection)\b/i],
  },
  {
    id: 'security-config',
    subtype: 'security_config',
    description: 'Auth/CORS/CSP/secrets configuration review.',
    priority: 100,
    match: [/\b(security\s+config|auth(?:entication)?\s+config|cors|csp|helmet|oauth\s+config|secrets?\s+scan)\b/i],
  },
  {
    id: 'git-history-audit',
    subtype: 'git_history',
    description: 'Git history / blame audit.',
    priority: 95,
    match: [/\b(git\s+history\s+audit|history\s+audit|blame\s+audit)\b/i],
  },
  {
    id: 'ci-audit',
    subtype: 'ci',
    description: 'CI / workflow / pipeline audit.',
    priority: 90,
    match: [/\b(ci\s+audit|workflow\s+audit|github\s+actions\s+audit|pipeline\s+audit)\b/i],
  },
  {
    id: 'database-audit',
    subtype: 'database',
    description: 'Database / schema / migration audit.',
    priority: 85,
    match: [/\b(database\s+audit|schema\s+audit|sql\s+audit|migration\s+audit)\b/i],
  },
  {
    id: 'architecture-audit',
    subtype: 'architecture',
    description: 'Architecture / design review.',
    priority: 80,
    match: [/\b(architecture\s+audit|arch\s+review|design\s+audit)\b/i],
  },
  {
    id: 'code-quality-audit',
    subtype: 'code_quality',
    description: 'Lint / tech-debt / code-quality audit.',
    priority: 75,
    match: [/\b(code[- ]quality\s+audit|quality\s+audit|lint\s+audit|tech[- ]debt\s+audit)\b/i],
  },
  {
    id: 'generic-cleanup',
    subtype: 'generic',
    description: 'Cleanup-shaped audit without a more specific target (unused/dead-code/depcheck/knip language present).',
    priority: 20,
    match: [GENERIC_CLEANUP_RE],
  },
  {
    id: 'bare-audit-review',
    subtype: 'review',
    description: 'Bare "audit" mention with no cleanup language — a review, not a dependency/dead-code cleanup.',
    priority: 10,
    match: [/\baudit\b/i],
  },
] as const;

/** Highest-priority matching rule wins. Does not know about restoration-bugfix precedence — callers apply that first. */
export function matchAuditRule(text: string): AuditSubtype | undefined {
  const sorted = [...AUDIT_RULES].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (rule.match.some((pattern) => pattern.test(text))) return rule.subtype;
  }
  return undefined;
}

/** Cleanup-shaped audits that share the depcheck/knip/CVE script catalog and deep-plan treatment. */
const DEPENDENCY_CLEANUP_SUBTYPES: ReadonlySet<AuditSubtype> = new Set<AuditSubtype>([
  'unused_deps',
  'dead_code',
  // Vulnerability scans use their own dedicated script (audit-vulnerabilities.mjs) but are
  // deliberately treated as a cleanup-audit sibling throughout TaskAnalyzer/PlanExecutor/
  // promptBuilder/ChatOrchestrator — kept here so this stays the single source of truth.
  'vulnerability',
  'generic',
]);

export function isDependencyCleanupAudit(subtype?: AuditSubtype): boolean {
  return subtype !== undefined && DEPENDENCY_CLEANUP_SUBTYPES.has(subtype);
}
