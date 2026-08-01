import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as vscode from 'vscode';

type LineDiffPart = {
  added?: boolean;
  removed?: boolean;
  count?: number;
  value: string;
};

function lineDiffParts(oldText: string, newText: string): LineDiffPart[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const parts: LineDiffPart[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i += 1) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      if (oldLine !== undefined) parts.push({ value: oldLine, count: 1 });
      continue;
    }
    if (oldLine !== undefined) {
      parts.push({ removed: true, value: oldLine, count: 1 });
    }
    if (newLine !== undefined) {
      parts.push({ added: true, value: newLine, count: 1 });
    }
  }
  return parts;
}

export interface PendingInlineDiff {
  approvalId: string;
  relPath: string;
  originalText: string;
  proposedText: string;
  toolName: string;
}

/**
 * Green/red whole-line decorations for a pending approval hunk.
 */
export class InlineDiffManager implements vscode.Disposable {
  private pending: PendingInlineDiff | undefined;
  private readonly addedDecoration: vscode.TextEditorDecorationType;
  private readonly removedDecoration: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly vs: typeof vscode,
    private readonly onAccept: (approvalId: string) => Promise<void>,
    private readonly onReject: (approvalId: string) => Promise<void>,
  ) {
    this.addedDecoration = vs.window.createTextEditorDecorationType({
      backgroundColor: new vs.ThemeColor('diffEditor.insertedTextBackground'),
      isWholeLine: true,
    });
    this.removedDecoration = vs.window.createTextEditorDecorationType({
      backgroundColor: new vs.ThemeColor('diffEditor.removedTextBackground'),
      isWholeLine: true,
      textDecoration: 'line-through',
    });

    this.disposables.push(
      vs.commands.registerCommand('mitii.acceptInlineDiff', () => this.accept()),
      vs.commands.registerCommand('mitii.rejectInlineDiff', () => this.reject()),
      vs.window.onDidChangeActiveTextEditor(() => this.refreshDecorations()),
    );
  }

  setPending(diff: PendingInlineDiff | undefined): void {
    this.pending = diff;
    if (diff) {
      void this.showInEditor(diff);
    } else {
      this.clearDecorations();
    }
  }

  getPending(): PendingInlineDiff | undefined {
    return this.pending;
  }

  async showForApproval(
    workspace: string,
    approvalId: string,
    relPath: string,
    toolName: string,
    proposedText: string,
    oldText?: string,
  ): Promise<void> {
    const filePath = join(workspace, relPath);
    const originalText =
      oldText ?? (existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '');
    const diff: PendingInlineDiff = {
      approvalId,
      relPath,
      originalText,
      proposedText,
      toolName,
    };
    this.setPending(diff);
    await this.showInEditor(diff);
  }

  private async showInEditor(diff: PendingInlineDiff): Promise<void> {
    const workspaceFolder = this.vs.workspace.workspaceFolders?.[0]?.uri;
    const fileUri = workspaceFolder
      ? this.vs.Uri.joinPath(workspaceFolder, diff.relPath)
      : this.vs.Uri.file(diff.relPath);
    try {
      const doc = await this.vs.workspace.openTextDocument(fileUri);
      const editor = await this.vs.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: true,
      });
      this.applyDecorations(editor, diff.originalText, diff.proposedText);
    } catch {
      const preview = await this.vs.workspace.openTextDocument({
        language: 'plaintext',
        content: diff.proposedText,
      });
      const editor = await this.vs.window.showTextDocument(preview, {
        preview: true,
        preserveFocus: true,
      });
      this.applyDecorations(editor, diff.originalText, diff.proposedText);
    }
  }

  private applyDecorations(
    editor: vscode.TextEditor,
    originalText: string,
    proposedText: string,
  ): void {
    const parts = lineDiffParts(originalText, proposedText);
    const addedRanges: vscode.Range[] = [];
    const removedRanges: vscode.Range[] = [];
    let line = 0;

    for (const part of parts) {
      const lineCount =
        part.count ??
        part.value.split('\n').length - (part.value.endsWith('\n') ? 1 : 0);
      if (part.added) {
        addedRanges.push(new this.vs.Range(line, 0, line + lineCount, 0));
        line += lineCount;
      } else if (part.removed) {
        removedRanges.push(new this.vs.Range(line, 0, line + lineCount, 0));
      } else {
        line += lineCount;
      }
    }

    editor.setDecorations(this.addedDecoration, addedRanges);
    editor.setDecorations(this.removedDecoration, removedRanges);
  }

  private refreshDecorations(): void {
    if (!this.pending) return;
    const editor = this.vs.window.activeTextEditor;
    if (!editor) return;
    const docPath = editor.document.uri.fsPath;
    if (
      docPath.endsWith(this.pending.relPath) ||
      editor.document.fileName.endsWith(this.pending.relPath)
    ) {
      this.applyDecorations(
        editor,
        this.pending.originalText,
        this.pending.proposedText,
      );
    }
  }

  private clearDecorations(): void {
    for (const editor of this.vs.window.visibleTextEditors) {
      editor.setDecorations(this.addedDecoration, []);
      editor.setDecorations(this.removedDecoration, []);
    }
  }

  private async accept(): Promise<void> {
    if (!this.pending) return;
    const id = this.pending.approvalId;
    this.setPending(undefined);
    await this.onAccept(id);
  }

  private async reject(): Promise<void> {
    if (!this.pending) return;
    const id = this.pending.approvalId;
    this.setPending(undefined);
    await this.onReject(id);
  }

  dispose(): void {
    this.addedDecoration.dispose();
    this.removedDecoration.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
