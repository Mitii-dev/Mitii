/**
 * Typed prompt injection (Mitii ContextualFragment discipline).
 *
 * - Every injection is a typed fragment with stable contentKind + markers.
 * - `render()` concatenates markers + body with no extra separators.
 * - Unmarked fragments leave both markers empty and never match arbitrary text.
 * - Hard size caps live in fragment policy (absolute max + review threshold).
 */

export type FragmentRole = "system" | "developer" | "user";

export interface RenderedFragment {
  readonly role: FragmentRole;
  readonly contentKind: string;
  readonly text: string;
  readonly tokens: number;
  readonly truncated: boolean;
  readonly truncatedTokens: number;
}

/**
 * Context payload that is injected as a message fragment.
 * Implementations own role, classification, markers, and exact body text.
 */
export interface ContextualFragment {
  /** Stable id for provenance / omission reports. */
  readonly id: string;

  /** Response role that owns this fragment. */
  role(): FragmentRole;

  /**
   * Stable `feature.name` classification for provenance / cache keys.
   * Use `generic.*` for shared fragments.
   */
  contentKind(): string;

  /** Whether this fragment must be recorded as its own response item. */
  requiresSeparateMessage(): boolean;

  /** Start/end markers used to recognize injected context later. */
  markers(): readonly [start: string, end: string];

  /** Exact fragment body (no markers). */
  body(): string;

  /** Hard per-fragment token cap (nothing unbounded). */
  maxTokens(): number;

  /** Section used for Mitii budget / provenance accounting. */
  section():
    | "system"
    | "rules"
    | "skills"
    | "memory"
    | "plan"
    | "repository"
    | "environment";

  trust():
    | "trusted_instruction"
    | "conversation"
    | "untrusted_repository_content"
    | "untrusted_tool_content";
}

export function renderFragment(
  fragment: ContextualFragment,
  estimateTokens: (text: string) => number,
  truncateToBudget: (
    text: string,
    budgetTokens: number,
  ) => { content: string; usedTokens: number; truncatedTokens: number },
): RenderedFragment {
  const [start, end] = fragment.markers();
  const rawBody = fragment.body();
  const cap = fragment.maxTokens();
  const bodyEstimate = estimateTokens(rawBody);
  let body = rawBody;
  let truncated = false;
  let truncatedTokens = 0;

  if (bodyEstimate > cap) {
    const truncatedBody = truncateToBudget(rawBody, cap);
    body = truncatedBody.content;
    truncated = truncatedBody.truncatedTokens > 0;
    truncatedTokens = truncatedBody.truncatedTokens;
  }

  const text =
    start.length === 0 && end.length === 0
      ? body
      : `${start}${body}${end}`;

  return {
    role: fragment.role(),
    contentKind: fragment.contentKind(),
    text,
    tokens: estimateTokens(text),
    truncated,
    truncatedTokens,
  };
}

export function matchesMarkedFragment(
  startMarker: string,
  endMarker: string,
  text: string,
): boolean {
  if (startMarker.length === 0 || endMarker.length === 0) {
    return false;
  }
  const trimmedStart = text.trimStart();
  const starts = trimmedStart
    .slice(0, startMarker.length)
    .toLowerCase()
    .startsWith(startMarker.toLowerCase());
  const trimmedEnd = text.trimEnd();
  const ends = trimmedEnd
    .slice(Math.max(0, trimmedEnd.length - endMarker.length))
    .toLowerCase()
    .endsWith(endMarker.toLowerCase());
  return starts && ends;
}
