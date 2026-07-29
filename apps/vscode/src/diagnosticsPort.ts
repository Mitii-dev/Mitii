import { relative } from 'node:path';
import type { DiagnosticItem, DiagnosticsPort } from '@mitii/sdk';
import type * as vscode from 'vscode';

/**
 * VS Code Problems-panel diagnostics for Tool Runtime / Verification.
 */
export class VscodeDiagnosticsPort implements DiagnosticsPort {
  constructor(
    private readonly vs: typeof vscode,
    private readonly workspaceRoot: string,
  ) {}

  public async readDiagnostics(params: {
    workspaceRoot: string;
    paths?: readonly string[];
  }): Promise<DiagnosticItem[]> {
    const root = params.workspaceRoot || this.workspaceRoot;
    const items: DiagnosticItem[] = [];

    for (const [uri, diags] of this.vs.languages.getDiagnostics()) {
      if (uri.scheme !== 'file') continue;
      const rel = toWorkspaceRelative(root, uri.fsPath);
      if (!rel) continue;
      if (
        params.paths &&
        params.paths.length > 0 &&
        !params.paths.some((p) => rel === p || rel.startsWith(`${p}/`))
      ) {
        continue;
      }

      for (const d of diags) {
        items.push({
          path: rel,
          severity: mapSeverity(this.vs, d.severity),
          message: d.message,
          startLine: d.range.start.line + 1,
          startColumn: d.range.start.character + 1,
          endLine: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
          source: d.source,
          code:
            typeof d.code === 'string' || typeof d.code === 'number'
              ? String(d.code)
              : d.code && typeof d.code === 'object' && 'value' in d.code
                ? String(d.code.value)
                : undefined,
        });
      }
    }

    return items;
  }
}

function toWorkspaceRelative(
  workspaceRoot: string,
  absolutePath: string,
): string | undefined {
  const rel = relative(workspaceRoot, absolutePath);
  if (!rel || rel.startsWith('..')) return undefined;
  return rel.replace(/\\/g, '/');
}

function mapSeverity(
  vs: typeof vscode,
  severity: vscode.DiagnosticSeverity,
): DiagnosticItem['severity'] {
  switch (severity) {
    case vs.DiagnosticSeverity.Error:
      return 'error';
    case vs.DiagnosticSeverity.Warning:
      return 'warning';
    case vs.DiagnosticSeverity.Information:
      return 'info';
    case vs.DiagnosticSeverity.Hint:
      return 'hint';
    default:
      return 'info';
  }
}
