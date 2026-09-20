import { relative } from 'node:path';
import type {
  DiagnosticItem,
  DiagnosticsPort,
  DiagnosticsSettleOptions,
} from '@mitii/sdk';
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

  /**
   * Wait until Problems-panel diagnostics for the given paths are stable
   * or the timeout elapses. Uses onDidChangeDiagnostics when available.
   */
  public async settleDiagnostics(
    options: DiagnosticsSettleOptions,
  ): Promise<void> {
    const timeoutMs = Math.max(0, options.timeoutMs ?? 2_000);
    if (timeoutMs === 0) {
      return;
    }

    const root = options.workspaceRoot || this.workspaceRoot;
    const paths = options.paths ?? [];

    const matchesScope = (uri: vscode.Uri): boolean => {
      if (uri.scheme !== 'file') return false;
      if (paths.length === 0) return true;
      const rel = toWorkspaceRelative(root, uri.fsPath);
      if (!rel) return false;
      return paths.some((p) => rel === p || rel.startsWith(`${p}/`));
    };

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        subscription.dispose();
        options.signal?.removeEventListener('abort', onAbort);
        resolve();
      };

      const onAbort = () => finish();
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const subscription = this.vs.languages.onDidChangeDiagnostics((event) => {
        if (paths.length === 0 || event.uris.some(matchesScope)) {
          // Debounce: wait one more microtask wave for analyzers to flush.
          setTimeout(finish, options.pollIntervalMs ?? 50);
        }
      });

      const timer = setTimeout(finish, timeoutMs);
    });
  }
}

/** Mitii runtime artifacts — never surface as agent “problems”. */
export function isMitiiRuntimeDiagnosticPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return (
    normalized === '.mitii' ||
    normalized.startsWith('.mitii/') ||
    normalized.endsWith('-model-io.jsonl') ||
    /(^|\/)\.mitii\/logs\//.test(normalized)
  );
}

function toWorkspaceRelative(
  workspaceRoot: string,
  absolutePath: string,
): string | undefined {
  const rel = relative(workspaceRoot, absolutePath);
  if (!rel || rel.startsWith('..')) return undefined;
  const normalized = rel.replace(/\\/g, '/');
  if (isMitiiRuntimeDiagnosticPath(normalized)) {
    return undefined;
  }
  return normalized;
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
