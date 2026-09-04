/**
 * Line-window selection for read_file / model budgeting.
 * All line numbers are 1-based inclusive.
 */

export const READ_FILE_TRUNCATION_REASONS = [
  "byte_cap",
  "line_range",
  "max_lines",
  "model_budget",
] as const;

export type ReadFileTruncationReason =
  (typeof READ_FILE_TRUNCATION_REASONS)[number];

export interface LineWindowRequest {
  /** Full file text, or a prefix already loaded from disk. */
  text: string;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
  /** Soft character budget for the returned content (line-boundary clip). */
  maxChars?: number;
  /**
   * When true, `text` is known to be the entire file.
   * When false, reaching the end of `text` does not imply EOF.
   */
  textIsComplete?: boolean;
}

export interface LineWindowResult {
  content: string;
  startLine: number;
  endLine: number;
  totalLines?: number;
  eof: boolean;
  nextStartLine?: number;
  truncated: boolean;
  truncationReason?: ReadFileTruncationReason;
}

/**
 * Select a line window from text, clipping on line boundaries for budgets.
 */
export function selectLineWindow(request: LineWindowRequest): LineWindowResult {
  const lines = splitLines(request.text);
  const textIsComplete = request.textIsComplete !== false;
  const totalLines = textIsComplete ? lines.length : undefined;

  const requestedStart = Math.max(1, Math.floor(request.startLine ?? 1));
  const requestedEnd =
    request.endLine !== undefined
      ? Math.max(requestedStart, Math.floor(request.endLine))
      : undefined;
  const maxLines =
    request.maxLines !== undefined
      ? Math.max(1, Math.floor(request.maxLines))
      : undefined;
  const maxChars =
    request.maxChars !== undefined
      ? Math.max(1, Math.floor(request.maxChars))
      : undefined;

  if (lines.length === 0) {
    return {
      content: "",
      startLine: 1,
      endLine: 0,
      totalLines: textIsComplete ? 0 : undefined,
      eof: textIsComplete,
      truncated: false,
    };
  }

  if (requestedStart > lines.length) {
    return {
      content: "",
      startLine: requestedStart,
      endLine: requestedStart - 1,
      totalLines,
      eof: textIsComplete,
      truncated: true,
      truncationReason: textIsComplete ? "line_range" : "byte_cap",
      ...(!textIsComplete ? { nextStartLine: requestedStart } : {}),
    };
  }

  let reason: ReadFileTruncationReason | undefined;
  let endExclusive = lines.length;

  if (requestedEnd !== undefined && requestedEnd < endExclusive) {
    endExclusive = requestedEnd;
    reason = "line_range";
  }

  if (maxLines !== undefined) {
    const capped = requestedStart - 1 + maxLines;
    if (capped < endExclusive) {
      endExclusive = capped;
      reason = reason ?? "max_lines";
    }
  }

  const startIndex = requestedStart - 1;
  let endIndex = endExclusive;

  if (maxChars !== undefined) {
    const clipped = clipLinesToCharBudget(lines, startIndex, endIndex, maxChars);
    if (
      clipped.truncated &&
      clipped.endExclusive === startIndex + 1 &&
      (lines[startIndex]?.length ?? 0) > maxChars
    ) {
      const sliced = `${lines[startIndex]!.slice(0, maxChars)}\n…[truncated]`;
      return {
        content: sliced,
        startLine: requestedStart,
        endLine: requestedStart,
        totalLines,
        eof: false,
        nextStartLine: requestedStart + 1,
        truncated: true,
        truncationReason: "model_budget",
      };
    }
    if (clipped.endExclusive < endIndex) {
      endIndex = clipped.endExclusive;
      reason = "model_budget";
    }
  }

  if (endIndex <= startIndex) {
    return {
      content: "",
      startLine: requestedStart,
      endLine: requestedStart - 1,
      totalLines,
      eof: false,
      nextStartLine: requestedStart,
      truncated: true,
      truncationReason: reason ?? "model_budget",
    };
  }

  const content = lines.slice(startIndex, endIndex).join("\n");
  const startLine = startIndex + 1;
  const endLine = endIndex;
  const reachedLastLoadedLine = endLine >= lines.length;
  const reachedFileEof = textIsComplete && reachedLastLoadedLine;

  // Explicit mid-file range: more of the file exists beyond endLine.
  const rangeLeavesRemainder =
    reason === "line_range" &&
    textIsComplete &&
    requestedEnd !== undefined &&
    requestedEnd < lines.length;

  const truncated =
    reason === "model_budget" ||
    reason === "max_lines" ||
    reason === "byte_cap" ||
    rangeLeavesRemainder ||
    !reachedFileEof ||
    (reason === "line_range" && rangeLeavesRemainder);

  // EOF only when the window includes the last line of a complete file.
  // A mid-file line_range is not EOF even if that range itself is complete.
  const eof = reachedFileEof && !rangeLeavesRemainder;

  const nextStartLine = eof ? undefined : endLine + 1;

  let truncationReason: ReadFileTruncationReason | undefined;
  if (truncated) {
    truncationReason =
      reason ??
      (!reachedFileEof ? "byte_cap" : "line_range");
  }

  return {
    content,
    startLine,
    endLine,
    totalLines,
    eof,
    ...(nextStartLine !== undefined ? { nextStartLine } : {}),
    truncated,
    ...(truncationReason ? { truncationReason } : {}),
  };
}

/**
 * Clip an already-selected window further to a character budget, preserving
 * line boundaries and rewriting coverage metadata.
 */
export function clipLineWindowToCharBudget(
  window: {
    content: string;
    startLine: number;
    endLine: number;
    totalLines?: number;
    eof: boolean;
    nextStartLine?: number;
    truncated: boolean;
    truncationReason?: ReadFileTruncationReason;
  },
  maxChars: number,
): LineWindowResult {
  const budget = Math.max(1, Math.floor(maxChars));
  if (window.content.length <= budget) {
    return { ...window };
  }

  const lines = splitLines(window.content);
  const clipped = clipLinesToCharBudget(lines, 0, lines.length, budget);

  if (clipped.endExclusive <= 0) {
    const first = lines[0] ?? "";
    return {
      content: `${first.slice(0, budget)}\n…[truncated]`,
      startLine: window.startLine,
      endLine: window.startLine,
      totalLines: window.totalLines,
      eof: false,
      nextStartLine: window.startLine + 1,
      truncated: true,
      truncationReason: "model_budget",
    };
  }

  let content = lines.slice(0, clipped.endExclusive).join("\n");
  let endLine = window.startLine + clipped.endExclusive - 1;
  if (content.length > budget) {
    content = `${lines[0]!.slice(0, budget)}\n…[truncated]`;
    endLine = window.startLine;
  }

  return {
    content,
    startLine: window.startLine,
    endLine,
    totalLines: window.totalLines,
    eof: false,
    nextStartLine: endLine + 1,
    truncated: true,
    truncationReason: "model_budget",
  };
}

export function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return text.split(/\r?\n/);
}

/**
 * Derive a soft maxLines from a character budget when the caller did not set one.
 * ~40 chars/line is a conservative code-line average.
 */
export function deriveMaxLinesFromCharBudget(maxChars: number): number {
  const budget = Math.max(1, Math.floor(maxChars));
  return Math.max(16, Math.ceil(budget / 40));
}

function clipLinesToCharBudget(
  lines: readonly string[],
  startIndex: number,
  endExclusive: number,
  maxChars: number,
): { endExclusive: number; truncated: boolean } {
  let used = 0;
  let last = startIndex;
  for (let index = startIndex; index < endExclusive; index += 1) {
    const line = lines[index]!;
    const extra = index === startIndex ? line.length : line.length + 1;
    if (used + extra > maxChars) {
      if (index === startIndex) {
        return { endExclusive: startIndex + 1, truncated: true };
      }
      return { endExclusive: last, truncated: true };
    }
    used += extra;
    last = index + 1;
  }
  return { endExclusive, truncated: false };
}
