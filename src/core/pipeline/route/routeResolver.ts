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

const LOG_AUDIT_RE =
  /\b(log\s*audit|analyze\s+(?:the\s+)?logs?|session\s*log|\.jsonl|mitii\/logs|jsonl)\b/i;

const UNUSED_DEPS_RE =
  /\b(unus(?:ed)?\s+dependenc|depcheck|dependencies\s+audit|dependency\s+audit|remove\s+unused\s+(?:npm|pnpm|package))\b/i;
const DEAD_CODE_RE = /\b(dead\s*code|unus(?:ed)?\s+(?:export|file|import)|knip|ts-prune|orphan)\b/i;
const VULN_RE = /\b(cve|vulnerabilit|security\s+audit|npm\s+audit|pnpm\s+audit|dependabot)\b/i;
const PROMPT_AUDIT_RE = /\b(prompt\s+audit|system\s+prompt\s+review|prompt\s+injection)\b/i;
const SECURITY_CONFIG_RE =
  /\b(security\s+config|auth(?:entication)?\s+config|cors|csp|helmet|oauth\s+config|secrets?\s+scan)\b/i;
const GIT_HISTORY_AUDIT_RE = /\b(git\s+history\s+audit|history\s+audit|blame\s+audit)\b/i;
const CI_AUDIT_RE = /\b(ci\s+audit|workflow\s+audit|github\s+actions\s+audit|pipeline\s+audit)\b/i;
const DB_AUDIT_RE = /\b(database\s+audit|schema\s+audit|sql\s+audit|migration\s+audit)\b/i;
const ARCH_AUDIT_RE = /\b(architecture\s+audit|arch\s+review|design\s+audit)\b/i;
const CODE_QUALITY_AUDIT_RE =
  /\b(code[- ]quality\s+audit|quality\s+audit|lint\s+audit|tech[- ]debt\s+audit)\b/i;
/** Broad "audit" — only after specific subtypes fail. Not every use of the word. */
const GENERIC_CLEANUP_RE =
  /\b(cleanup|clean\s+up|unused|dead\s*code|depcheck|knip|orphan\s+files?)\b/i;

const README_RE = /\b(readme|read\s*me|readfile)\b/i;
const DOCUSAURUS_RE = /\b(docusaurus|docs\s+site|docs\s+plugin|sidebars?\.tsx?)\b/i;
const MDX_RE = /\b(mdx|livecodeblock|unexpected character)\b/i;
const API_DOCS_RE = /\b(api\s+(?:docs?|reference|spec)|openapi|swagger)\b/i;
const ARCH_DOCS_RE = /\b(architecture\s+(?:doc|docs|readme|overview)|system\s+design\s+doc)\b/i;
const CHANGELOG_DOCS_RE = /\b(changelog|release\s+notes)\b/i;
const EXAMPLES_DOCS_RE = /\b(examples?\s+docs?|usage\s+examples?)\b/i;
const DOCS_RE = /\b(docs?|documentation|readme|mdx|docusaurus)\b/i;

export function classifyTaskSignals(userMessage: string, taskAnalysis?: TaskAnalysis): TaskClassification {
  const signals: string[] = [];
  if (taskAnalysis?.kind) signals.push(`kind:${taskAnalysis.kind}`);
  if (taskAnalysis?.actIntent) signals.push(`actIntent:${taskAnalysis.actIntent}`);
  if (taskAnalysis?.planIntent) signals.push(`planIntent:${taskAnalysis.planIntent}`);
  if (taskAnalysis?.gitRoute?.isGitTask) signals.push('git');
  if (LOG_AUDIT_RE.test(userMessage)) signals.push('log_audit');
  if (DOCS_RE.test(userMessage)) signals.push('docs');

  const primaryKind =
    taskAnalysis?.kind === 'implementation' &&
    (taskAnalysis.actIntent === 'docs' || taskAnalysis.planIntent === 'docs' || DOCS_RE.test(userMessage))
      ? 'docs'
      : taskAnalysis?.kind ?? 'unknown';

  return {
    primaryKind,
    confidence: taskAnalysis ? 0.85 : 0.5,
    signals,
    needsClarification: false,
  };
}

export function resolveAuditSubtype(text: string): AuditSubtype | undefined {
  if (LOG_AUDIT_RE.test(text)) return 'log';
  if (UNUSED_DEPS_RE.test(text)) return 'unused_deps';
  if (DEAD_CODE_RE.test(text)) return 'dead_code';
  if (VULN_RE.test(text)) return 'vulnerability';
  if (PROMPT_AUDIT_RE.test(text)) return 'prompt';
  if (SECURITY_CONFIG_RE.test(text)) return 'security_config';
  if (GIT_HISTORY_AUDIT_RE.test(text)) return 'git_history';
  if (CI_AUDIT_RE.test(text)) return 'ci';
  if (DB_AUDIT_RE.test(text)) return 'database';
  if (ARCH_AUDIT_RE.test(text)) return 'architecture';
  if (CODE_QUALITY_AUDIT_RE.test(text)) return 'code_quality';
  if (GENERIC_CLEANUP_RE.test(text)) return 'generic';
  // Bare "audit" without cleanup language → generic review, NOT depcheck
  if (/\baudit\b/i.test(text)) return 'generic';
  return undefined;
}

export function resolveDocsSubtype(text: string): DocsSubtype | undefined {
  if (MDX_RE.test(text) && /\b(fix|repair|error|build)\b/i.test(text)) return 'mdx_repair';
  if (DOCUSAURUS_RE.test(text)) return 'docusaurus';
  if (README_RE.test(text)) return 'readme';
  if (API_DOCS_RE.test(text)) return 'api_reference';
  if (ARCH_DOCS_RE.test(text)) return 'architecture';
  if (CHANGELOG_DOCS_RE.test(text)) return 'changelog';
  if (EXAMPLES_DOCS_RE.test(text)) return 'examples';
  if (DOCS_RE.test(text)) return 'generic';
  return undefined;
}

export function isDependencyCleanupAudit(subtype?: AuditSubtype): boolean {
  return subtype === 'unused_deps' || subtype === 'dead_code' || subtype === 'vulnerability' || subtype === 'generic';
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
  if (taskAnalysis?.kind === 'docs' || taskAnalysis?.actIntent === 'docs' || taskAnalysis?.planIntent === 'docs' || docsSubtype) {
    return 'docs';
  }
  if (auditSubtype || taskAnalysis?.kind === 'audit' || taskAnalysis?.actIntent === 'audit') {
    return 'audit';
  }
  if (taskAnalysis?.actIntent) return taskAnalysis.actIntent as PipelineIntent;
  if (taskAnalysis?.planIntent === 'bugfix') return 'bugfix';
  if (taskAnalysis?.planIntent === 'refactor') return 'refactor';
  if (taskAnalysis?.kind === 'debugging') return 'diagnose';
  if (taskAnalysis?.kind === 'question') return 'question';
  if (/\b(fix|bug|broken)\b/i.test(text)) return 'bugfix';
  return 'feature';
}

function resolveOperationClass(
  intent: PipelineIntent,
  isGitTask: boolean,
  gitRoute?: TaskAnalysis['gitRoute']
): OperationClass {
  if (intent === 'log_audit') return 'log_analyze';
  if (intent === 'question') return 'read';
  if (isGitTask) {
    const route = gitRoute?.route;
    if (route === 'release_management') return 'release';
    if (
      route === 'git_local_write' ||
      route === 'git_workspace_edit' ||
      route === 'github_remote_write' ||
      route === 'github_actions'
    ) {
      return 'git_write';
    }
    return 'read';
  }
  if (intent === 'audit' || intent === 'diagnose') return 'shell';
  return 'edit';
}

function resolveRisk(
  intent: PipelineIntent,
  operationClass: OperationClass,
  complexity: TaskAnalysis['complexity'] | undefined,
  gitRoute?: TaskAnalysis['gitRoute']
): RiskLevel {
  if (gitRoute?.risk) return gitRoute.risk as RiskLevel;
  if (operationClass === 'release') return 'high';
  if (operationClass === 'git_write') return 'medium';
  if (intent === 'audit' && complexity === 'high') return 'medium';
  if (complexity === 'high') return 'medium';
  if (intent === 'question' || intent === 'log_audit' || intent === 'docs') return 'low';
  return 'low';
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
  /** When false, force direct even if taskAnalysis.shouldPlan. */
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
  const auditSubtype =
    taskAnalysis?.auditSubtype ??
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
    DOCS_RE.test(text)
      ? resolveDocsSubtype(text)
      : undefined);

  const intent = mapIntent(taskAnalysis, text, auditSubtype, docsSubtype);
  const isGitTask = Boolean(taskAnalysis?.gitRoute?.isGitTask);
  const operationClass = resolveOperationClass(intent, isGitTask, taskAnalysis?.gitRoute);
  const risk = resolveRisk(intent, operationClass, taskAnalysis?.complexity, taskAnalysis?.gitRoute);

  const shouldPlan =
    !options.forceDirect &&
    intent !== 'log_audit' &&
    intent !== 'question' &&
    // README / simple docs: prefer direct unless explicitly high complexity
    !(intent === 'docs' && docsSubtype === 'readme' && taskAnalysis?.complexity !== 'high') &&
    (taskAnalysis?.shouldPlan ?? false);

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

export function buildRoutePolicyText(route: RouteResolution): string {
  const lines = [
    '## Route policy',
    `Intent: ${route.intent}`,
    `Execution path: ${route.executionPath}`,
    `Risk: ${route.risk}`,
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
  }

  return lines.join('\n');
}
