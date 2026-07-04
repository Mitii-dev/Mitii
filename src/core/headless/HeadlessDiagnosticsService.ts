import type { ContextItem, ContextQuery, ContextSource } from '../context/types';

/** Headless diagnostics stub — no VS Code language service in CLI/benchmark runs. */
export class HeadlessDiagnosticsService {
  setWorkspaceRoot(_root: string): void {
    // Headless runtime has no editor diagnostics integration.
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

  getFileErrors(_relPath: string): Array<{ line: number; message: string }> {
    return [];
  }

  async waitForFileErrors(_relPath: string, _maxWaitMs = 2500): Promise<Array<{ line: number; message: string }>> {
    return [];
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
