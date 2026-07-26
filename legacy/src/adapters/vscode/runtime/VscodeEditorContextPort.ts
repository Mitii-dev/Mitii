import * as vscode from 'vscode';
import type { EditorContextPort } from '../../../interfaces/runtime';
import { toWorkspaceRelPath } from '../util/paths';

/**
 * Reads currently-open/active editor state from the live VS Code window.
 * Returns raw workspace-relative paths; callers decide what to filter (e.g. internal agent paths).
 */
export class VscodeEditorContextPort implements EditorContextPort {
  constructor(private readonly workspace: string) {}

  async getActiveFile(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.workspace) return undefined;
    return toWorkspaceRelPath(editor.document.uri, this.workspace) ?? undefined;
  }

  async getOpenFiles(): Promise<readonly string[]> {
    if (!this.workspace) return [];
    const openFiles: string[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input && typeof input === 'object' && 'uri' in input) {
          const uri = (input as { uri: vscode.Uri }).uri;
          if (uri.scheme === 'file') {
            const rel = toWorkspaceRelPath(uri, this.workspace);
            if (rel) openFiles.push(rel);
          }
        }
      }
    }
    return openFiles;
  }
}
