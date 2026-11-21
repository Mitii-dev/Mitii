import { type ChatTurn, type TurnSegment } from '../components/MessageList';
import { type TokenUsageSnapshot, type ChatMessageView } from '../protocol';

export function appendTextSegment(segments: TurnSegment[], text: string): TurnSegment[] {
  const last = segments[segments.length - 1];
  if (last?.kind === 'text') {
    const next = [...segments];
    next[next.length - 1] = { ...last, text: `${last.text}${text}` };
    return next;
  }
  return [...segments, { id: uid('seg'), kind: 'text', text, at: Date.now() }];
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const EMPTY_TOKEN_USAGE: TokenUsageSnapshot = {
  sessionTotal: 0,
  inputTokensTotal: 0,
  outputTokensTotal: 0,
  currentTurnTotal: 0,
  currentTurnInputTokens: 0,
  currentTurnOutputTokens: 0,
  aiCallCount: 0,
  modelCalls: 0,
  toolCalls: 0,
  loopIterations: 0,
  lastPromptTokens: 0,
  lastResponseTokens: 0,
  turnCount: 0,
  contextWindow: 32768,
  estimated: true,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  turns: [],
  live: false,
};

/** Operational budget/context notices — not actionable UI warnings. */
export function isNoiseWarning(detail: string): boolean {
  return /context (file|item) limit prevented|context token budget prevented|default token estimate was used|leftover context was smaller|turn output tokens reduced/i.test(
    detail,
  );
}

export function toChatTurn(message: ChatMessageView): ChatTurn {
  const segments: TurnSegment[] = (message.activity ?? [])
    .filter(
      (event) =>
        !(
          event.kind === 'warning' &&
          event.detail?.trim() &&
          isNoiseWarning(event.detail)
        ),
    )
    .map((event) => ({
      id: uid('seg'),
      kind: 'activity' as const,
      event,
    }));
  const warnings = (message.activity ?? [])
    .filter(
      (event) =>
        event.kind === 'warning' &&
        event.detail?.trim() &&
        !isNoiseWarning(event.detail),
    )
    .map((event) => event.detail!.trim());
  if (message.text.trim()) {
    segments.push({
      id: uid('seg'),
      kind: 'text',
      text: message.text,
      at: Date.now(),
    });
  }
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    segments,
    ...(warnings.length ? { warnings } : {}),
    mode: message.mode,
    ...(message.fileChanges ? { fileChanges: message.fileChanges } : {}),
    ...(message.status ? { status: message.status } : {}),
    ...(message.route !== undefined ? { route: message.route } : {}),
  };
}
