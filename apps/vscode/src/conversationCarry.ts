import type {
  MitiiConversationMessage,
  PlanArtifact,
  PlanStrategyDecision,
  TaskList,
} from '@mitii/sdk';
import {
  planArtifactSchema,
  planStrategyDecisionSchema,
  taskListSchema,
} from '@mitii/sdk';

/**
 * Host-side conversation / plan carry policy.
 * Limits are intentional defaults — engine compactConversation still budgets.
 */
export const CONVERSATION_CARRY_LIMITS = {
  /** Max prior role turns to forward (user+assistant each count). */
  maxMessages: 20,
  /** Per-message character cap before truncation. */
  maxCharsPerMessage: 8_000,
  /** Tighter Agent follow-up window (structured handoff carries the rest). */
  agentMaxMessages: 8,
  agentMaxCharsPerMessage: 3_000,
  structuredMaxChangedPaths: 40,
  structuredMaxErrors: 8,
  structuredMaxErrorChars: 240,
} as const;

export type CarryChatRole = 'user' | 'assistant';

export interface CarryChatMessage {
  role: CarryChatRole;
  text: string;
}

export type AgentCarryMode = 'ask' | 'plan' | 'agent';

/** Compact cross-turn facts preferred over dumping full chat history. */
export interface StructuredCarryHandoff {
  objective?: string;
  changedPaths?: readonly string[];
  lastErrors?: readonly string[];
  taskSummary?: string;
}

export interface BuildConversationCarryOptions {
  messages: readonly CarryChatMessage[];
  /**
   * Current prompt about to be sent. When it matches the trailing user turn
   * (already persisted or mirrored in UI), that turn is excluded so the engine
   * does not duplicate the live userMessage.
   */
  currentPrompt?: string;
  /** When `agent`, use tighter chat caps and optional structured prefix. */
  mode?: AgentCarryMode;
  /** Preferred over raw chat when present (Agent follow-ups). */
  structured?: StructuredCarryHandoff;
  limits?: Partial<typeof CONVERSATION_CARRY_LIMITS>;
}

export function resolveConversationCarryLimits(
  mode?: AgentCarryMode,
): {
  maxMessages: number;
  maxCharsPerMessage: number;
} {
  if (mode === 'agent') {
    return {
      maxMessages: CONVERSATION_CARRY_LIMITS.agentMaxMessages,
      maxCharsPerMessage: CONVERSATION_CARRY_LIMITS.agentMaxCharsPerMessage,
    };
  }
  return {
    maxMessages: CONVERSATION_CARRY_LIMITS.maxMessages,
    maxCharsPerMessage: CONVERSATION_CARRY_LIMITS.maxCharsPerMessage,
  };
}

/**
 * Build a compact `<carry_handoff>` block for Agent follow-ups.
 */
export function buildStructuredCarryPrefix(
  handoff: StructuredCarryHandoff | undefined,
): string | undefined {
  if (!handoff) return undefined;

  const lines: string[] = ['<carry_handoff>'];
  const objective = handoff.objective?.trim();
  if (objective) {
    lines.push(`objective: ${truncateMessage(objective, 400)}`);
  }
  const taskSummary = handoff.taskSummary?.trim();
  if (taskSummary) {
    lines.push(`tasks: ${truncateMessage(taskSummary, 240)}`);
  }
  const paths = uniqueNonEmpty(handoff.changedPaths ?? []).slice(
    0,
    CONVERSATION_CARRY_LIMITS.structuredMaxChangedPaths,
  );
  if (paths.length > 0) {
    lines.push(`changed_files (${paths.length}):`);
    for (const path of paths) {
      lines.push(`- ${path}`);
    }
  }
  const errors = uniqueNonEmpty(handoff.lastErrors ?? [])
    .slice(0, CONVERSATION_CARRY_LIMITS.structuredMaxErrors)
    .map((error) =>
      truncateMessage(error, CONVERSATION_CARRY_LIMITS.structuredMaxErrorChars),
    );
  if (errors.length > 0) {
    lines.push('last_errors:');
    for (const error of errors) {
      lines.push(`- ${error}`);
    }
  }
  if (lines.length === 1) return undefined;
  lines.push('</carry_handoff>');
  return lines.join('\n');
}

/**
 * Collect structured handoff facts from a stored thread (plan + recent edits).
 */
export function collectStructuredCarryFromThread(thread: {
  pendingPlan?: { objective?: string } | null;
  pendingTaskList?: {
    items?: readonly {
      status?: string;
      title?: string;
    }[];
  } | null;
  messages?: readonly {
    fileChanges?: { files?: readonly { path?: string }[] } | null;
    activity?: readonly {
      kind?: string;
      title?: string;
      detail?: string;
      status?: string;
    }[];
  }[];
}): StructuredCarryHandoff | undefined {
  const changedPaths: string[] = [];
  const lastErrors: string[] = [];
  for (const message of thread.messages ?? []) {
    for (const file of message.fileChanges?.files ?? []) {
      if (file.path?.trim()) changedPaths.push(file.path.trim());
    }
    for (const event of message.activity ?? []) {
      const isErrorish =
        event.kind === 'warning' ||
        event.status === 'error' ||
        event.status === 'failed';
      if (!isErrorish) continue;
      const text = (event.detail ?? event.title ?? '').trim();
      if (text) lastErrors.push(text);
    }
  }

  const items = thread.pendingTaskList?.items ?? [];
  const pending = items.filter((item) => item.status === 'pending').length;
  const active = items.filter((item) => item.status === 'active').length;
  const done = items.filter((item) => item.status === 'done').length;
  const taskSummary =
    items.length > 0
      ? `${items.length} items (${done} done, ${active} active, ${pending} pending)`
      : undefined;

  const handoff: StructuredCarryHandoff = {
    ...(thread.pendingPlan?.objective
      ? { objective: thread.pendingPlan.objective }
      : {}),
    ...(changedPaths.length > 0 ? { changedPaths } : {}),
    ...(lastErrors.length > 0 ? { lastErrors } : {}),
    ...(taskSummary ? { taskSummary } : {}),
  };
  if (
    !handoff.objective &&
    !handoff.changedPaths &&
    !handoff.lastErrors &&
    !handoff.taskSummary
  ) {
    return undefined;
  }
  return handoff;
}

/**
 * Map persisted chat turns into SDK conversation messages for Agent Engine.
 */
export function buildConversationCarry(
  options: BuildConversationCarryOptions,
): MitiiConversationMessage[] {
  const defaults = resolveConversationCarryLimits(options.mode);
  const maxMessages =
    options.limits?.maxMessages ?? defaults.maxMessages;
  const maxChars =
    options.limits?.maxCharsPerMessage ?? defaults.maxCharsPerMessage;

  const structuredPrefix = buildStructuredCarryPrefix(options.structured);
  const chatBudget = structuredPrefix
    ? Math.max(0, maxMessages - 1)
    : maxMessages;

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

  const windowed = source.slice(-chatBudget);
  const carried: MitiiConversationMessage[] = [];

  if (structuredPrefix) {
    carried.push({ role: 'user', content: structuredPrefix });
  }

  for (const message of windowed) {
    const content = truncateMessage(message.text.trim(), maxChars);
    if (!content) continue;
    carried.push({ role: message.role, content });
  }

  return carried;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
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
 * Companion strategy for a host-carried approved plan.
 * Agent mode only; ignored when the persisted shape is stale.
 */
export function resolvePlanStrategyHandoff(options: {
  mode: AgentCarryMode;
  pendingPlanStrategy: unknown;
}): PlanStrategyDecision | undefined {
  if (options.mode !== 'agent') return undefined;
  return parsePendingPlanStrategy(options.pendingPlanStrategy);
}

/**
 * Validate a persisted pending plan (memento may hold stale shapes).
 */
export function parsePendingPlan(value: unknown): PlanArtifact | undefined {
  if (value == null) return undefined;
  const parsed = planArtifactSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parsePendingPlanStrategy(
  value: unknown,
): PlanStrategyDecision | undefined {
  if (value == null) return undefined;
  const parsed = planStrategyDecisionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parsePendingTaskList(value: unknown): TaskList | undefined {
  if (value == null) return undefined;
  const parsed = taskListSchema.safeParse(value);
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

const PLANNING_PHRASE =
  /\b(?:let me|i(?:'ll| will)|i(?:'m| am) going to|i need to|i should)\b/gi;

function isMidWorkAnalysisDump(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 800) return false;
  const planning = trimmed.match(PLANNING_PHRASE) ?? [];
  return planning.length >= 8;
}

function isWeakAssistantDisplay(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (/^(?:\([\w_]+\)|Error:)/.test(trimmed) && trimmed.length < 80) return true;
  if (/^Completed workspace edits\b/i.test(trimmed) && trimmed.length < 260) return true;
  if (/^Completed workspace edits\b[\s\S]*\bChanged files \(\d+\):/i.test(trimmed)) {
    return true;
  }
  if (isMidWorkAnalysisDump(trimmed)) return true;
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
  if (isMidWorkAnalysisDump(streamed)) return final;

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
