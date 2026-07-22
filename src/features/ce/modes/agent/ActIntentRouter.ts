
import type { ThunderMode } from '../../../../features/ce/session/ThunderSession';
import type { TaskAnalysis } from '../../runtime/TaskAnalyzer';
import { isApprovalContinuationMessage } from '../../runtime/taskMessage';
import type { ActDepth, ActRoute } from './actTypes';
import { ACT_INTENT_DESCRIPTIONS } from '../../runtime/intentClassifier';
import { normalizeAgentDepth } from '../../../../kernel/config/agentDepth';
import { resolvePlanningDepth } from '../../plans/planningDepth';
import { isRepositoryRestorationBugfix } from '../../pipeline/route/routeResolver';

export interface ActRouteOptions {
  mode?: ThunderMode;
  hasActivePlan?: boolean;
  planAwaitingApproval?: boolean;
  orchestrationEnabled?: boolean;
  auditMode?: boolean;
  logAuditMode?: boolean;
  mdxRepairMode?: boolean;
  githubIssueMode?: boolean;
  actDepth?: ActDepth | string;
  intent?: ActRoute['intent'];
}

// Fixed: Added '?' to make quantifiers lazy and prevent backtracking stalls
const ACTIVE_PLAN_NEW_TASK =
  /\b(?:new|different|separate|another)\s+task\b|\b(?:ignore|discard|cancel|drop|replace)\b[\s\S]{0,80}?\b(?:the|this|that|saved|current|existing)?\s*plan\b|\b(?:do not|don't)\b[\s\S]{0,80}?\b(?:use|resume|execute|follow)\b[\s\S]{0,80}?\bplan\b/i;

const DIRECT_ROUTE_OVERRIDE =
  /(?:^|\s)\/(?:fast|direct|no-?plan)\b|\b(?:no plan|without planning|skip (?:the )?(?:plan|planner|planning)|do not plan|don't plan|directly without (?:a )?plan|direct mode|fast mode)\b/i;

// Fixed: Added '?' to make quantifier lazy
const EXPLICIT_PLAN_HANDOFF =
  /\b(?:execute|implement|run|follow|resume|continue with)\b[\s\S]{0,40}?\b(?:the|this|saved|current|active)?\s*plan\b|\bplan looks good\b|\bexecute the plan\b/i;

const CONTINUATION_HANDOFF =
  /^(?:please\s+)?(?:go ahead|continue|proceed|do it|yes|yep|yeah|ok(?:ay)?|approved|looks good|sounds good|ship it)(?:\s+please)?[.!]*$/i;

const REFERENTIAL_HANDOFF =
  /^(?:please\s+)?(?:fix|implement|apply|do|run|execute|continue|resume)\s+(?:it|that|this)(?:\s+please)?[.!]*$/i;

const PLANNED_WORK_REFERENCE =
  /\b(?:we planned|planned work|from the plan|per the plan|according to the plan|as planned)\b/i;

export function routeActIntent(userMessage: string, analysis: TaskAnalysis, options: ActRouteOptions = {}): ActRoute {
  const mode = options.mode ?? 'agent';
  const restorationBugfix = isRepositoryRestorationBugfix(userMessage, analysis);
  const auditMode = Boolean(options.auditMode || analysis.kind === 'audit') && !restorationBugfix;
  const logAuditMode = Boolean(options.logAuditMode || analysis.kind === 'log_audit');
  const mdxRepairMode = Boolean(options.mdxRepairMode);
  const githubIssueMode = Boolean(options.githubIssueMode);
  const hasActivePlan = Boolean(options.hasActivePlan);
  const orchestrationEnabled = options.orchestrationEnabled ?? true;
  const actDepth = normalizeAgentDepth(options.actDepth);

  if (mode !== 'agent') {
    return {
      intent: 'question',
      executionPath: 'direct',
      complexity: 'low',
      shouldUsePlanner: false,
      shouldUseSubagents: false,
      shouldVerify: false,
      summary: 'Non-Agent mode route — do not execute Act workflow.',
    };
  }

  // Evaluate once and pass down to avoid redundant regex execution
  const isDirectOverride = hasDirectRouteOverride(userMessage);

  if (hasActivePlan && options.planAwaitingApproval && !isDirectOverride && isApprovalContinuationMessage(userMessage)) {
    return {
      intent: resolveActIntent(options.intent, analysis, userMessage),
      executionPath: 'resume_saved_plan',
      complexity: analysis.complexity,
      shouldUsePlanner: false,
      shouldUseSubagents: false,
      shouldVerify: true,
      summary: 'Approval received — resume the active saved plan from its pending step.',
    };
  }

  if (shouldResumeSavedPlan(userMessage, hasActivePlan, isDirectOverride, { actDepth, planAwaitingApproval: options.planAwaitingApproval })) {
    return {
      intent: resolveActIntent(options.intent, analysis, userMessage),
      executionPath: 'resume_saved_plan',
      complexity: analysis.complexity,
      shouldUsePlanner: false,
      shouldUseSubagents: false,
      shouldVerify: true,
      summary: 'Resume the active saved plan instead of replanning or starting a direct task.',
    };
  }

  if (logAuditMode) {
    return {
      intent: 'log_audit',
      executionPath: 'log_audit',
      complexity: 'low',
      shouldUsePlanner: false,
      shouldUseSubagents: false,
      shouldVerify: false,
      summary: 'Log audit Act route — analyze_log_directory/analyze_jsonl → optional query_log_events → synthesize (max 3 model calls).',
    };
  }

  if (auditMode) {
    return {
      intent: 'audit',
      executionPath: 'audit',
      complexity: 'high',
      shouldUsePlanner: false,
      shouldUseSubagents: false,
      shouldVerify: true,
      summary: 'Audit/cleanup Act route — use script-first direct execution with read-only discovery before writes.',
    };
  }

  if (mdxRepairMode) {
    return {
      intent: 'bugfix',
      executionPath: 'mdx_repair',
      complexity: 'low',
      shouldUsePlanner: false,
      shouldUseSubagents: false,
      shouldVerify: true,
      summary: 'MDX repair Act route — fix the exact build-output file and rerun docs verification.',
    };
  }

  const shouldUsePlanner = restorationBugfix
    ? orchestrationEnabled && !isDirectOverride && normalizeAgentDepth(actDepth) !== 'quick'
    : shouldUsePlannerForAct(analysis, orchestrationEnabled, auditMode || logAuditMode, actDepth, {
        directOverride: isDirectOverride,
      });
  
  if (githubIssueMode) {
    return {
      intent: 'bugfix',
      executionPath: shouldUsePlanner ? 'orchestrated' : 'direct',
      complexity: analysis.complexity,
      shouldUsePlanner,
      shouldUseSubagents: analysis.shouldUseSubagents,
      shouldVerify: true,
      summary: shouldUsePlanner
        ? 'GitHub issue Act route — plan from structured issue context, execute the fix, and verify.'
        : 'GitHub issue Act route — investigate issue context, make a focused fix, and verify.',
    };
  }

  const intent = restorationBugfix ? 'bugfix' : resolveActIntent(options.intent, analysis, userMessage);

  return {
    intent,
    executionPath: shouldUsePlanner ? 'orchestrated' : 'direct',
    complexity: analysis.complexity,
    shouldUsePlanner,
    shouldUseSubagents: analysis.shouldUseSubagents,
    shouldVerify: analysis.shouldVerify,
    summary: shouldUsePlanner
      ? `${intentLabel(intent)} Act route — plan, execute, and verify step-by-step.`
      : `${intentLabel(intent)} Act route — execute directly with focused validation.`,
  };
}

export function shouldResumeSavedPlan(
  userMessage: string,
  hasActivePlan: boolean,
  isDirectOverride = false,
  options: { actDepth?: ActDepth | string; planAwaitingApproval?: boolean } = {}
): boolean {
  if (!hasActivePlan) return false;
  const text = userMessage.trim();
  if (!text) return false;
  if (isDirectOverride) return false; // Use the boolean
  if (ACTIVE_PLAN_NEW_TASK.test(text)) return false;
  if (normalizeAgentDepth(options.actDepth) === 'quick') {
    return EXPLICIT_PLAN_HANDOFF.test(text);
  }
  return (
    EXPLICIT_PLAN_HANDOFF.test(text) ||
    (options.planAwaitingApproval && CONTINUATION_HANDOFF.test(text)) ||
    REFERENTIAL_HANDOFF.test(text) ||
    PLANNED_WORK_REFERENCE.test(text)
  );
}

export function shouldUsePlannerForAct(
  analysis: TaskAnalysis,
  orchestrationEnabled: boolean,
  auditMode = false,
  actDepth: ActDepth | string = 'auto',
  options: { directOverride?: boolean } = {}
): boolean {
  if (analysis.kind === 'simple_edit' || analysis.kind === 'question' || analysis.kind === 'debugging') return false;
  // README / package docs execute directly unless high complexity.
  if (analysis.kind === 'docs' && analysis.docsSubtype === 'readme' && analysis.complexity !== 'high') return false;
  if (analysis.kind === 'docs' && !analysis.shouldPlan) return false;
  if (options.directOverride) return false;
  if (normalizeAgentDepth(actDepth) === 'quick') return false;
  if (!analysis.shouldPlan) return false;
  if (!orchestrationEnabled) return false;
  if (auditMode) return false;
  const depth = resolvePlanningDepth(analysis);
  if (depth === 'none' || depth === 'micro') return false;
  return true;
}

export function hasDirectRouteOverride(userMessage: string): boolean {
  return DIRECT_ROUTE_OVERRIDE.test(userMessage);
}

function fallbackActIntent(analysis: TaskAnalysis, userMessage = ''): ActRoute['intent'] {
  const bugfixEvidence =
    analysis.kind === 'implementation' &&
    /\b(fix|repair|resolve|correct|debug|troubleshoot|bug|broken|failing|failed|error|issue)\b/i.test(
      `${userMessage}\n${analysis.summary}`
    );
  if (analysis.actIntent && !(analysis.actIntent === 'feature' && bugfixEvidence)) return analysis.actIntent;
  if (analysis.kind === 'log_audit') return 'log_audit';
  if (analysis.kind === 'audit') return 'audit';
  if (analysis.kind === 'docs') return 'docs';
  if (analysis.kind === 'question') return 'question';
  if (analysis.kind === 'debugging') return 'diagnose';
  if (bugfixEvidence) return 'bugfix';
  if (analysis.kind === 'implementation' || analysis.kind === 'explicit_plan') return 'feature';
  return 'bugfix';
}

function resolveActIntent(
  classifierIntent: ActRoute['intent'] | undefined,
  analysis: TaskAnalysis,
  userMessage: string
): ActRoute['intent'] {
  const fallback = fallbackActIntent(analysis, userMessage);
  if (!classifierIntent) return fallback;
  // The LLM intent classifier can over-generalize broad repair requests as
  // "feature". Keep deterministic bugfix signals authoritative.
  if (classifierIntent === 'feature' && fallback === 'bugfix') return 'bugfix';
  return classifierIntent;
}

function intentLabel(intent: ActRoute['intent']): string {
  return ACT_INTENT_DESCRIPTIONS[intent] ?? intent.replace(/_/g, ' ');
}
