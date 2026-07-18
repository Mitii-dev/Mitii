export type ControlIntent =
  | 'new_task'
  | 'continue_task'
  | 'approve_pending'
  | 'reject_pending'
  | 'cancel_task'
  | 'clarify_previous'
  | 'acknowledgement';

export interface ControlIntentState {
  hasActiveTask?: boolean;
  hasPendingApproval?: boolean;
  previousTurnAskedQuestion?: boolean;
}

export interface ControlIntentResolution {
  intent: ControlIntent;
  matchedRule?: string;
  requiresConversationContext: boolean;
}

const CONTINUE_RE = /^(?:continue|resume|proceed|go ahead|do it|please do|try again|same thing|fix it)[.!]?$/i;
const APPROVE_RE = /^(?:yes|y|approve|approved|confirm|confirmed|go ahead|do it)[.!]?$/i;
const REJECT_RE = /^(?:no|n|reject|rejected|decline|declined)[.!]?$/i;
const CANCEL_RE = /^(?:cancel|stop|abort|never mind|nevermind)[.!]?$/i;
const ACK_RE = /^(?:thanks|thank you|ok|okay|got it|understood)[.!]?$/i;

/**
 * Resolves conversational control before semantic/domain classification.
 * Short replies are state-dependent; "yes" is not approval without a pending approval.
 */
export function resolveControlIntent(
  message: string,
  state: ControlIntentState = {}
): ControlIntentResolution {
  const text = message.trim();

  if (!text || text === '?') {
    return {
      intent: state.hasActiveTask || state.previousTurnAskedQuestion
        ? 'clarify_previous'
        : 'new_task',
      matchedRule: text ? 'question-mark follow-up' : 'empty message',
      requiresConversationContext: Boolean(state.hasActiveTask || state.previousTurnAskedQuestion),
    };
  }

  if (CANCEL_RE.test(text)) {
    return {
      intent: 'cancel_task',
      matchedRule: 'explicit cancellation',
      requiresConversationContext: false,
    };
  }

  if (state.hasPendingApproval && APPROVE_RE.test(text)) {
    return {
      intent: 'approve_pending',
      matchedRule: 'approval reply with pending approval',
      requiresConversationContext: true,
    };
  }

  if (state.hasPendingApproval && REJECT_RE.test(text)) {
    return {
      intent: 'reject_pending',
      matchedRule: 'rejection reply with pending approval',
      requiresConversationContext: true,
    };
  }

  if (CONTINUE_RE.test(text)) {
    return {
      intent: state.hasActiveTask ? 'continue_task' : 'clarify_previous',
      matchedRule: state.hasActiveTask ? 'active-task continuation' : 'referential continuation',
      requiresConversationContext: true,
    };
  }

  if (ACK_RE.test(text) || APPROVE_RE.test(text) || REJECT_RE.test(text)) {
    return {
      intent: 'acknowledgement',
      matchedRule: 'standalone acknowledgement',
      requiresConversationContext: false,
    };
  }

  return {
    intent: 'new_task',
    requiresConversationContext: false,
  };
}
