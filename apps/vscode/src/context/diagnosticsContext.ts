import { relative } from 'node:path';
import type * as vscode from 'vscode';

export interface DiagnosticItem {
  file: string;
  severity: string;
  message: string;
  line: number;
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

/** Collect workspace diagnostics (Problems panel data). */
export function collectDiagnostics(
  vs: typeof vscode,
  workspaceRoot: string | undefined,
  maxItems = 20,
): DiagnosticItem[] {
  const results: DiagnosticItem[] = [];
  for (const [uri, diags] of vs.languages.getDiagnostics()) {
    const relPath = toRelPath(workspaceRoot, uri);
    if (!relPath) continue;
    for (const d of diags) {
      results.push({
        file: relPath,
        severity: vs.DiagnosticSeverity[d.severity].toLowerCase(),
        message: d.message,
        line: d.range.start.line + 1,
      });
      if (results.length >= maxItems) return results;
    }
  }
  return results;
}

/** Compact multi-line block for prompt prefix. */
export function formatDiagnosticsPromptBlock(
  vs: typeof vscode,
  workspaceRoot: string | undefined,
  maxItems = 20,
): string {
  const diags = collectDiagnostics(vs, workspaceRoot, maxItems);
  if (!diags.length) return '';
  return `Workspace diagnostics (Problems):\n${diags
    .map((d) => `- ${d.file}:${d.line} [${d.severity}] ${d.message}`)
    .join('\n')}`;
}
