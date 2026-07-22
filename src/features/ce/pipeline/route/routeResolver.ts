import type { TaskAnalysis } from '../../runtime/TaskAnalyzer';
import type {
  AuditSubtype,
  DocsSubtype,
  OperationClass,
  PipelineIntent,
  RiskLevel,
  RouteResolution,
  TaskClassification,
} from '../types';
import { LOG_AUDIT_RE, GENERIC_CLEANUP_RE, matchAuditRule, isDependencyCleanupAudit } from './auditRules';
import { DOCS_MENTION_RE, matchDocsRule } from './docsRules';
import { MUTATION_VERBS_RE, READ_ONLY_VERBS_RE, WRITE_AUTHORIZING_ACT_INTENTS } from './constants';
import { resolveRiskFactors } from './riskEngine';

export { isDependencyCleanupAudit } from './auditRules';

const RESTORATION_BUGFIX_RE =
  /\b(?:restore|revert|roll\s*back|undo|back\s*out|original\s+(?:state|structure)|previous\s+(?:state|structure)|bring\s+(?:the\s+)?project\s+back|half[-\s]?(?:finished|implemented|implemneted|done)|failed\s+restructur|broken\s+restructur)\b/i;
const FAILURE_FIX_RE =
  /\b(?:fix|repair|correct|resolve)\b[\s\S]{0,100}\b(?:build|compile|test|failure|error|broken|failing)\b|\b(?:build|compile|test)\b[\s\S]{0,100}\b(?:fail|fails|failed|error|broken)\b/i;

const VALID_PIPELINE_INTENTS = new Set<PipelineIntent>([
  'bugfix',
  'feature',
  'refactor',
  'docs',
  'audit',
  'log_audit',
  'question',
  'diagnose',
  'git',
  'greeting',
  'spike',
]);

const VALID_RISK_LEVELS = new Set<RiskLevel>(['low', 'medium', 'high', 'critical']);

export function classifyTaskSignals(userMessage: string, taskAnalysis?: TaskAnalysis): TaskClassification {
  const signals: string[] = [];
  const features = taskAnalysis?.features;
  if (taskAnalysis?.kind) signals.push(`kind:${taskAnalysis.kind}`);
  if (taskAnalysis?.actIntent) signals.push(`actIntent:${taskAnalysis.actIntent}`);
  if (taskAnalysis?.planIntent) signals.push(`planIntent:${taskAnalysis.planIntent}`);
  if (taskAnalysis?.gitRoute?.isGitTask) signals.push('git');
  if (features?.isLogAudit || LOG_AUDIT_RE.test(userMessage)) signals.push('log_audit');
  if (features?.isDocsMention || DOCS_MENTION_RE.test(userMessage)) signals.push('docs');
  if (isRepositoryRestorationBugfix(userMessage, taskAnalysis)) signals.push('repository_restoration_bugfix');
  if (features?.isMdxRepair) signals.push('mdx_repair');

  const primaryKind =
    taskAnalysis?.kind === 'implementation' &&
    (taskAnalysis.actIntent === 'docs' || taskAnalysis.planIntent === 'docs' || DOCS_MENTION_RE.test(userMessage))
      ? 'docs'
      : taskAnalysis?.kind ?? 'unknown';

  // Real evidence-based confidence instead of a flat 0.85/0.5 split: each concrete signal
  // adds weight, capped so this never claims certainty a regex match can't back up.
  const base = taskAnalysis ? 0.6 : 0.4;
  const confidence = Math.min(0.95, base + signals.length * 0.08);

  // These four signals are mutually exclusive domains; if 2+ fire at once, mapIntent's
  // fixed precedence silently picks one and drops the rest — flag that instead of hiding it.
  const domainSignals = ['log_audit', 'docs', 'git', 'repository_restoration_bugfix'];
  const domainHits = signals.filter((signal) => domainSignals.includes(signal)).length;

  return {
    primaryKind,
    confidence,
    signals,
    needsClarification: domainHits >= 2,
  };
}

export function resolveAuditSubtype(text: string): AuditSubtype | undefined {
  if (isRepositoryRestorationBugfix(text)) return undefined;
  return matchAuditRule(text);
}

export function resolveDocsSubtype(text: string): DocsSubtype | undefined {
  return matchDocsRule(text);
}

function mapIntent(
  taskAnalysis: TaskAnalysis | undefined,
  text: string,
  auditSubtype?: AuditSubtype,
  docsSubtype?: DocsSubtype
): PipelineIntent {
  // Session / JSONL log analysis wins over git (bare "log" must not steal this route).
  if (
    auditSubtype === 'log' ||
    taskAnalysis?.kind === 'log_audit' ||
    taskAnalysis?.actIntent === 'log_audit' ||
    taskAnalysis?.askIntent === 'log_analysis'
  ) {
    return 'log_audit';
  }
  if (taskAnalysis?.gitRoute?.isGitTask) return 'git';
  if (isRepositoryRestorationBugfix(text, taskAnalysis)) return 'bugfix';
  if (taskAnalysis?.kind === 'docs' || taskAnalysis?.actIntent === 'docs' || taskAnalysis?.planIntent === 'docs' || docsSubtype) {
    return 'docs';
  }
  if (auditSubtype || taskAnalysis?.kind === 'audit' || taskAnalysis?.actIntent === 'audit') {
    return 'audit';
  }
  if (taskAnalysis?.actIntent === 'bugfix' || isBugfixLikeRequest(text)) {
    return 'bugfix';
  }
  if (taskAnalysis?.actIntent && VALID_PIPELINE_INTENTS.has(taskAnalysis.actIntent)) {
    return taskAnalysis.actIntent;
  }
  if (taskAnalysis?.planIntent === 'bugfix') return 'bugfix';
  if (taskAnalysis?.planIntent === 'refactor') return 'refactor';
  if (taskAnalysis?.kind === 'debugging') return 'diagnose';
  if (taskAnalysis?.kind === 'question') return 'question';
  return 'feature';
}

function hasWriteAuthorization(taskAnalysis: TaskAnalysis | undefined, text: string): boolean {
  if (taskAnalysis?.actIntent && WRITE_AUTHORIZING_ACT_INTENTS.has(taskAnalysis.actIntent)) return true;
  return MUTATION_VERBS_RE.test(text);
}

function resolveOperationClass(
  intent: PipelineIntent,
  isGitTask: boolean,
  gitRoute: TaskAnalysis['gitRoute'] | undefined,
  taskAnalysis: TaskAnalysis | undefined,
  text: string,
  resumeSavedPlan: boolean,
  auditSubtype?: AuditSubtype
): OperationClass {
  if (resumeSavedPlan) return 'execute_saved_plan';
  if (intent === 'log_audit') return 'log_analyze';
  if (intent === 'question') return 'inspect';
  if (isGitTask) {
    const route = gitRoute?.route;
    if (route === 'release_management') return 'release';
    if (gitRoute?.classification.requiresRemoteWrite) return 'remote_write';
    if (gitRoute?.classification.requiresGitWrite) return 'local_git_write';
    if (gitRoute?.classification.requiresWorkspaceWrite || route === 'git_workspace_edit') {
      return 'workspace_write';
    }
    return 'inspect';
  }
  // A question / explanatory askIntent only forces read-only when nothing else in the
  // request actually authorizes a change — otherwise "explain how I can fix this" and
  // "fix this, can you explain what's wrong" would both collapse to inspect.
  if (!hasWriteAuthorization(taskAnalysis, text)) {
    if (
      taskAnalysis?.kind === 'question' ||
      taskAnalysis?.askIntent ||
      (READ_ONLY_VERBS_RE.test(text) && !MUTATION_VERBS_RE.test(text))
    ) {
      return 'inspect';
    }
  }
  if (
    intent === 'audit' &&
    isDependencyCleanupAudit(auditSubtype) &&
    /\b(remove|delete|clean\s*up|cleanup|fix|update)\b/i.test(text)
  ) {
    return 'workspace_write';
  }
  if (
    intent === 'diagnose' &&
    /\b(fix|repair|update|change|patch)\b/i.test(text)
  ) {
    return 'workspace_write';
  }
  // Audit/diagnose with no detected mutation is read-oriented by default — an operation
  // "mechanism" like shell isn't an effect, so this resolves to inspect rather than a
  // pseudo-class nothing downstream consumes.
  if (intent === 'audit' || intent === 'diagnose') return 'inspect';
  return 'workspace_write';
}

function resolveExecutionPath(
  intent: PipelineIntent,
  docsSubtype: DocsSubtype | undefined,
  auditSubtype: AuditSubtype | undefined,
  options: { mdxRepairMode?: boolean; resumeSavedPlan?: boolean; shouldPlan?: boolean }
): RouteResolution['executionPath'] {
  if (options.resumeSavedPlan) return 'resume_saved_plan';
  if (intent === 'log_audit') return 'log_audit';
  if (options.mdxRepairMode || docsSubtype === 'mdx_repair') return 'mdx_repair';
  if (intent === 'audit' && isDependencyCleanupAudit(auditSubtype)) return 'audit';
  if (options.shouldPlan) return 'orchestrated';
  return 'direct';
}

export interface ResolveRouteOptions {
  mdxRepairMode?: boolean;
  resumeSavedPlan?: boolean;
  /** When true, force direct execution even if taskAnalysis.shouldPlan. */
  forceDirect?: boolean;
}

/**
 * Unified route object consumed by depth / skills / capabilities.
 */
export function resolveRoute(
  userMessage: string,
  taskAnalysis?: TaskAnalysis,
  options: ResolveRouteOptions = {}
): RouteResolution {
  const text = userMessage.trim();
  const restorationBugfix = isRepositoryRestorationBugfix(text, taskAnalysis);
  const auditSubtype =
    restorationBugfix
      ? undefined
      : taskAnalysis?.auditSubtype ??
        (taskAnalysis?.kind === 'audit' ||
        taskAnalysis?.kind === 'log_audit' ||
        taskAnalysis?.askIntent === 'log_analysis' ||
        /\baudit\b/i.test(text) ||
        GENERIC_CLEANUP_RE.test(text)
          ? resolveAuditSubtype(text)
          : undefined);
  const docsSubtype =
    taskAnalysis?.docsSubtype ??
    (taskAnalysis?.kind === 'docs' ||
    taskAnalysis?.actIntent === 'docs' ||
    taskAnalysis?.planIntent === 'docs' ||
    DOCS_MENTION_RE.test(text)
      ? resolveDocsSubtype(text)
      : undefined);

  const intent = mapIntent(taskAnalysis, text, auditSubtype, docsSubtype);
  const isGitTask = Boolean(taskAnalysis?.gitRoute?.isGitTask);
  const operationClass = resolveOperationClass(
    intent,
    isGitTask,
    taskAnalysis?.gitRoute,
    taskAnalysis,
    text,
    Boolean(options.resumeSavedPlan),
    auditSubtype
  );

  const gitRiskLevel = taskAnalysis?.gitRoute?.risk;
  let risk: RiskLevel;
  let riskReasons: string[];
  if (restorationBugfix && operationClass === 'workspace_write') {
    risk = 'high';
    riskReasons = ['repository restoration / bugfix override'];
  } else if (gitRiskLevel && VALID_RISK_LEVELS.has(gitRiskLevel as RiskLevel)) {
    risk = gitRiskLevel as RiskLevel;
    riskReasons = ['delegated to Git intent risk model'];
  } else {
    const assessment = resolveRiskFactors(operationClass, text, taskAnalysis?.complexity);
    risk = assessment.level;
    riskReasons = assessment.reasons;
  }

  const shouldPlan =
    !options.forceDirect &&
    intent !== 'log_audit' &&
    intent !== 'question' &&
    // README / simple docs: prefer direct unless explicitly high complexity
    !(intent === 'docs' && docsSubtype === 'readme' && taskAnalysis?.complexity !== 'high') &&
    (restorationBugfix || (taskAnalysis?.shouldPlan ?? false));

  const executionPath = resolveExecutionPath(intent, docsSubtype, auditSubtype, {
    mdxRepairMode: options.mdxRepairMode,
    resumeSavedPlan: options.resumeSavedPlan,
    shouldPlan,
  });

  return {
    intent,
    auditSubtype,
    docsSubtype,
    risk,
    riskReasons,
    operationClass,
    executionPath,
    isGitTask,
    summary: [
      `intent=${intent}`,
      auditSubtype ? `auditSubtype=${auditSubtype}` : undefined,
      docsSubtype ? `docsSubtype=${docsSubtype}` : undefined,
      `op=${operationClass}`,
      `path=${executionPath}`,
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

export function isRepositoryRestorationBugfix(text: string, taskAnalysis?: TaskAnalysis): boolean {
  const combined = `${text} ${taskAnalysis?.summary ?? ''}`;
  if (!RESTORATION_BUGFIX_RE.test(combined)) return false;
  return FAILURE_FIX_RE.test(combined) || /\b(?:fix|repair|restore|revert|build|compile|failing|failed|broken|error)\b/i.test(combined);
}

function isBugfixLikeRequest(text: string): boolean {
  return /\b(fix|repair|resolve|correct|debug|troubleshoot|bug|broken|failing|failed|error|issue)\b/i.test(text);
}

export function buildRoutePolicyText(route: RouteResolution): string {
  const lines = [
    '## Route policy',
    `Intent: ${route.intent}`,
    `Execution path: ${route.executionPath}`,
    route.riskReasons?.length ? `Risk: ${route.risk} (${route.riskReasons.join('; ')})` : `Risk: ${route.risk}`,
    `Operation class: ${route.operationClass}`,
  ];
  if (route.auditSubtype) lines.push(`Audit subtype: ${route.auditSubtype}`);
  if (route.docsSubtype) lines.push(`Docs subtype: ${route.docsSubtype}`);

  if (route.intent === 'docs' && route.docsSubtype === 'readme') {
    lines.push(
      '',
      '## Docs (README) contract',
      '- Write or update README.md files only; do not run full app builds unless the user asks.',
      '- Discover structure via list_files / read_file / package.json / existing READMEs.',
      '- Do not call release_plan_controller, git write tools, or mark_step_complete unless they are offered.',
      '- Prefer builtin read_file / write_file over MCP filesystem tools.'
    );
  } else if (route.intent === 'docs' && route.docsSubtype === 'docusaurus') {
    lines.push(
      '',
      '## Docs (Docusaurus) contract',
      '- Inspect docusaurus.config, sidebars, and navbar before writing pages.',
      '- Verify with the docs build command from package.json.'
    );
  } else if (route.intent === 'audit' && isDependencyCleanupAudit(route.auditSubtype)) {
    lines.push(
      '',
      '## Audit (dependency / dead-code) contract',
      '- Prefer execute_workspace_script audit-dependencies / audit-dead-code / audit-vulnerabilities.',
      '- Do not treat non-cleanup audits as depcheck tasks.'
    );
  } else if (route.intent === 'audit' && route.auditSubtype && !isDependencyCleanupAudit(route.auditSubtype)) {
    lines.push(
      '',
      `## Audit (${route.auditSubtype}) contract`,
      '- This is NOT an unused-dependency / knip cleanup.',
      '- Scope tools and findings to the named audit subtype only.'
    );
  } else if (route.intent === 'log_audit') {
    lines.push(
      '',
      '## Log audit contract',
      '- Use analyze_log_directory / analyze_jsonl first; do not raw-read large logs.'
    );
  } else if (route.intent === 'bugfix') {
    lines.push(
      '',
      '## Bugfix contract',
      '- Current build/test/runtime diagnostics outrank previous-session hypotheses.',
      '- Run one baseline reproduction check, treat a nonzero exit as captured diagnostic evidence, and do not rerun equivalent checks before editing.',
      '- Scope first reads and edits to files named by current diagnostics plus directly referenced definitions/callers.',
      '- Do not propose structural rewrites, duplicate-tree cleanup, or architecture questions unless current diagnostics directly require them.'
    );
  }

  return lines.join('\n');
}
