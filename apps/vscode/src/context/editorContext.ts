import { relative } from 'node:path';
import type * as vscode from 'vscode';

export interface EditorContextSnapshot {
  activeRelPath?: string;
  selectionText?: string;
  selectionStartLine?: number;
  selectionEndLine?: number;
  openTabRelPaths: string[];
  /** Compact block suitable for prompt prefix. */
  promptBlock: string;
}

function toRelPath(
  workspaceRoot: string | undefined,
  uri: vscode.Uri,
): string | undefined {
  if (uri.scheme !== 'file') return undefined;
  if (!workspaceRoot) return uri.fsPath;
  const rel = relative(workspaceRoot, uri.fsPath);
  if (!rel || rel.startsWith('..')) return undefined;
  return rel.replace(/\\/g, '/');
}

/** Snapshot active editor + open tabs for agent context. */
export function captureEditorContext(
  vs: typeof vscode,
  workspaceRoot: string | undefined,
  options: { includeOpenTabs?: boolean; maxSelectionChars?: number } = {},
): EditorContextSnapshot {
  const includeOpenTabs = options.includeOpenTabs ?? false;
  const maxSelectionChars = options.maxSelectionChars ?? 4000;
  const openTabRelPaths: string[] = [];
  const seen = new Set<string>();

  if (includeOpenTabs) {
    for (const group of vs.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input && typeof input === 'object' && 'uri' in input) {
          const uri = (input as { uri: vscode.Uri }).uri;
          const rel = toRelPath(workspaceRoot, uri);
          if (rel && !seen.has(rel)) {
            seen.add(rel);
            openTabRelPaths.push(rel);
          }
        }
      }
    }
  }

  const editor = vs.window.activeTextEditor;
  let activeRelPath: string | undefined;
  let selectionText: string | undefined;
  let selectionStartLine: number | undefined;
  let selectionEndLine: number | undefined;

  if (editor) {
    activeRelPath = toRelPath(workspaceRoot, editor.document.uri);
    const selection = editor.selection;
    if (!selection.isEmpty) {
      selectionText = editor.document.getText(selection).slice(0, maxSelectionChars);
      selectionStartLine = selection.start.line + 1;
      selectionEndLine = selection.end.line + 1;
    }
  }

  const lines: string[] = [];
  if (activeRelPath) {
    if (selectionText && selectionStartLine && selectionEndLine) {
      lines.push(
        `Active editor selection @${activeRelPath}:${selectionStartLine}-${selectionEndLine}:\n\`\`\`\n${selectionText}\n\`\`\``,
      );
    } else {
      lines.push(`Active editor: @${activeRelPath}`);
    }
  }
  if (openTabRelPaths.length) {
    lines.push(
      `Open tabs:\n${openTabRelPaths
        .slice(0, 8)
        .map((p) => `- @${p}`)
        .join('\n')}`,
    );
  }

  return {
    activeRelPath,
    selectionText,
    selectionStartLine,
    selectionEndLine,
    openTabRelPaths: openTabRelPaths.slice(0, 8),
    promptBlock: lines.join('\n\n'),
  };
}
