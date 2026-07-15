import { z } from 'zod';
import type { LlmProvider } from '../llm/types';
import type { ThunderMode } from '../session/ThunderSession';

export interface IntentClassification<T extends string> {
  intent: T;
  confidence: number;
  alternatives?: Array<{ intent: T; confidence: number }>;
  needsClarification?: boolean;
}

export const INTENT_CONFIDENCE_HIGH = 0.74;
export const INTENT_CONFIDENCE_LOW = 0.35;

const rawClassificationSchema = z.object({
  intent: z.string(),
  confidence: z.number().min(0).max(1),
  alternatives: z.array(z.object({
    intent: z.string(),
    confidence: z.number().min(0).max(1),
  })).optional(),
  needsClarification: z.boolean().optional(),
});

export const ASK_INTENT_DESCRIPTIONS = {
  explain_code: 'Explain repository code with grounded file citations.',
  locate: 'Find where code, configuration, symbols, or behavior live.',
  architecture: 'Explain architecture, flows, pipelines, or orchestration.',
  compare: 'Compare code paths, approaches, APIs, or tradeoffs.',
  implement_here: 'Describe how to implement a change in this repo without editing.',
  debug_explain: 'Diagnose likely root cause from code, diagnostics, or logs.',
  general_knowledge: 'Answer a general concept question that does not require repo context.',
  cross_project: 'Reason across multiple projects/packages in the workspace.',
} as const;

export const PLAN_INTENT_DESCRIPTIONS = {
  feature: 'Plan a new feature or capability.',
  refactor: 'Plan a restructuring, migration, simplification, or rename.',
  bugfix: 'Plan an error, regression, failing test, or broken behavior fix.',
  audit: 'Plan cleanup of unused dependencies, files, imports, or dead code.',
  docs: 'Plan documentation, examples, README, changelog, or MDX work.',
  spike: 'Plan read-only discovery for broad architecture or implementation questions.',
  question: 'Plan a grounded investigation or answer for an informational request.',
} as const;

export const ACT_INTENT_DESCRIPTIONS = {
  bugfix: 'Fix a bug, failing test, build error, regression, or broken behavior.',
  feature: 'Implement a new feature or capability.',
  refactor: 'Refactor, migrate, rename, restructure, or simplify code.',
  docs: 'Create or update docs, examples, README, changelog, or MDX.',
  audit: 'Clean up unused dependencies, imports, files, or dead code.',
  question: 'Answer or investigate without making code changes.',
  diagnose: 'Find and explain a root cause, possibly before a minimal fix.',
} as const;

export type IntentDescriptionMap<T extends string> = Record<T, string>;

export function getModeIntentDescriptions(mode: ThunderMode): IntentDescriptionMap<string> {
  if (mode === 'ask') return ASK_INTENT_DESCRIPTIONS;
  if (mode === 'plan') return PLAN_INTENT_DESCRIPTIONS;
  return ACT_INTENT_DESCRIPTIONS;
}

export async function classifyIntent<T extends string>(
  provider: LlmProvider,
  mode: ThunderMode,
  userMessage: string,
  intents: readonly T[],
  descriptions: IntentDescriptionMap<T>
): Promise<IntentClassification<T>> {
  const fastPath = classifyIntentFastPath(mode, userMessage, intents);
  if (fastPath) return fastPath;

  const response = await collectProviderText(provider, {
    messages: [
      {
        role: 'system',
        content: buildClassifierSystemPrompt(mode, intents, descriptions),
      },
      {
        role: 'user',
        content: userMessage,
      },
    ],
    temperature: 0,
    maxTokens: 240,
    stream: false,
    toolChoice: 'none',
  });

  return parseIntentClassification(response, intents);
}

export function classifyIntentFastPath<T extends string>(
  mode: ThunderMode,
  userMessage: string,
  intents: readonly T[]
): IntentClassification<T> | null {
  const text = userMessage.trim();
  const has = (intent: string): intent is T => intents.includes(intent as T);
  if (!text && has('general_knowledge')) return high('general_knowledge' as T);

  if (mode === 'plan' && /^(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(text) && text.length < 48 && has('question')) {
    return high('question' as T);
  }

  if (mode === 'agent') {
    if (/\b(audit|cleanup|clean up|unused|dead code|depcheck|knip)\b/i.test(text) && has('audit')) {
      return high('audit' as T);
    }
    if (/\b(?:execute|implement|run|follow|resume|continue with)\b[\s\S]{0,40}?\b(?:the|this|saved|current|active)?\s*plan\b|\bplan looks good\b|\bexecute the plan\b/i.test(text) && has('feature')) {
      return high('feature' as T);
    }
  }

  return null;

  function high(intent: T): IntentClassification<T> {
    return { intent, confidence: 1, alternatives: [] };
  }
}

export function gateIntentClassification<T extends string>(
  classification: IntentClassification<T>,
  _mode: ThunderMode,
  fallbackIntent: T
): IntentClassification<T> {
  if (classification.confidence >= INTENT_CONFIDENCE_HIGH) return classification;
  return {
    intent: fallbackIntent,
    confidence: classification.confidence,
    alternatives: classification.alternatives,
    needsClarification: classification.confidence < INTENT_CONFIDENCE_LOW || classification.needsClarification,
  };
}

export function safeDefaultIntent<T extends string>(mode: ThunderMode, intents: readonly T[]): T {
  const preferred = mode === 'ask'
    ? 'explain_code'
    : mode === 'plan'
      ? 'question'
      : 'question';
  return intents.includes(preferred as T) ? preferred as T : intents[0];
}

export function buildIntentClarification<T extends string>(
  mode: ThunderMode,
  classification: IntentClassification<T>,
  descriptions: IntentDescriptionMap<T>
): { question: string; options: string[] } {
  const seen = new Set<T>();
  const options: string[] = [];
  const push = (intent: T | undefined) => {
    if (!intent || seen.has(intent)) return;
    seen.add(intent);
    options.push(`${humanizeIntent(intent)} — ${descriptions[intent]}`);
  };
  push(classification.intent);
  for (const alt of classification.alternatives ?? []) push(alt.intent);
  for (const intent of Object.keys(descriptions) as T[]) {
    if (options.length >= 4) break;
    push(intent);
  }
  return {
    question: `I need one routing detail before continuing: what kind of ${mode} request is this?`,
    options: options.slice(0, 5),
  };
}

function buildClassifierSystemPrompt<T extends string>(
  mode: ThunderMode,
  intents: readonly T[],
  descriptions: IntentDescriptionMap<T>
): string {
  const lines = intents.map((intent) => `- ${intent}: ${descriptions[intent]}`);
  return [
    'You are a tiny intent classifier for a coding assistant.',
    `Classify the user message for mode "${mode}".`,
    'Return STRICT JSON only. No markdown, prose, comments, or code fences.',
    'JSON shape: {"intent":"one_enum_value","confidence":0..1,"alternatives":[{"intent":"one_enum_value","confidence":0..1}],"needsClarification":boolean}',
    'Use confidence >= 0.74 only when the route is clear. Use confidence < 0.35 when a user decision is needed.',
    '',
    'Allowed intents:',
    ...lines,
  ].join('\n');
}

async function collectProviderText(
  provider: LlmProvider,
  request: Parameters<LlmProvider['complete']>[0]
): Promise<string> {
  let text = '';
  for await (const delta of provider.complete(request)) {
    if (delta.content) text += delta.content;
    if (delta.error) throw new Error(delta.error);
  }
  return text;
}

export function parseIntentClassification<T extends string>(
  rawText: string,
  intents: readonly T[]
): IntentClassification<T> {
  const jsonText = extractJsonObject(rawText);
  const parsed = rawClassificationSchema.parse(JSON.parse(jsonText));
  const allowed = new Set<string>(intents);
  if (!allowed.has(parsed.intent)) {
    throw new Error(`Intent classifier returned unsupported intent: ${parsed.intent}`);
  }
  const alternatives = (parsed.alternatives ?? [])
    .filter((alt) => allowed.has(alt.intent) && alt.intent !== parsed.intent)
    .map((alt) => ({ intent: alt.intent as T, confidence: alt.confidence }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);

  return {
    intent: parsed.intent as T,
    confidence: parsed.confidence,
    alternatives,
    needsClarification: parsed.needsClarification,
  };
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error('Intent classifier did not return a JSON object');
}

function humanizeIntent(intent: string): string {
  return intent
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
