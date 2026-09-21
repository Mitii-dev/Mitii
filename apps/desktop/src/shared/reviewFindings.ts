/**
 * Parse emit_review_finding tool results for Desktop Code Review UI.
 */

export type ReviewFindingSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';

export interface ReviewFinding {
  path: string;
  content: string;
  existingCode?: string;
  suggestionCode?: string;
  startLine?: number;
  endLine?: number;
  category?: string;
  severity: ReviewFindingSeverity;
}

function normalizeSeverity(raw: string | undefined): ReviewFindingSeverity {
  const s = (raw ?? 'medium').toLowerCase();
  if (
    s === 'critical' ||
    s === 'high' ||
    s === 'medium' ||
    s === 'low' ||
    s === 'info'
  ) {
    return s;
  }
  if (s === 'error' || s === 'blocker') return 'critical';
  if (s === 'warn' || s === 'warning') return 'medium';
  return 'medium';
}

function matchKv(text: string, key: string): string | undefined {
  const re = new RegExp(`\\b${key}=([^\\s]+)`, 'i');
  const m = re.exec(text);
  return m?.[1];
}

export function parseFindingFromSummary(
  summary: string,
): ReviewFinding | null {
  const text = summary.trim();
  if (!text.toLowerCase().includes('finding') && !/\bpath=/.test(text)) {
    return null;
  }
  const path = matchKv(text, 'path');
  const content = text.includes('::')
    ? text.slice(text.indexOf('::') + 2).trim()
    : matchKv(text, 'msg');
  if (!path || !content) return null;
  const lineRaw = matchKv(text, 'line');
  const line = lineRaw && /^\d+$/.test(lineRaw) ? Number(lineRaw) : undefined;
  return {
    path,
    content,
    startLine: line,
    endLine: line,
    category: matchKv(text, 'cat'),
    severity: normalizeSeverity(matchKv(text, 'sev')),
  };
}

export function parseFindingFromOutputPreview(
  preview: string,
): ReviewFinding | null {
  const text = preview.trim();
  if (!text) return null;

  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) return parseFindingFromSummary(text);

  let raw = text.slice(jsonStart).replace(/…$/, '').replace(/\.\.\.$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return parseFindingFromSummary(text);
  }

  const record =
    parsed && typeof parsed === 'object'
      ? ((parsed as { finding?: unknown }).finding &&
        typeof (parsed as { finding: unknown }).finding === 'object'
          ? (parsed as { finding: Record<string, unknown> }).finding
          : (parsed as Record<string, unknown>))
      : null;
  if (!record) return parseFindingFromSummary(text);

  const path = String(record.path ?? '').trim();
  const content = String(record.content ?? '').trim();
  if (!path || !content) return parseFindingFromSummary(text);

  return {
    path,
    content,
    existingCode:
      typeof record.existingCode === 'string' ? record.existingCode : undefined,
    suggestionCode:
      typeof record.suggestionCode === 'string'
        ? record.suggestionCode
        : undefined,
    startLine:
      typeof record.startLine === 'number' ? record.startLine : undefined,
    endLine: typeof record.endLine === 'number' ? record.endLine : undefined,
    category: typeof record.category === 'string' ? record.category : undefined,
    severity: normalizeSeverity(
      typeof record.severity === 'string' ? record.severity : undefined,
    ),
  };
}

export function ingestReviewFinding(event: unknown): ReviewFinding | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  if (e.type !== 'tool_completed') return null;
  if (e.toolName !== 'emit_review_finding') return null;
  if (e.status !== 'succeeded') return null;
  const fromPreview =
    typeof e.outputPreview === 'string'
      ? parseFindingFromOutputPreview(e.outputPreview)
      : null;
  if (fromPreview) return fromPreview;
  return typeof e.summary === 'string'
    ? parseFindingFromSummary(e.summary)
    : null;
}

export const CODE_REVIEW_PROMPT =
  'Perform a thorough code review of every selected file in the current git changes, including both staged and unstaged patches. Start by calling read_git_status with includeDiff=true. Assess correctness, readability, architecture, tests, and operational risk. You MUST call emit_review_finding at least once before finishing — once per high-signal issue with path, content, existingCode, severity, and category. If there are no material issues, emit a single low/info finding that says so. Prose-only analysis is not a valid review. Prefer high-signal findings over nits.';
