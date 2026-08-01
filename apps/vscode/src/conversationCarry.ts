import type { MitiiConversationMessage, PlanArtifact } from '@mitii/sdk';
import { planArtifactSchema } from '@mitii/sdk';

/**
 * Host-side conversation / plan carry policy.
 * Limits are intentional defaults — engine compactConversation still budgets.
 */
export const CONVERSATION_CARRY_LIMITS = {
  /** Max prior role turns to forward (user+assistant each count). */
  maxMessages: 20,
  /** Per-message character cap before truncation. */
  maxCharsPerMessage: 8_000,
} as const;

export type CarryChatRole = 'user' | 'assistant';

export interface CarryChatMessage {
  role: CarryChatRole;
  text: string;
}

export type AgentCarryMode = 'ask' | 'plan' | 'agent';

export interface BuildConversationCarryOptions {
  messages: readonly CarryChatMessage[];
  /**
   * Current prompt about to be sent. When it matches the trailing user turn
   * (already persisted or mirrored in UI), that turn is excluded so the engine
   * does not duplicate the live userMessage.
   */
  currentPrompt?: string;
  limits?: Partial<typeof CONVERSATION_CARRY_LIMITS>;
}

/**
 * Map persisted chat turns into SDK conversation messages for Agent Engine.
 */
export function buildConversationCarry(
  options: BuildConversationCarryOptions,
): MitiiConversationMessage[] {
  const maxMessages =
    options.limits?.maxMessages ?? CONVERSATION_CARRY_LIMITS.maxMessages;
  const maxChars =
    options.limits?.maxCharsPerMessage ??
    CONVERSATION_CARRY_LIMITS.maxCharsPerMessage;

  const trimmedPrompt = options.currentPrompt?.trim();
  let source = options.messages.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant') &&
      message.text.trim().length > 0,
  );

  if (trimmedPrompt && source.length > 0) {
    const last = source[source.length - 1];
    if (last?.role === 'user' && last.text.trim() === trimmedPrompt) {
      source = source.slice(0, -1);
    }
  }

  const windowed = source.slice(-maxMessages);
  const carried: MitiiConversationMessage[] = [];

  for (const message of windowed) {
    const content = truncateMessage(message.text.trim(), maxChars);
    if (!content) continue;
    carried.push({ role: message.role, content });
  }

  return carried;
}

/**
 * Decide whether a stored plan should be handed to Agent mode as approvedPlan.
 * Only agent mode consumes a pending plan; ask/plan leave it untouched.
 */
export function resolvePlanHandoff(options: {
  mode: AgentCarryMode;
  pendingPlan: unknown;
}): PlanArtifact | undefined {
  if (options.mode !== 'agent') return undefined;
  return parsePendingPlan(options.pendingPlan);
}

/**
 * Validate a persisted pending plan (memento may hold stale shapes).
 */
export function parsePendingPlan(value: unknown): PlanArtifact | undefined {
  if (value == null) return undefined;
  const parsed = planArtifactSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function truncateMessage(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '…';
  return `${text.slice(0, maxChars - 1)}…`;
}

/** Keep in sync with packages/v8 isTransitionalAssistantAnswer heuristics. */
const TRANSITIONAL_OPENERS =
  /^(?:okay[,.]?\s+|ok[,.]?\s+|sure[,.]?\s+|alright[,.]?\s+|right[,.]?\s+)?(?:let me|i(?:'ll| will)|i(?:'m| am) going to|now let me|next[,]? (?:i(?:'ll| will)|let me)|i need to|i should)\b/i;
const TRANSITIONAL_INTENT =
  /\b(?:let me|i(?:'ll| will)|i(?:'m| am) going to)\b/i;
const TRANSITIONAL_CLOSERS = /(?::|\.\.\.|…)\s*$/;
const TRAILING_INTENT_CLAUSE =
  /[.!,;]\s*(?:let me|i(?:'ll| will)|i(?:'m| am) going to)\b[\s\S]{0,160}$/i;

function isWeakAssistantDisplay(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (/^(?:\([\w_]+\)|Error:)/.test(trimmed) && trimmed.length < 80) return true;
  if (/^Completed workspace edits\b/i.test(trimmed) && trimmed.length < 260) return true;
  if (/^Completed workspace edits\b[\s\S]*\bChanged files \(\d+\):/i.test(trimmed)) {
    return true;
  }
  if (trimmed.length > 600) return false;

  const singleBeat =
    trimmed.split(/\n+/).filter((line) => line.trim().length > 0).length <= 2;
  if (!singleBeat) return false;

  if (TRANSITIONAL_OPENERS.test(trimmed) && TRANSITIONAL_CLOSERS.test(trimmed)) {
    return true;
  }
  if (
    TRANSITIONAL_OPENERS.test(trimmed) &&
    trimmed.length < 180 &&
    !/[.!]["']?\s*$/.test(trimmed)
  ) {
    return true;
  }
  if (TRANSITIONAL_INTENT.test(trimmed) && TRANSITIONAL_CLOSERS.test(trimmed)) {
    return true;
  }
  if (trimmed.length < 280 && TRAILING_INTENT_CLAUSE.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Persist a carry-friendly assistant turn: if the model ended mid-narration but
 * mutated files, attach a changed-files summary so the next turn has memory.
 */
export function enrichAssistantCarryText(options: {
  answer: string;
  changedPaths?: readonly string[];
}): string {
  const answer = options.answer.trim();
  const paths = [...(options.changedPaths ?? [])].filter(
    (path) => path.trim().length > 0,
  );
  const incomplete = isWeakAssistantDisplay(answer);

  if (paths.length === 0) {
    return answer || '(no answer)';
  }

  if (incomplete) {
    return `Completed workspace edits (${paths.length} file${paths.length === 1 ? '' : 's'} changed).`;
  }
  return answer;
}

/**
 * Prefer a substantive final answer; keep streamed text when the final answer
 * is empty/transitional so the chat does not collapse to a one-liner.
 */
export function resolveDisplayedAssistantText(options: {
  streamedText: string;
  finalAnswer: string;
}): string {
  const streamed = options.streamedText.trim();
  const final = options.finalAnswer.trim();
  if (!final) return streamed || '(no answer)';
  if (!streamed) return final;

  const finalWeak = isWeakAssistantDisplay(final);
  if (!finalWeak) return final;

  const streamedStronger =
    streamed.length > final.length * 1.35 ||
    (!isWeakAssistantDisplay(streamed) && streamed.length >= final.length);

  if (!streamedStronger) return final;

  return streamed;
}

/** Keep a bounded, low-noise activity trail for memento / reload. */
export function compactActivityForHistory(
  events: readonly {
    id: string;
    at: number;
    kind: string;
    title: string;
    detail?: string;
    status?: string;
  }[],
  limit = 40,
): Array<{
  id: string;
  at: number;
  kind:
    | 'thinking'
    | 'delta'
    | 'context'
    | 'tool'
    | 'decision'
    | 'warning'
    | 'suspended'
    | 'terminal'
    | 'info';
  title: string;
  detail?: string;
  status?: string;
}> {
  const allowed = new Set([
    'context',
    'tool',
    'decision',
    'warning',
    'suspended',
    'terminal',
    'info',
  ]);
  return events
    .filter((event) => allowed.has(event.kind))
    .slice(-limit)
    .map((event) => ({
      id: event.id,
      at: event.at,
      kind: event.kind as
        | 'context'
        | 'tool'
        | 'decision'
        | 'warning'
        | 'suspended'
        | 'terminal'
        | 'info',
      title: event.title.slice(0, 160),
      ...(event.detail
        ? { detail: event.detail.slice(0, 400) }
        : {}),
      ...(event.status ? { status: event.status.slice(0, 64) } : {}),
    }));
}

/** Drop bulky patch previews before persisting file-change cards. */
export function compactFileChangesForHistory<
  T extends {
    runId: string;
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
      status: 'A' | 'M' | 'D' | '?';
      patchPreview?: string;
      wasPreDirty?: boolean;
    }>;
    totalAdditions: number;
    totalDeletions: number;
  },
>(changes: T | null | undefined): T | undefined {
  if (!changes || changes.files.length === 0) return undefined;
  return {
    ...changes,
    files: changes.files.slice(0, 80).map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status,
      ...(file.wasPreDirty ? { wasPreDirty: true } : {}),
    })),
  };
}
