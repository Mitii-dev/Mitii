
import type { ThunderMode } from '../../session/ThunderSession';
import type { TaskAnalysis } from '../../runtime/TaskAnalyzer';
import { isApprovalContinuationMessage } from '../../runtime/taskMessage';
import type { ActDepth, ActRoute } from './actTypes';

export interface ActRouteOptions {
  mode?: ThunderMode;
  hasActivePlan?: boolean;
  orchestrationEnabled?: boolean;
  auditMode?: boolean;
  mdxRepairMode?: boolean;
  githubIssueMode?: boolean;
  actDepth?: ActDepth;
}

const DOCS_HINT = /\b(docs?|documentation|docusaurus|mdx?|examples?|readme|changelog)\b/i;
const REFACTOR_HINT = /\b(refactor|rewrite|migrate|cleanup architecture|restructure)\b/i;
const BUGFIX_HINT = /\b(fix|debug|repair|failing|failed|error|bug|regression|broken|crash|compile|test failure)\b/i;
const INFRA_HINT = /\b(ci\/cd|pipeline|workflows?|github actions|docker|config|infrastructure|deployment|terraform)\b/i;
const CREATE_HINT = /\b(write|create|build|generate|scaffold)\b/i;

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
  const auditMode = Boolean(options.auditMode || analysis.kind === 'audit');
  const mdxRepairMode = Boolean(options.mdxRepairMode);
  const githubIssueMode = Boolean(options.githubIssueMode);
  const hasActivePlan = Boolean(options.hasActivePlan);
  const orchestrationEnabled = options.orchestrationEnabled ?? true;
  const actDepth = options.actDepth ?? 'auto';

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

  if (!isApprovalContinuationMessage(userMessage) && shouldResumeSavedPlan(userMessage, hasActivePlan, isDirectOverride, { actDepth })) {
    return {
      intent: 'resume_plan',
      executionPath: 'resume_saved_plan',
      complexity: analysis.complexity,
      shouldUsePlanner: false,
      shouldUseSubagents: false,
      shouldVerify: true,
      summary: 'Resume the active saved plan instead of replanning or starting a direct task.',
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
      intent: 'mdx_repair',
      executionPath: 'mdx_repair',
      complexity: 'low',
      shouldUsePlanner: false,
      shouldUseSubagents: false,
      shouldVerify: true,
      summary: 'MDX repair Act route — fix the exact build-output file and rerun docs verification.',
    };
  }

  const shouldUsePlanner = shouldUsePlannerForAct(analysis, orchestrationEnabled, auditMode, actDepth, {
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

  const intent = inferActIntent(userMessage, analysis);

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
  isDirectOverride: boolean, // Accept evaluated boolean
  options: { actDepth?: ActDepth } = {}
): boolean {
  if (!hasActivePlan) return false;
  const text = userMessage.trim();
  if (!text) return false;
  if (isDirectOverride) return false; // Use the boolean
  if (ACTIVE_PLAN_NEW_TASK.test(text)) return false;
  if (options.actDepth === 'quick') {
    return EXPLICIT_PLAN_HANDOFF.test(text);
  }
  return (
    EXPLICIT_PLAN_HANDOFF.test(text) ||
    CONTINUATION_HANDOFF.test(text) ||
    REFERENTIAL_HANDOFF.test(text) ||
    PLANNED_WORK_REFERENCE.test(text)
  );
}

export function shouldUsePlannerForAct(
  analysis: TaskAnalysis,
  orchestrationEnabled: boolean,
  auditMode = false,
  actDepth: ActDepth = 'auto',
  options: { directOverride?: boolean } = {}
): boolean {
  if (analysis.kind === 'simple_edit' || analysis.kind === 'question') return false;
  if (options.directOverride) return false;
  if (actDepth === 'quick') return false;
  if (!analysis.shouldPlan) return false;
  if (!orchestrationEnabled) return false;
  if (auditMode) return false;
  return true;
}

export function hasDirectRouteOverride(userMessage: string): boolean {
  return DIRECT_ROUTE_OVERRIDE.test(userMessage);
}

function inferActIntent(userMessage: string, analysis: TaskAnalysis): ActRoute['intent'] {
  if (analysis.kind === 'audit') return 'audit';
  if (analysis.kind === 'question') return 'question';
  
  if (analysis.kind === 'implementation' || analysis.kind === 'explicit_plan') return 'feature';
  
  if (DOCS_HINT.test(userMessage)) return 'docs';
  if (REFACTOR_HINT.test(userMessage)) return 'refactor';
  
  // Catch workflows and "write/create" requests and elevate them to features
  if (INFRA_HINT.test(userMessage) || CREATE_HINT.test(userMessage)) return 'feature'; 
  
  if (BUGFIX_HINT.test(userMessage) || analysis.kind === 'simple_edit') return 'bugfix';
  
  return 'direct';
}

function intentLabel(intent: ActRoute['intent']): string {
  return intent.replace(/_/g, ' ');
}