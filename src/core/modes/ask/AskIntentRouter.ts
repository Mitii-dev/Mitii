import type { AskRoute, AskIntent, AskResponseProfile } from './askTypes';
import { ASK_INTENT_DESCRIPTIONS } from '../../runtime/intentClassifier';

const LOCATE_RE = /\b(where|which file|what file|find|locate|defined|definition|lives?)\b/i;
const ARCHITECTURE_RE = /\b(architecture|overview|flow|data flow|control flow|how does .+ work|walkthrough|trace|map out|pipeline|retrieval|orchestrat)\b/i;
const COMPARE_RE = /\b(compare|difference|different|versus|vs\.?|tradeoffs?)\b/i;
const IMPLEMENT_RE = /\b(how (?:do|would|should) i (?:add|implement|build|create|integrate|wire|support)|how to (?:add|implement|build|create|integrate)|what files would change|affected files|implementation approach|implement .+ here|add .+ to this)\b|^(?:implement|add|build|create|integrate|wire|support)\b/i;
const DEBUG_RE = /\b(why .+(?:fail|failing|broken|error)|build failing|test failing|root cause|diagnos|debug)\b/i;
const CROSS_PROJECT_RE = /\b(across projects?|between projects?|cross[- ]project|relate to|flow from|agent\s*(?:->|to)\s*docs|docs\s*(?:->|to)\s*agent|extension\s*(?:->|to)\s*website|monorepo)\b/i;
const GENERAL_KNOWLEDGE_RE = /^(what is|what are|define|explain the concept|difference between)\b/i;
const CODEBASE_RE = /\b(codebase|repo|repository|workspace|project|this app|this extension|this code|our code|src\/|\.tsx?|\.jsx?|\.py|\.go|\.rs|\.mdx?|package\.json|how to run|what command|which command|which script|npm run|pnpm run|yarn run|npm scripts|benchmark)\b|@[\w./-]+/i;
const SCM_CONTEXT_RE =
  /\b(commit message|commit msg|git commit|git diff|working tree|staged changes?|changes? in (?:stage|staging))\b|\b(?:commit|message|subject|summary)\b[\s\S]{0,80}\b(?:staged|stage|cached)\b|\b(?:staged|stage|cached)\b[\s\S]{0,80}\b(?:commit|message|subject|summary)\b/i;

export interface AskRouteOptions {
  intent?: AskIntent;
}

export function routeAskIntent(userMessage: string, options: AskRouteOptions = {}): AskRoute {
  const text = userMessage.trim();
  const intent = options.intent ?? classifyAskIntentFallback(text);
  const profile = chooseProfile(intent, text);
  const includeImpact = intent === 'implement_here' || /\b(affected files|what files would change|impact)\b/i.test(text);
  const allowWeb = intent === 'implement_here' || /\b(external docs?|api docs?|latest|current|library|sdk|oauth|stripe|openai|github)\b/i.test(text);
  const groundingRequired = intent !== 'general_knowledge';

  return {
    intent,
    profile,
    includeImpact,
    allowWeb,
    shouldUseSubagents: shouldUseAskSubagents(intent, text),
    groundingRequired,
    summary: summarizeRoute(intent, profile),
  };
}

function classifyAskIntentFallback(text: string): AskIntent {
  if (!text) return 'general_knowledge';
  if (CROSS_PROJECT_RE.test(text)) return 'cross_project';
  if (IMPLEMENT_RE.test(text)) return 'implement_here';
  if (DEBUG_RE.test(text)) return 'debug_explain';
  if (COMPARE_RE.test(text)) return 'compare';
  if (ARCHITECTURE_RE.test(text)) return 'architecture';
  if (LOCATE_RE.test(text)) return 'locate';
  if (SCM_CONTEXT_RE.test(text)) return 'explain_code';
  if (GENERAL_KNOWLEDGE_RE.test(text) && !CODEBASE_RE.test(text)) return 'general_knowledge';
  if (CODEBASE_RE.test(text)) return 'explain_code';
  return text.includes('?') ? 'explain_code' : 'general_knowledge';
}

function chooseProfile(intent: AskIntent, text: string): AskResponseProfile {
  if (intent === 'locate') return 'concise';
  if (intent === 'general_knowledge' && text.length < 120) return 'concise';
  if (/\b(short|brief|quick|concise|tl;dr)\b/i.test(text)) return 'concise';
  return 'deep';
}

function shouldUseAskSubagents(intent: AskIntent, text: string): boolean {
  if (intent === 'general_knowledge' || intent === 'locate') return false;
  if (intent === 'architecture' || intent === 'cross_project' || intent === 'implement_here') return true;
  return text.length > 160 || /\b(entire|whole|across|all files|deep dive|full)\b/i.test(text);
}

function summarizeRoute(intent: AskIntent, profile: AskResponseProfile): string {
  return `Ask mode — ${ASK_INTENT_DESCRIPTIONS[intent]} (${profile} profile).`;
}
