import * as path from 'node:path';
import * as vscode from 'vscode';

import type { WorkspaceEnvironmentSnapshot } from '@mitii/host';

/**
 * Collect a lightweight IDE session snapshot for Prompt Construction.
 * Failures are soft — returns whatever could be gathered.
 */
export function collectVsCodeEnvironmentSnapshot(params: {
  workspaceRoot?: string;
  modeReminder?: string;
  maxFiles?: number;
  maxTabs?: number;
}): WorkspaceEnvironmentSnapshot {
  const root = params.workspaceRoot
    ? path.resolve(params.workspaceRoot)
    : undefined;
  const maxFiles = params.maxFiles ?? 40;
  const maxTabs = params.maxTabs ?? 20;

  const visibleFiles = uniqueRelPaths(
    vscode.window.visibleTextEditors
      .map((editor) => editor.document?.uri?.fsPath)
      .filter((fsPath): fsPath is string => Boolean(fsPath)),
    root,
    maxFiles,
  );

  const openTabs = uniqueRelPaths(
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .map((tab) => {
        const input = tab.input;
        if (input && typeof input === 'object' && 'uri' in input) {
          const uri = (input as { uri?: vscode.Uri }).uri;
          return uri?.fsPath;
        }
        return undefined;
      })
      .filter((fsPath): fsPath is string => Boolean(fsPath)),
    root,
    maxTabs,
  );

  const terminalSummaries = vscode.window.terminals
    .slice(0, 8)
    .map((terminal, index) => {
      const name = terminal.name?.trim() || `terminal-${index + 1}`;
      return name;
    });

  return {
    todayDate: new Date().toLocaleDateString("en-CA"),
    ...(visibleFiles.length > 0 ? { visibleFiles } : {}),
    ...(openTabs.length > 0 ? { openTabs } : {}),
    ...(terminalSummaries.length > 0 ? { terminalSummaries } : {}),
    ...(params.modeReminder ? { modeReminder: params.modeReminder } : {}),
  };
}

function uniqueRelPaths(
  absolutePaths: readonly string[],
  workspaceRoot: string | undefined,
  max: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const absolute of absolutePaths) {
    const rel = toWorkspaceRelative(absolute, workspaceRoot);
    if (!rel || seen.has(rel)) {
      continue;
    }
    seen.add(rel);
    out.push(rel);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

function toWorkspaceRelative(
  absolutePath: string,
  workspaceRoot: string | undefined,
): string | undefined {
  const normalized = absolutePath.replace(/\\/g, '/');
  if (!workspaceRoot) {
    return path.basename(normalized);
  }
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === root) {
    return '.';
  }
  if (normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1);
  }
  return undefined;
}

/**
 * Active editor + dirty docs for prepareStartInput.runtimeSituation.
 */
export function collectVsCodeEditorSituation(params: {
  workspaceRoot?: string;
}): {
  focusedFile?: string;
  dirtyPaths: string[];
  selection?: { path: string; startLine?: number; endLine?: number };
  diagnostics: string[];
} {
  const root = params.workspaceRoot
    ? path.resolve(params.workspaceRoot)
    : undefined;
  const editor = vscode.window.activeTextEditor;
  const focusedAbs = editor?.document?.uri?.fsPath;
  const focusedFile = focusedAbs
    ? toWorkspaceRelative(focusedAbs, root)
    : undefined;

  let selection:
    | { path: string; startLine?: number; endLine?: number }
    | undefined;
  if (focusedFile && editor && !editor.selection.isEmpty) {
    selection = {
      path: focusedFile,
      startLine: editor.selection.start.line + 1,
      endLine: editor.selection.end.line + 1,
    };
  }

  const dirtyPaths = uniqueRelPaths(
    vscode.workspace.textDocuments
      .filter((doc) => doc.isDirty && doc.uri.scheme === 'file')
      .map((doc) => doc.uri.fsPath),
    root,
    64,
  );

  const diagnostics: string[] = [];
  if (editor?.document) {
    for (const d of vscode.languages
      .getDiagnostics(editor.document.uri)
      .slice(0, 12)) {
      const line = d.range.start.line + 1;
      diagnostics.push(`L${line}: ${d.message}`);
    }
  }

  return {
    ...(focusedFile ? { focusedFile } : {}),
    dirtyPaths,
    ...(selection ? { selection } : {}),
    diagnostics,
  };
}
