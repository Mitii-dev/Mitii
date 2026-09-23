/**
 * Host-side conversation carry — mirrors apps/vscode/src/conversationCarry.ts
 * so follow-up turns (e.g. "1" after numbered options) reach Agent Engine
 * with prior user/assistant context.
 */

import type { MitiiConversationMessage } from '@mitii/sdk';

export const CONVERSATION_CARRY_LIMITS = {
  maxMessages: 20,
  maxCharsPerMessage: 8_000,
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
  mode?: AgentCarryMode;
  structured?: StructuredCarryHandoff;
  limits?: Partial<typeof CONVERSATION_CARRY_LIMITS>;
}

export function resolveConversationCarryLimits(mode?: AgentCarryMode): {
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

function truncateMessage(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '…';
  return `${text.slice(0, maxChars - 1)}…`;
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
 * Collect structured handoff facts from recent chat messages (edits + errors).
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
  const maxMessages = options.limits?.maxMessages ?? defaults.maxMessages;
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
