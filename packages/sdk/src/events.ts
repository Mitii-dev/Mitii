import type { MitiiEvent } from './types';

export function isMitiiEvent(value: unknown): value is MitiiEvent {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string');
}

export function isTerminalEvent(event: MitiiEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}
