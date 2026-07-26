import { AGENT_NAME } from '../../../shared/brand';
import * as vscode from 'vscode';
import { relative, resolve } from 'path';
import { existsSync } from 'fs';
import { normalizeWorkspaceRoot } from '../../../kernel/util/paths';

/**
 * Convert a file URI to a path relative to the Thunder workspace root.
 * Returns null for ".", paths outside the workspace, or non-file URIs.
 */
export function toWorkspaceRelPath(uri: vscode.Uri, workspaceRoot: string): string | null {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  if (!root) return null;
  if (uri.scheme !== 'file') return null;

  const abs = resolve(uri.fsPath);
  const rel = relative(root, abs).replace(/\\/g, '/');

  if (!rel || rel === '.' || rel.startsWith('..')) return null;
  return rel;
}

export function createWorkspacePattern(workspaceRoot: string, pattern: string): vscode.RelativePattern {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  if (!root) {
    throw new Error(`${AGENT_NAME} workspace path is not set. Open a folder or set a path in Settings.`);
  }
  if (!existsSync(root)) {
    throw new Error(`${AGENT_NAME} workspace path does not exist: ${root}`);
  }
  return new vscode.RelativePattern(vscode.Uri.file(root), pattern);
}

export function isWorkspaceInVscodeFolders(workspaceRoot: string): boolean {
  const resolved = normalizeWorkspaceRoot(workspaceRoot);
  if (!resolved) return false;
  return (vscode.workspace.workspaceFolders ?? []).some((f) => {
    const folder = resolve(f.uri.fsPath);
    return resolved === folder || resolved.startsWith(folder + '/');
  });
}

/** VS Code findFiles only works reliably when the root is inside an open workspace folder. */
export function canUseVscodeFindFiles(workspaceRoot: string): boolean {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  if (!root) return false;
  return isWorkspaceInVscodeFolders(root);
}
