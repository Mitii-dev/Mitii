import type {
  AgentMode,
  AgentRunResult,
  MitiiConversationMessage,
  TaskList,
} from '@mitii/sdk';
import {
  DEFAULT_WINDOW_BUDGET_POLICY,
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
} from '@mitii/sdk';

/**
 * Fallback host-side conversation carry ceilings when callers have not
 * yet derived `WindowPolicy.carry` from Window Budget.
 * Prefer `limits` from `deriveWindowPolicy(...).carry`.
 */
export const CLI_SESSION_CARRY_LIMITS = {
  /** Matches `carryMaxMessagesMax` in window-budget defaults. */
  maxMessages: DEFAULT_WINDOW_BUDGET_POLICY.carryMaxMessagesMax,
  /** Matches `carryMaxCharsPerMessageMax` in window-budget defaults. */
  maxCharsPerMessage: DEFAULT_WINDOW_BUDGET_POLICY.carryMaxCharsPerMessageMax,
} as const;

export interface CliSessionCarry {
  conversation: MitiiConversationMessage[];
  taskList?: TaskList;
}

export interface CliSessionCarryLimits {
  maxMessages: number;
  maxCharsPerMessage: number;
}

/** Derive CLI session carry ceilings from the advertised context window. */
export function resolveCliSessionCarryLimits(
  contextWindowTokens?: number,
): CliSessionCarryLimits {
  const windowTokens =
    typeof contextWindowTokens === 'number' &&
    Number.isFinite(contextWindowTokens) &&
    contextWindowTokens > 0
      ? Math.floor(contextWindowTokens)
      : 32_768;
  const policy = deriveWindowPolicy({
    schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
    contextWindowTokens: windowTokens,
  });
  return {
    maxMessages: policy.carry.maxMessages,
    maxCharsPerMessage: policy.carry.maxCharsPerMessage,
  };
}

/**
 * Advance interactive CLI carry after a finished run.
 * Only Agent mode forwards a live list into the next start. Plan reseeds
 * from a new artifact; Ask never owns a checklist.
 */
export function nextCliSessionCarry(options: {
  mode: AgentMode;
  conversation: MitiiConversationMessage[];
  taskList?: TaskList;
  prompt: string;
  result: AgentRunResult;
  /** Prefer derived Window Budget carry; falls back to CLI_SESSION_CARRY_LIMITS. */
  limits?: Partial<CliSessionCarryLimits>;
  /** When `limits` omitted, derive from this advertised window. */
  contextWindowTokens?: number;
}): CliSessionCarry {
  const limits = resolveCarryLimits(options);
  const conversation = appendConversation(
    options.conversation,
    options.prompt,
    options.result.answer,
    limits,
  );
  if (options.mode !== 'agent') {
    return { conversation };
  }
  if (options.result.taskList) {
    return { conversation, taskList: options.result.taskList };
  }
  if (options.result.status === 'cancelled' && options.taskList) {
    return { conversation, taskList: options.taskList };
  }
  return { conversation };
}

function resolveCarryLimits(options: {
  limits?: Partial<CliSessionCarryLimits>;
  contextWindowTokens?: number;
}): CliSessionCarryLimits {
  if (
    options.limits &&
    typeof options.limits.maxMessages === 'number' &&
    typeof options.limits.maxCharsPerMessage === 'number'
  ) {
    return {
      maxMessages: Math.max(1, Math.floor(options.limits.maxMessages)),
      maxCharsPerMessage: Math.max(
        1,
        Math.floor(options.limits.maxCharsPerMessage),
      ),
    };
  }
  if (typeof options.contextWindowTokens === 'number') {
    const derived = resolveCliSessionCarryLimits(options.contextWindowTokens);
    return {
      maxMessages:
        options.limits?.maxMessages ?? derived.maxMessages,
      maxCharsPerMessage:
        options.limits?.maxCharsPerMessage ?? derived.maxCharsPerMessage,
    };
  }
  return {
    maxMessages:
      options.limits?.maxMessages ?? CLI_SESSION_CARRY_LIMITS.maxMessages,
    maxCharsPerMessage:
      options.limits?.maxCharsPerMessage ??
      CLI_SESSION_CARRY_LIMITS.maxCharsPerMessage,
  };
}

function appendConversation(
  current: MitiiConversationMessage[],
  prompt: string,
  answer: string | undefined,
  limits: CliSessionCarryLimits,
): MitiiConversationMessage[] {
  const next: MitiiConversationMessage[] = [...current];
  const user = clip(prompt, limits.maxCharsPerMessage);
  if (user) {
    next.push({ role: 'user', content: user });
  }
  const assistant = clip(answer ?? '', limits.maxCharsPerMessage);
  if (assistant) {
    next.push({ role: 'assistant', content: assistant });
  }
  return next.slice(-Math.max(1, limits.maxMessages));
}

function clip(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxChars) - 1)}…`;
}
