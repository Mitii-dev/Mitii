import type * as vscode from 'vscode';

export type ReviewFindingSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';

export interface ReviewFindingView {
  path: string;
  content: string;
  existingCode?: string;
  suggestionCode?: string;
  startLine?: number;
  endLine?: number;
  category?: string;
  severity: ReviewFindingSeverity;
  anchored?: boolean;
  /** Set after a successful Fix / Fix all run. */
  status?: 'open' | 'fixed';
}

/** Stable id for matching findings across Fix runs. */
export function reviewFindingKey(finding: {
  path: string;
  content: string;
  startLine?: number;
}): string {
  const path = finding.path.replace(/\\/g, '/').replace(/^\.\//, '');
  const line = finding.startLine ?? '';
  const content = finding.content.trim().slice(0, 160);
  return `${path}|${line}|${content}`;
}

export function parseFindingFromOutputPreview(
  preview: string,
): ReviewFindingView | null {
  const text = preview.trim();
  if (!text) return null;

  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) {
    return parseFindingFromSummary(text);
  }
  let raw = text.slice(jsonStart);
  raw = raw.replace(/…$/, '').replace(/\.\.\.$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const fromFields = parseFindingFromLooseFields(text);
    return fromFields ?? parseFindingFromSummary(text);
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
    anchored: record.anchored === true,
  };
}

/** Parse `finding path=… line=… sev=… cat=… :: message` summaries. */
export function parseFindingFromSummary(
  summary: string,
): ReviewFindingView | null {
  const text = summary.trim();
  if (!text.toLowerCase().includes('finding') && !/\bpath=/.test(text)) {
    return null;
  }
  const path = matchKv(text, 'path');
  const content = text.includes('::')
    ? text.slice(text.indexOf('::') + 2).trim()
    : (matchKv(text, 'msg') ?? matchStringField(text, 'content'));
  if (!path || !content) return null;
  const lineRaw = matchKv(text, 'line');
  const line = lineRaw && /^\d+$/.test(lineRaw) ? Number(lineRaw) : undefined;
  return {
    path,
    content,
    startLine: line,
    endLine: line,
    category: matchKv(text, 'cat') ?? undefined,
    severity: normalizeSeverity(matchKv(text, 'sev') ?? undefined),
  };
}

function parseFindingFromLooseFields(text: string): ReviewFindingView | null {
  const path = matchStringField(text, 'path');
  const content = matchStringField(text, 'content');
  if (!path || !content) return null;
  return {
    path,
    content,
    existingCode: matchStringField(text, 'existingCode') ?? undefined,
    startLine: matchNumberField(text, 'startLine') ?? undefined,
    endLine: matchNumberField(text, 'endLine') ?? undefined,
    category: matchStringField(text, 'category') ?? undefined,
    severity: normalizeSeverity(matchStringField(text, 'severity') ?? undefined),
  };
}

function matchKv(text: string, key: string): string | null {
  const re = new RegExp(`\\b${key}=([^\\s]+)`);
  const m = text.match(re);
  return m?.[1] ? m[1].replace(/^"|"$/g, '') : null;
}

export function normalizeSeverity(
  value: string | undefined,
): ReviewFindingSeverity {
  const raw = (value ?? 'medium').toLowerCase();
  if (raw === 'critical' || raw === 'blocker') return 'critical';
  if (raw === 'high' || raw === 'error') return 'high';
  if (raw === 'low' || raw === 'nit' || raw === 'fyi') return 'low';
  if (raw === 'info' || raw === 'hint') return 'info';
  return 'medium';
}

export function severityLabel(severity: ReviewFindingSeverity): string {
  switch (severity) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    case 'info':
      return 'Info';
  }
}

export function toDiagnosticSeverity(
  vs: typeof vscode,
  severity: ReviewFindingSeverity,
): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'critical':
    case 'high':
      return vs.DiagnosticSeverity.Error;
    case 'medium':
      return vs.DiagnosticSeverity.Warning;
    case 'low':
      return vs.DiagnosticSeverity.Information;
    case 'info':
      return vs.DiagnosticSeverity.Hint;
  }
}

function matchStringField(text: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = text.match(re);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}

function matchNumberField(text: string, key: string): number | null {
  const re = new RegExp(`"${key}"\\s*:\\s*(\\d+)`);
  const m = text.match(re);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
