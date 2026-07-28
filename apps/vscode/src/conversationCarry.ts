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
