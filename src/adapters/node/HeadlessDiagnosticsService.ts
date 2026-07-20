import type { ContextItem, ContextQuery, ContextSource } from '../../features/ce/context/types';
import { readBuildErrorsForFile } from '../../kernel/telemetry/buildDiagnostics';

/**
 * Headless diagnostics — no VS Code language service in CLI/benchmark runs, so post-edit
 * errors come from `.mitii/diagnostics/current-build-errors.json` instead (written by
 * `scripts/write-build-diagnostics.sh` via `execute_workspace_script`). Absent that file,
 * this reports no errors rather than fabricating any.
 */
export class HeadlessDiagnosticsService {
  private workspaceRoot = '';

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  getDiagnostics(): Array<{ file: string; severity: string; message: string; line: number }> {
    return [];
  }

  formatCompact(_maxItems = 20): string {
    return '';
  }

  getHeavyFiles(): string[] {
    return [];
  }

  getFileErrors(relPath: string): Array<{ line: number; message: string }> {
    if (!this.workspaceRoot) return [];
    return readBuildErrorsForFile(this.workspaceRoot, relPath).map((entry) => ({
      line: entry.line,
      message: entry.message,
    }));
  }

  async waitForFileErrors(relPath: string, _maxWaitMs = 2500): Promise<Array<{ line: number; message: string }>> {
    return this.getFileErrors(relPath);
  }
}

export class HeadlessDiagnosticsContextSource implements ContextSource {
  readonly id = 'diagnostics';

  constructor(private readonly diagnosticsService: HeadlessDiagnosticsService) {}

  async retrieve(_query: ContextQuery): Promise<ContextItem[]> {
    const formatted = this.diagnosticsService.formatCompact();
    if (!formatted) return [];
    return [{
      id: 'diagnostics',
      source: this.id,
      content: formatted,
      score: 5,
      reason: 'Headless diagnostics (empty in CLI runtime)',
      tokenEstimate: Math.ceil(formatted.length / 4),
    }];
  }
}
