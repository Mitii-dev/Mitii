import { join } from 'node:path';
import type * as vscode from 'vscode';

import {
  parseFindingFromOutputPreview,
  parseFindingFromSummary,
  reviewFindingKey,
  severityLabel,
  toDiagnosticSeverity,
  type ReviewFindingView,
} from './reviewFindingParse.js';

export type {
  ReviewFindingSeverity,
  ReviewFindingView,
} from './reviewFindingParse.js';
export {
  parseFindingFromOutputPreview,
  parseFindingFromSummary,
  reviewFindingKey,
} from './reviewFindingParse.js';

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

  getOpenFindings(): readonly ReviewFindingView[] {
    return this.findings.filter((f) => f.status !== 'fixed');
  }

  /** Begin a new review run — drop prior findings. */
  beginRun(): void {
    this.clear();
  }

  /**
   * Mark findings as fixed (by key). Clears their editor markers but keeps
   * them in the list for strike-through / Done UI.
   */
  markFixedByKeys(keys: readonly string[]): number {
    if (keys.length === 0) return 0;
    const keySet = new Set(keys);
    let marked = 0;
    this.findings = this.findings.map((finding) => {
      if (finding.status === 'fixed') return finding;
      if (!keySet.has(reviewFindingKey(finding))) return finding;
      marked += 1;
      return { ...finding, status: 'fixed' as const };
    });
    if (marked > 0) {
      void this.publish();
    }
    return marked;
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
    this.findings.push({ ...finding, status: 'open' });
    void this.publish();
  }

  /** Replace all findings and publish (e.g. from a finalized record). */
  setFindings(next: readonly ReviewFindingView[]): void {
    this.findings = next.map((f) => ({
      ...f,
      status: f.status === 'fixed' ? 'fixed' : 'open',
    }));
    void this.publish();
  }

  private async publish(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;

    this.diagnostics.clear();
    for (const thread of this.threads) {
      thread.dispose();
    }
    this.threads.length = 0;

    const byUri = new Map<string, vscode.Diagnostic[]>();

    for (const finding of this.findings) {
      if (finding.status === 'fixed') continue;

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

      const bodyParts = [`**${label}**${category}`, '', finding.content];
      if (finding.existingCode?.trim()) {
        bodyParts.push(
          '',
          '```',
          finding.existingCode.trim().slice(0, 800),
          '```',
        );
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

    const first = this.findings.find((f) => f.status !== 'fixed');
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
