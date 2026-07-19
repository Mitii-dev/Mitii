import { extractOriginalTaskMessage, isApprovalContinuationMessage, splitConversationContext } from './taskMessage';
import { routeAskIntent } from '../modes/ask/AskIntentRouter';
import { routePlanIntent } from '../modes/plan/PlanIntentRouter';
import type { AskIntent } from '../modes/ask/askTypes';
import type { PlanIntent } from '../modes/plan/planTypes';
import type { ActIntent } from '../modes/agent/actTypes';
import { isLogAuditTask } from './logAudit';
import { resolveGitRoute, type GitRouteResolution } from '../../../features/ce/git/intents';
import { resolveAuditSubtype, resolveDocsSubtype } from '../pipeline/route/routeResolver';
import { DIAGNOSTIC_REQUEST } from './diagnosticRequest';

export type TaskKind =
  | 'question'
  | 'audit'
  | 'log_audit'
  | 'simple_edit'
  | 'implementation'
  | 'docs'
  | 'explicit_plan'
  | 'debugging'
  | 'git';

export type TaskComplexity = 'low' | 'medium' | 'high';

export type AuditSubtype =
  | 'unused_deps'
  | 'dead_code'
  | 'vulnerability'
  | 'log'
  | 'prompt'
  | 'security_config'
  | 'git_history'
  | 'ci'
  | 'database'
  | 'architecture'
  | 'code_quality'
  | 'generic';

export type DocsSubtype =
  | 'readme'
  | 'api_reference'
  | 'architecture'
  | 'docusaurus'
  | 'mdx_repair'
  | 'changelog'
  | 'examples'
  | 'generic';

export interface TaskAnalysis {
  kind: TaskKind;
  complexity: TaskComplexity;
  shouldPlan: boolean;
  shouldVerify: boolean;
  shouldUseSubagents: boolean;
  summary: string;
  askIntent?: AskIntent;
  askProfile?: import('../modes/ask/askTypes').AskResponseProfile;
  planIntent?: PlanIntent;
  actIntent?: ActIntent;
  gitRoute?: GitRouteResolution;
  /** Set by pipeline / TaskAnalyzer for audit framing. */
  auditSubtype?: AuditSubtype;
  /** Set for documentation tasks (README vs Docusaurus, etc.). */
  docsSubtype?: DocsSubtype;
}

export interface TaskAnalysisOptions {
  askIntent?: AskIntent;
  planIntent?: PlanIntent;
  actIntent?: ActIntent;
}

const ACTION_VERB_SOURCE =
  String.raw`\b(?:implement|build|create|add|fix|refactor|migrate|rewrite|update|remove|delete|integrate|wire|connect|setup|configure|optimize|improve|imporve|enhance|polish|redesign|debug|test|change|replace)\b`;

const ACTION_VERBS = new RegExp(ACTION_VERB_SOURCE, 'i');
const ACTION_VERBS_GLOBAL = new RegExp(ACTION_VERB_SOURCE, 'gi');

const IMPLEMENTATION_HINTS =
  /\b(need|change|replace|ui|ux|landing page|animated|animation|enterprise|implement|create|fix|docs?|documentation|docusaurus|examples?)\b/i;

const UI_POLISH_SCOPE =
  /\b(ui|ux|layout|component|components|card|cards|child components?|screen|view|style|styles|visual|visuals|interaction|interactions)\b/i;

const EXPLICIT_PLAN =
  /step[- ]by[- ]step|break(?: it)? down|multi[- ]step|\b(create|make) a plan\b|\bplan (?:this|out)\b|execution plan/i;

const QUESTION =
  /^(what|how|why|where|when|who|which|explain|describe|tell me|show me|list|summarize|overview)\b/i;

const DIRECT_ERROR_FIX =
  /\b(syntax error|type ?error|referenceerror|cannot find module|missing semicolon|unexpected token|unexpected character|parse error|compilation (?:error|failed)|build failed|failed to compile|failed to fetch|mdx compilation failed|could not parse expression|is not defined|enoent|can'?t resolve|module not found|compiled with problems)\b/i;

const DIAGNOSTIC_SCOPE_EXPANDING =
  /\b(refactor|redesign|rewrite|migrate|implement (?:a|the) new|new feature|entire codebase|whole codebase|across (?:the )?(?:whole|entire)?\s*(?:codebase|project|repo))\b/i;

const FILE_PATH_IN_TEXT =
  /(?:^|\s|['"`])([\w./-]+\.(?:tsx?|jsx?|py|go|rs|json|css|scss|mdx?))\b/i;

const BUGFIX_ACTION =
  /\b(fix|repair|resolve|correct|debug|troubleshoot)\b/i;

const PROJECT_SCOPE_TARGET =
  /(?:^|\s)@[\w.-]+\b|\b(?:this|the|entire|whole|full)?\s*(?:project|repo|repository|workspace|codebase|package|service|app|application)\b/i;

const UNBOUNDED_REPAIR_SCOPE =
  /\b(?:fix|repair|resolve|correct)\s+all\b|\b(?:all|every|entire|whole|full|current)\b[\s\S]{0,80}\b(?:issues?|bugs?|errors?|failures?|problems?|failing tests?|build errors?)\b/i;

const SIMPLE_EDIT =
  /\b(fix typo|rename|change (?:the )?(?:name|text|label)|update import|add comment|format)\b/i;

const SIMPLE_CONTENT_APPEND =
  /\b(add|append|insert|extend|update)\b[\s\S]{0,100}\b(?:day|days|row|rows|line|lines|entry|entries|section|sections|module|modules)\b/i;

const SIMPLE_FILE_TARGET =
  /\b(?:to|in|into|at (?:the )?end of)\b[\s\S]{0,80}\b[\w./-]+\.(txt|md|csv|json|yaml|yml)\b|\b(?:plan|roadmap|curriculum|schedule)\b/i;

const AUDIT_CLEANUP_TARGET =
  /\b(?:un(?:used|sed)\s+(?:dependenc(?:y|ies)|deps?|imports?|exports?|files?)|dead\s+code|orphan(?:ed)?\s+(?:files?|exports?)|dependenc(?:y|ies)|deps?|depcheck|knip|ts-prune|tree[- ]shak(?:e|ing)|bundle)\b/i;

const AUDIT_CLEANUP_ACTION =
  /\b(?:audit|scan|check|find|detect|remove|clean(?:\s+up)?|cleanup|run|identify|list|reduce)\b/i;

const DOCS_IMPLEMENTATION =
  /\b(add|create|write|update|generate|build)\b[\s\S]{0,80}\b(docs?|documentation|docusaurus|mdx?|examples?)\b|\b(docs?|documentation|docusaurus|mdx?|examples?)\b[\s\S]{0,80}\b(all|every|features?|components?|exports?|api|route|sidebar|navbar|installation|configuration)\b/i;

export function analyzeTask(userMessage: string, mode: string, options: TaskAnalysisOptions = {}): TaskAnalysis {
  const text = userMessage.trim();
  const isContinuation = isApprovalContinuationMessage(text);
  const taskText = extractOriginalTaskMessage(text) ?? text;

  if (isContinuation) {
    const original = classifyTask(taskText);
    return {
      ...original,
      shouldPlan: mode === 'plan' ? original.shouldPlan : false,
      shouldUseSubagents: false,
      summary: mode === 'plan'
        ? `Plan-mode continuation review — do not execute: ${original.summary}`
        : `Approval continuation — resume: ${original.summary}`,
    };
  }

  const classified = classifyTask(taskText);
  const gitRoute = resolveGitRoute(taskText, mode);
  // Prefer already-classified domain work (log audit / docs / implementation) over git.
  const gitWouldOverrideDomain =
    classified.kind === 'log_audit' ||
    classified.kind === 'docs' ||
    classified.kind === 'implementation' ||
    isLogAuditTask(taskText);
  if (gitRoute.isGitTask && gitRoute.classification.metadata && !gitWouldOverrideDomain) {
    const gitAnalysis: TaskAnalysis = {
      kind: 'git',
      complexity: gitRoute.risk === 'critical' || gitRoute.risk === 'high' ? 'high' : gitRoute.risk === 'medium' ? 'medium' : 'low',
      shouldPlan: gitRoute.requiredApproval !== 'none' || gitRoute.route === 'release_management',
      shouldVerify: gitRoute.classification.requiresWorkspaceWrite || gitRoute.classification.requiresGitWrite || gitRoute.classification.requiresRemoteWrite,
      shouldUseSubagents: false,
      summary: `Git route ${gitRoute.route} — intent ${gitRoute.classification.primaryIntent}, approval ${gitRoute.requiredApproval}.`,
      actIntent: options.actIntent,
      gitRoute,
    };
    if (mode === 'ask') {
      return { ...gitAnalysis, kind: 'question', shouldPlan: false, shouldVerify: false };
    }
    if (mode === 'plan') {
      return { ...gitAnalysis, shouldPlan: true, shouldVerify: false };
    }
    if (mode === 'agent') return gitAnalysis;
  }
  if (mode === 'ask') {
    const askRoute = routeAskIntent(taskText, options.askIntent ? { intent: options.askIntent } : undefined);
    if (askRoute.intent === 'log_analysis' || isLogAuditTask(taskText)) {
      return {
        kind: 'log_audit',
        complexity: 'low',
        shouldPlan: false,
        shouldVerify: false,
        shouldUseSubagents: false,
        summary: askRoute.summary,
        askIntent: 'log_analysis',
        askProfile: askRoute.profile,
        actIntent: 'log_audit',
      };
    }
    return {
      kind: 'question',
      complexity: estimateAskComplexity(askRoute.intent, taskText),
      shouldPlan: false,
      shouldVerify: false,
      shouldUseSubagents: askRoute.shouldUseSubagents,
      summary: askRoute.summary,
      askIntent: askRoute.intent,
      askProfile: askRoute.profile,
    };
  }

  if (mode === 'plan') {
    const planRoute = routePlanIntent(taskText, classified, options.planIntent ? { intent: options.planIntent } : undefined);
    return {
      ...classified,
      complexity: planRoute.complexity,
      shouldPlan: planRoute.forcePlan,
      shouldVerify: false,
      shouldUseSubagents:
        planRoute.shouldUseSubagents ||
        classified.shouldUseSubagents ||
        (classified.kind === 'audit' && !/\bdependenc/i.test(taskText)),
      summary: planRoute.summary,
      planIntent: planRoute.intent,
    };
  }

  if (mode !== 'agent') {
    return {
      kind: 'question',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: false,
      shouldUseSubagents: false,
      summary: 'Non-agent mode — respond without execution.',
    };
  }

  return applyActIntent(classified, options.actIntent, taskText);
}

function estimateAskComplexity(
  intent: import('../modes/ask/askTypes').AskIntent,
  text: string
): TaskComplexity {
  if (intent === 'general_knowledge' || intent === 'locate') return 'low';
  if (intent === 'implement_here' || intent === 'cross_project' || intent === 'architecture') return 'high';
  const base = estimateComplexity(text);
  return base === 'low' ? 'medium' : base;
}

function classifyTask(text: string): TaskAnalysis {
  const lower = text.toLowerCase();
  // A quoted prior turn (appended by resolveConversationTaskMessage) can be a long
  // pasted error/stack trace — great for pattern matches above, but it should not
  // inflate complexity/scope scoring for what is actually a short new instruction.
  const { primary } = splitConversationContext(text);

  // Prefer log-audit before dependency-audit: both may match "audit" wording.
  if (isLogAuditTask(text)) {
    return {
      kind: 'log_audit',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: false,
      shouldUseSubagents: false,
      summary: 'Log audit — analyze_jsonl first; no repo RAG, subagents, or full-file reads.',
      actIntent: 'log_audit',
    };
  }

  // Dependency / dead-code cleanup only — bare "audit" is handled later as generic review.
  if (isAuditCleanupRequest(text)) {
    const auditSubtype = resolveAuditSubtype(text) ?? 'generic';
    const isCleanup =
      auditSubtype === 'unused_deps' ||
      auditSubtype === 'dead_code' ||
      auditSubtype === 'vulnerability' ||
      auditSubtype === 'generic';
    return {
      kind: 'audit',
      complexity: isCleanup ? 'high' : 'medium',
      shouldPlan: isCleanup,
      shouldVerify: true,
      shouldUseSubagents: false,
      auditSubtype,
      summary: isCleanup
        ? `Audit/cleanup (${auditSubtype}) — run script catalog (depcheck/knip/CVE) first; avoid dependency subagents.`
        : `Audit (${auditSubtype}) — not a dependency/dead-code cleanup; scope tools to this subtype.`,
      actIntent: 'audit',
    };
  }

  if (EXPLICIT_PLAN.test(text)) {
    return {
      kind: 'explicit_plan',
      complexity: estimateComplexity(primary),
      shouldPlan: true,
      shouldVerify: true,
      shouldUseSubagents: primary.length > 200,
      summary: 'User requested explicit step-by-step plan.',
    };
  }

  if (QUESTION.test(lower) && !ACTION_VERBS.test(text)) {
    return {
      kind: 'question',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: false,
      shouldUseSubagents: false,
      summary: 'Informational question — answer directly.',
    };
  }

  if (DIRECT_ERROR_FIX.test(text)) {
    const fileMatch = text.match(FILE_PATH_IN_TEXT);
    const isMdx = /\bmdx\b|docusaurus|\.mdx?\b/i.test(text);
    return {
      kind: 'simple_edit',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: isMdx
        ? fileMatch
          ? `MDX/Docusaurus compilation error in ${fileMatch[1]} — read the named file, patch only that file first, then rerun the docs build.`
          : 'MDX/Docusaurus compilation error — fix the named build-output file directly, then rerun the docs build.'
        : fileMatch
          ? `Compiler/runtime error in ${fileMatch[1]} — fix directly without replanning.`
          : 'Error report — fix directly without replanning.',
    };
  }

  if (DIAGNOSTIC_REQUEST.test(text) && !DIAGNOSTIC_SCOPE_EXPANDING.test(text)) {
    const fileMatch = text.match(FILE_PATH_IN_TEXT);
    return {
      kind: 'debugging',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: fileMatch
        ? `Diagnosis request — read ${fileMatch[1]}, identify the root cause, and report or apply a minimal fix without replanning.`
        : 'Diagnosis request — read the referenced file(s)/logs, identify the root cause, and report or apply a minimal fix without replanning.',
    };
  }

  if (SIMPLE_EDIT.test(text) && text.length < 120) {
    return {
      kind: 'simple_edit',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: 'Small targeted edit — execute directly with validation.',
    };
  }

  if (
    SIMPLE_CONTENT_APPEND.test(text) &&
    (SIMPLE_FILE_TARGET.test(text) || text.length < 180) &&
    !/\b(refactor|migrate|implement|build|across|entire|whole codebase)\b/i.test(text)
  ) {
    return {
      kind: 'simple_edit',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: 'Single-file content append — read the target file and patch directly.',
    };
  }

  if (DOCS_IMPLEMENTATION.test(text) || /\b(readme|read\s*me|readfile)\b/i.test(text)) {
    const docsSubtype = resolveDocsSubtype(text) ?? 'generic';
    const docsComplexity = estimateComplexity(primary) === 'low' ? 'medium' : estimateComplexity(primary);
    const isReadme = docsSubtype === 'readme';
    return {
      kind: 'docs',
      complexity: docsComplexity,
      // README / package docs: execute directly; Docusaurus sites may still plan.
      shouldPlan: !isReadme && docsComplexity !== 'low',
      shouldVerify: docsSubtype === 'docusaurus' || docsSubtype === 'mdx_repair',
      shouldUseSubagents: false,
      docsSubtype,
      actIntent: 'docs',
      summary: isReadme
        ? `README documentation (${docsComplexity}) — write/update README via discovery + write_file; skip full app builds.`
        : `Documentation task (${docsSubtype}, ${docsComplexity}) — follow documentation skill; Docusaurus needs routing/sidebar checks.`,
    };
  }

  const actionCount = primary.match(ACTION_VERBS_GLOBAL)?.length ?? 0;
  const connectorCount = (primary.match(/\b(and|then|also|after that|next)\b/gi) ?? []).length;
  const fileMentions = (primary.match(/[`'"]?[\w./-]+\.(tsx?|jsx?|py|go|rs|json|md|css|scss|yaml|yml)[`'"]?/gi) ?? []).length;
  const broadProjectRepair = isBroadProjectRepairRequest(primary);
  const estimatedComplexity = estimateComplexity(primary);
  const complexity: TaskComplexity =
    broadProjectRepair && estimatedComplexity === 'low'
      ? 'medium'
      : estimatedComplexity;

  const hasImplementationHint = IMPLEMENTATION_HINTS.test(primary);
  const isUiPolishTask = (ACTION_VERBS.test(primary) || hasImplementationHint) && UI_POLISH_SCOPE.test(primary);

  const connectorImpliesMultiStep =
    connectorCount >= 1 && (primary.length > 140 || complexity !== 'low' || fileMentions >= 2);

  const isImplementation =
    isUiPolishTask ||
    (actionCount >= 1 &&
      (hasImplementationHint ||
        connectorImpliesMultiStep ||
        fileMentions >= 2 ||
        primary.length > 140 ||
        complexity !== 'low'));

  if (isImplementation) {
    const hasMigration = /\b(migrat(?:e|ion)|schema change|data backfill|breaking change)\b/i.test(primary);
    const hasDestructiveOperation = /\b(delete|drop|purge|rewrite history|force push|reset --hard)\b/i.test(primary);
    const hasMaterialAmbiguity =
      /\b(figure out|decide|choose the best|whatever is needed|as appropriate|unsure)\b/i.test(primary);
    const hasDependentComponents =
      broadProjectRepair ||
      fileMentions >= 5 ||
      /\b(across (?:multiple|all)|(?:for|across)\s+all\s+(?:routes|packages|components|modules|files)|end[- ]to[- ]end|frontend and backend|client and server|child components?|dependent components?|separate\s+\w+\s+mode)\b/i.test(primary);
    const shouldPlan =
      complexity === 'high' ||
      hasDependentComponents ||
      hasMigration ||
      hasDestructiveOperation ||
      hasMaterialAmbiguity;
    return {
      kind: 'implementation',
      complexity,
      shouldPlan,
      shouldVerify: true,
      shouldUseSubagents: complexity === 'high',
      actIntent: broadProjectRepair ? 'bugfix' : undefined,
      summary: broadProjectRepair
        ? `Project repair task (${complexity} complexity) — reproduce the current failures, scope to the first error cluster, patch, then verify.`
        : shouldPlan
        ? `Implementation task (${complexity} complexity) — plan because risk, dependencies, or ambiguity require coordination.`
        : `Implementation task (${complexity} complexity) — execute directly with focused verification.`,
    };
  }

  if (actionCount >= 1) {
    return {
      kind: 'simple_edit',
      complexity: 'low',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: 'Single-action task — execute with post-edit validation.',
    };
  }

  return {
    kind: 'question',
    complexity: 'low',
    shouldPlan: false,
    shouldVerify: false,
    shouldUseSubagents: false,
    summary: 'General request — respond with tools as needed.',
  };
}

function applyActIntent(
  analysis: TaskAnalysis,
  actIntent: ActIntent | undefined,
  taskText: string
): TaskAnalysis {
  const effectiveIntent = actIntent ?? analysis.actIntent;
  if (!effectiveIntent) return analysis;

  if (!actIntent) {
    return {
      ...analysis,
      actIntent: effectiveIntent,
    };
  }

  switch (effectiveIntent) {
    case 'question':
      return {
        ...analysis,
        kind: 'question',
        complexity: 'low',
        shouldPlan: false,
        shouldVerify: false,
        shouldUseSubagents: false,
        actIntent: effectiveIntent,
      };

    case 'diagnose':
      return {
        ...analysis,
        kind: 'debugging',
        shouldPlan: false,
        shouldVerify: true,
        actIntent: effectiveIntent,
      };

    case 'log_audit':
      return {
        ...analysis,
        kind: 'log_audit',
        complexity: 'low',
        shouldPlan: false,
        shouldVerify: false,
        shouldUseSubagents: false,
        actIntent: effectiveIntent,
      };

    case 'audit': {
      const auditSubtype = analysis.auditSubtype ?? resolveAuditSubtype(taskText) ?? 'generic';
      const isCleanup =
        auditSubtype === 'unused_deps' ||
        auditSubtype === 'dead_code' ||
        auditSubtype === 'vulnerability';
      return {
        ...analysis,
        kind: 'audit',
        complexity: isCleanup ? 'high' : analysis.complexity === 'low' ? 'medium' : analysis.complexity,
        shouldPlan: isCleanup,
        shouldVerify: true,
        shouldUseSubagents: false,
        auditSubtype,
        actIntent: effectiveIntent,
      };
    }

    case 'docs': {
      const docsSubtype = analysis.docsSubtype ?? resolveDocsSubtype(taskText) ?? 'generic';
      const isReadme = docsSubtype === 'readme';
      return {
        ...analysis,
        kind: 'docs',
        complexity: analysis.complexity === 'low' && !isReadme ? 'medium' : analysis.complexity,
        shouldPlan: !isReadme && analysis.shouldPlan,
        shouldVerify: docsSubtype === 'docusaurus' || docsSubtype === 'mdx_repair',
        shouldUseSubagents: false,
        docsSubtype,
        actIntent: effectiveIntent,
      };
    }

    case 'bugfix':
      return {
        ...analysis,
        kind:
          analysis.kind === 'debugging' || analysis.kind === 'simple_edit'
            ? analysis.kind
            : 'implementation',
        shouldVerify: true,
        actIntent: effectiveIntent,
      };

    case 'feature':
    case 'refactor':
      return {
        ...analysis,
        kind: 'implementation',
        shouldVerify: true,
        actIntent: effectiveIntent,
      };
  }
}

function isAuditCleanupRequest(text: string): boolean {
  if (isLogAuditTask(text)) return false;
  return AUDIT_CLEANUP_TARGET.test(text) && AUDIT_CLEANUP_ACTION.test(text);
}

function isBroadProjectRepairRequest(text: string): boolean {
  return BUGFIX_ACTION.test(text) && PROJECT_SCOPE_TARGET.test(text) && UNBOUNDED_REPAIR_SCOPE.test(text);
}

function estimateComplexity(text: string): TaskComplexity {
  let score = 0;
  if (text.length > 300) score += 2;
  else if (text.length > 150) score += 1;

  const connectors = text.match(/\b(and|then|also|after that|next)\b/gi)?.length ?? 0;
  if (connectors >= 3) score += 2;
  else if (connectors >= 1) score += 1;

  const actions = text.match(/\b(implement|build|migrate|refactor|rewrite|integrate|document|docs?|documentation)\b/gi)?.length ?? 0;
  if (actions >= 2) score += 2;
  else if (actions >= 1) score += 1;

  const files = text.match(/[`'"]?[\w./-]+\.(tsx?|jsx?|py|go|rs)[`'"]?/gi)?.length ?? 0;
  if (files >= 3) score += 2;
  else if (files >= 1) score += 1;

  if (/\b(entire|whole|all|across|every|full)\b/i.test(text)) score += 1;
  if (/\b(test|lint|build|ci)\b/i.test(text)) score += 1;

  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

export function shouldDecomposeTask(userMessage: string, mode: string): boolean {
  return analyzeTask(userMessage, mode).shouldPlan;
}
