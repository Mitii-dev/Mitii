/**
 * Canonical task feature extraction — one pass over user text for routing/classification.
 * Mode routers should consume these features instead of re-parsing the same patterns.
 */
import { splitConversationContext } from '../../runtime/taskMessage';
import { isLogAuditTask } from '../../runtime/logAudit';
import { isMdxRepairTask } from '../../runtime/mdxRepairRouting';
import { DIAGNOSTIC_REQUEST } from '../../runtime/diagnosticRequest';
import { DOCS_MENTION_RE } from '../route/docsRules';
import { LOG_AUDIT_RE } from '../route/auditRules';
import { resolveAuditSubtype, resolveDocsSubtype } from '../route/routeResolver';
import type { AuditSubtype, DocsSubtype } from '../types';

const QUESTION_LEAD =
  /^(what|how|why|where|when|who|which|explain|describe|tell me|show me|list|summarize|overview)\b/i;

const ACTION_VERB_FORMS = [
  'implement', 'implementing', 'implemented',
  'build', 'building', 'built',
  'create', 'creating', 'created',
  'add', 'adding', 'added',
  'fix', 'fixing', 'fixed',
  'refactor', 'refactoring', 'refactored',
  'update', 'updating', 'updated',
  'remove', 'removing', 'removed',
  'delete', 'deleting', 'deleted',
  'debug', 'debugging', 'debugged',
];

const ACTION_VERBS = new RegExp(`\\b(?:${ACTION_VERB_FORMS.join('|')})\\b`, 'i');

const CODEBASE_REF =
  /\b(codebase|project|repo|repository|this file|our app|our code|workspace)\b/i;

const GENERAL_KNOWLEDGE =
  /^(what is|what are|explain the concept|define|difference between)\b/i;

export type InteractionIntent = 'answer' | 'plan' | 'execute';

export interface TaskFeatureSignals {
  /** Full trimmed user text. */
  text: string;
  /** Current instruction without appended historical context. */
  primary: string;
  interaction: InteractionIntent;
  isQuestion: boolean;
  hasActionVerbs: boolean;
  hasCodebaseRef: boolean;
  isGeneralKnowledge: boolean;
  isLogAudit: boolean;
  isMdxRepair: boolean;
  isDocsMention: boolean;
  isDiagnosticRequest: boolean;
  auditSubtype?: AuditSubtype;
  docsSubtype?: DocsSubtype;
}

export function extractTaskFeatures(text: string, mode: InteractionIntent = 'execute'): TaskFeatureSignals {
  const trimmed = text.trim();
  const { primary } = splitConversationContext(trimmed);
  const isQuestion = QUESTION_LEAD.test(primary) || (primary.includes('?') && !ACTION_VERBS.test(primary));
  const hasActionVerbs = ACTION_VERBS.test(primary);
  const hasCodebaseRef = CODEBASE_REF.test(primary) || /\b(src\/|\.tsx?|\.jsx?|\.py|\.go|\.rs|\.mdx?)\b/i.test(primary);
  const isGeneralKnowledge = GENERAL_KNOWLEDGE.test(primary) && !hasCodebaseRef;
  const isLogAudit = isLogAuditTask(trimmed) || LOG_AUDIT_RE.test(trimmed);
  const isMdxRepair = isMdxRepairTask(trimmed);
  const isDocsMention = DOCS_MENTION_RE.test(trimmed);
  const isDiagnosticRequest = DIAGNOSTIC_REQUEST.test(trimmed);

  return {
    text: trimmed,
    primary,
    interaction: mode,
    isQuestion,
    hasActionVerbs,
    hasCodebaseRef,
    isGeneralKnowledge,
    isLogAudit,
    isMdxRepair,
    isDocsMention,
    isDiagnosticRequest,
    auditSubtype: resolveAuditSubtype(trimmed),
    docsSubtype: resolveDocsSubtype(trimmed),
  };
}

/** Classify Ask interaction intent from pre-extracted features (no duplicate regex pass). */
export function askIntentFromFeatures(features: TaskFeatureSignals): import('../../modes/ask/askTypes').AskIntent {
  if (!features.text) return 'general_knowledge';
  if (features.isLogAudit) return 'log_analysis';
  if (/\b(across projects?|between projects?|cross[- ]project|monorepo)\b/i.test(features.primary)) return 'cross_project';
  if (/\b(how (?:do|would|should) i (?:add|implement|build|create)|implement .+ here)\b/i.test(features.primary)) return 'implement_here';
  if (features.isDiagnosticRequest || /\b(why .+(?:fail|error)|root cause)\b/i.test(features.primary)) return 'debug_explain';
  if (/\b(compare|difference|versus|vs\.?)\b/i.test(features.primary)) return 'compare';
  if (/\b(architecture|overview|how does .+ work|pipeline)\b/i.test(features.primary)) return 'architecture';
  if (/\b(where|which file|find|locate|defined)\b/i.test(features.primary)) return 'locate';
  if (features.isGeneralKnowledge) return 'general_knowledge';
  if (/^(?:implement|add|build|create|integrate|wire|support)\b/i.test(features.primary)) return 'implement_here';
  if (features.hasActionVerbs && features.interaction !== 'answer') return 'implement_here';
  if (features.hasCodebaseRef) return 'explain_code';
  return features.isQuestion ? 'explain_code' : 'general_knowledge';
}
