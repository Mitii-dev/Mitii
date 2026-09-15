import { join } from 'node:path';
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
}

/**
 * Surfaces Mitii review findings in the editor like a real code review:
 * Problems diagnostics (severity) + comment threads on the line.
 */
export class ReviewFindingsPresenter implements vscode.Disposable {
  private readonly diagnostics: vscode.DiagnosticCollection;
  private readonly commentController: vscode.CommentController;
  private readonly threads: vscode.CommentThread[] = [];
  private findings: ReviewFindingView[] = [];
  private revealedFirst = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly vs: typeof vscode,
    private readonly workspaceRoot: () => string | undefined,
  ) {
    this.diagnostics = vs.languages.createDiagnosticCollection('mitii-review');
    this.commentController = vs.comments.createCommentController(
      'mitii.review',
      'Mitii Review',
    );
    this.commentController.commentingRangeProvider = {
      provideCommentingRanges: () => undefined,
    };
    this.disposables.push(this.diagnostics, this.commentController);
  }

  clear(): void {
    this.findings = [];
    this.revealedFirst = false;
    this.diagnostics.clear();
    for (const thread of this.threads) {
      thread.dispose();
    }
    this.threads.length = 0;
  }

  getFindings(): readonly ReviewFindingView[] {
    return this.findings;
  }

  /** Begin a new review run — drop prior findings. */
  beginRun(): void {
    this.clear();
  }

  /** Ingest one successful emit_review_finding tool result. */
  ingestToolEvent(params: {
    status: string;
    summary?: string;
    outputPreview?: string;
  }): void {
    if (params.status !== 'succeeded') return;
    const finding =
      parseFindingFromOutputPreview(params.outputPreview ?? '') ??
      (params.summary ? parseFindingFromSummary(params.summary) : null);
    if (!finding) return;
    this.findings.push(finding);
    void this.publish();
  }

  /** Replace all findings and publish (e.g. from a finalized record). */
  setFindings(next: readonly ReviewFindingView[]): void {
    this.findings = [...next];
    void this.publish();
  }

  private async publish(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;

    // Clear previous editor markers, then rebuild.
    this.diagnostics.clear();
    for (const thread of this.threads) {
      thread.dispose();
    }
    this.threads.length = 0;

    const byUri = new Map<string, vscode.Diagnostic[]>();

    for (const finding of this.findings) {
      const abs = join(root, finding.path);
      const uri = this.vs.Uri.file(abs);
      const line = Math.max(1, finding.startLine ?? 1);
      const endLine = Math.max(line, finding.endLine ?? line);
      const range = new this.vs.Range(
        line - 1,
        0,
        endLine - 1,
        Number.MAX_SAFE_INTEGER,
      );

      const severity = toDiagnosticSeverity(this.vs, finding.severity);
      const label = severityLabel(finding.severity);
      const category = finding.category ? ` · ${finding.category}` : '';
      const message = `[${label}${category}] ${finding.content}`;

      const diagnostic = new this.vs.Diagnostic(range, message, severity);
      diagnostic.source = 'Mitii Review';
      diagnostic.code = finding.category ?? 'review';
      const list = byUri.get(uri.toString()) ?? [];
      list.push(diagnostic);
      byUri.set(uri.toString(), list);

      const bodyParts = [
        `**${label}**${category}`,
        '',
        finding.content,
      ];
      if (finding.existingCode?.trim()) {
        bodyParts.push('', '```', finding.existingCode.trim().slice(0, 800), '```');
      }
      if (finding.suggestionCode?.trim()) {
        bodyParts.push(
          '',
          '_Suggestion:_',
          '```',
          finding.suggestionCode.trim().slice(0, 800),
          '```',
        );
      }

      const thread = this.commentController.createCommentThread(uri, range, [
        {
          body: new this.vs.MarkdownString(bodyParts.join('\n')),
          mode: this.vs.CommentMode.Preview,
          author: { name: 'Mitii Review' },
        },
      ]);
      thread.label = `${label}${category}`;
      thread.collapsibleState =
        this.vs.CommentThreadCollapsibleState.Expanded;
      thread.canReply = false;
      this.threads.push(thread);
    }

    for (const [uriKey, diags] of byUri) {
      this.diagnostics.set(this.vs.Uri.parse(uriKey), diags);
    }

    // Open the first finding once per run so subsequent findings don't steal focus.
    const first = this.findings[0];
    if (first && !this.revealedFirst) {
      this.revealedFirst = true;
      try {
        const doc = await this.vs.workspace.openTextDocument(
          this.vs.Uri.file(join(root, first.path)),
        );
        const editor = await this.vs.window.showTextDocument(doc, {
          preview: true,
          viewColumn: this.vs.ViewColumn.One,
          preserveFocus: true,
        });
        const line = Math.max(0, (first.startLine ?? 1) - 1);
        const pos = new this.vs.Position(line, 0);
        editor.revealRange(
          new this.vs.Range(pos, pos),
          this.vs.TextEditorRevealType.InCenterIfOutsideViewport,
        );
        editor.selection = new this.vs.Selection(pos, pos);
      } catch {
        // File may have been deleted; diagnostics still show in Problems.
      }
    }
  }

  dispose(): void {
    this.clear();
    for (const d of this.disposables) d.dispose();
  }
}

export function parseFindingFromOutputPreview(
  preview: string,
): ReviewFindingView | null {
  const text = preview.trim();
  if (!text) return null;

  // Prefer JSON object in the preview (may be truncated / compacted).
  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) {
    return parseFindingFromSummary(text);
  }
  let raw = text.slice(jsonStart);
  // Truncation marker from tool-runtime / audit preview.
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
      ? ((parsed as { finding?: unknown; accepted?: unknown }).finding &&
        typeof (parsed as { finding: unknown }).finding === 'object'
          ? ((parsed as { finding: Record<string, unknown> }).finding)
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
  const content =
    text.includes('::')
      ? text.slice(text.indexOf('::') + 2).trim()
      : matchKv(text, 'msg') ?? matchStringField(text, 'content');
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

function normalizeSeverity(value: string | undefined): ReviewFindingSeverity {
  const raw = (value ?? 'medium').toLowerCase();
  if (raw === 'critical' || raw === 'blocker') return 'critical';
  if (raw === 'high' || raw === 'error') return 'high';
  if (raw === 'low' || raw === 'nit' || raw === 'fyi') return 'low';
  if (raw === 'info' || raw === 'hint') return 'info';
  return 'medium';
}

function severityLabel(severity: ReviewFindingSeverity): string {
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

function toDiagnosticSeverity(
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
