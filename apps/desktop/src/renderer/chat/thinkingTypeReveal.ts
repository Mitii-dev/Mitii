/**
 * Gradual catch-up for live thinking text — feels like typing without
 * remounting or flashing the chat.
 */

export interface TypeRevealStepOptions {
  /** Chars to advance when only slightly behind (default 1). */
  nearStep?: number;
  /** Chars to advance when moderately behind (default 3). */
  midStep?: number;
  /** Lag (chars) above which we jump harder (default 80). */
  farLag?: number;
}

/** Advance displayed length toward target; never exceeds target. */
export function nextTypedLength(
  current: number,
  target: number,
  options: TypeRevealStepOptions = {},
): number {
  if (target <= 0) return 0;
  if (current >= target) return target;
  if (current < 0) current = 0;

  const nearStep = options.nearStep ?? 1;
  const midStep = options.midStep ?? 3;
  const farLag = options.farLag ?? 80;
  const lag = target - current;

  let step: number;
  if (lag > farLag) step = Math.ceil(lag / 6);
  else if (lag > 24) step = midStep;
  else step = nearStep;

  return Math.min(target, current + step);
}

/** Slice source to the typed length (UTF-16 safe for our previews). */
export function typedSlice(source: string, length: number): string {
  if (length <= 0) return '';
  if (length >= source.length) return source;
  return source.slice(0, length);
}
