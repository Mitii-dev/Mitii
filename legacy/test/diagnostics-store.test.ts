import { describe, it, expect } from 'vitest';

const BUG1_TSC_OUTPUT = `
src/features/document-parser/services/resume-builder-service.ts:20:38 - error TS2307: Cannot find module '../../../../infrastructure/ai/parser-service-config' or its corresponding type declarations.

20 import { ParserServiceOptions } from "../../../../infrastructure/ai/parser-service-config";
                                        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

src/features/document-parser/services/resume-enrichment-service.ts:15:8 - error TS2307: Cannot find module '../../../../infrastructure/ai/base-ai-service' or its corresponding type declarations.

15 } from "../../../../infrastructure/ai/base-ai-service";
          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

src/jd-parser/services/manual-resume-service.ts:134:13 - error TS7006: Parameter 'url' implicitly has an 'any' type.

134       .map((url) => ({ label: this.linkLabel(url), url }));
                ~~~

Found 3 errors in 3 files.
`;

describe('diagnosticFileExtractor', () => {
  it('extracts distinct files and TS error codes from real tsc --pretty output', async () => {
    const { extractDiagnostics, extractDiagnosticFiles } = await import(
      '../src/features/ce/runtime/diagnosticFileExtractor'
    );

    const files = extractDiagnosticFiles(BUG1_TSC_OUTPUT);
    expect(files).toEqual([
      'src/features/document-parser/services/resume-builder-service.ts',
      'src/features/document-parser/services/resume-enrichment-service.ts',
      'src/jd-parser/services/manual-resume-service.ts',
    ]);

    const entries = extractDiagnostics(BUG1_TSC_OUTPUT);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      file: 'src/features/document-parser/services/resume-builder-service.ts',
      line: 20,
      column: 38,
      code: 'TS2307',
    });
    expect(entries[2].code).toBe('TS7006');
  });

  it('extracts from the non-pretty tsc(line,col) format too', async () => {
    const { extractDiagnosticFiles } = await import('../src/features/ce/runtime/diagnosticFileExtractor');
    const output = "src/foo.ts(12,5): error TS2339: Property 'bar' does not exist on type 'Foo'.";
    expect(extractDiagnosticFiles(output)).toEqual(['src/foo.ts']);
  });

  it('returns no files for output with no recognizable diagnostic shape', async () => {
    const { extractDiagnosticFiles } = await import('../src/features/ce/runtime/diagnosticFileExtractor');
    expect(extractDiagnosticFiles('All good, build succeeded.')).toEqual([]);
  });
});

describe('DiagnosticsStore', () => {
  it('persists a timestamped record per session and resolves the latest one', async () => {
    const { mkdtempSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { DiagnosticsStore } = await import('../src/features/ce/runtime/DiagnosticsStore');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-diagnostics-'));
    try {
      const store = new DiagnosticsStore(dir, 'session-abc');

      const first = store.record({ command: 'npx tsc --noEmit', output: BUG1_TSC_OUTPUT });
      expect(first?.files).toHaveLength(3);
      expect(first?.sessionId).toBe('session-abc');
      expect(typeof first?.recordedAt).toBe('number');

      // A command with no parseable diagnostics must not overwrite the last real record.
      const noop = store.record({ command: 'npx tsc --noEmit', output: 'build succeeded' });
      expect(noop).toBeNull();
      expect(store.latest()?.files).toHaveLength(3);

      // A newer failing run supersedes the old one — "latest" must reflect the most recent
      // timestamp, not whichever file happens to sort first.
      const secondOutput = "src/only-remaining.ts(1,1): error TS2304: Cannot find name 'x'.";
      const second = store.record({ command: 'npx tsc --noEmit', output: secondOutput });
      expect(second?.files).toEqual(['src/only-remaining.ts']);

      const latest = store.latest();
      expect(latest?.files).toEqual(['src/only-remaining.ts']);
      expect(latest?.recordedAt).toBe(second?.recordedAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps sessions isolated and finds the newest record across sessions', async () => {
    const { mkdtempSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { DiagnosticsStore } = await import('../src/features/ce/runtime/DiagnosticsStore');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-diagnostics-multi-'));
    try {
      const older = new DiagnosticsStore(dir, 'session-older');
      const olderRecord = older.record({
        command: 'npx tsc --noEmit',
        output: "src/old.ts(1,1): error TS2304: Cannot find name 'a'.",
      });

      // Force a distinct, later timestamp so ordering is unambiguous regardless of clock resolution.
      await new Promise((resolve) => setTimeout(resolve, 5));

      const newer = new DiagnosticsStore(dir, 'session-newer');
      const newerRecord = newer.record({
        command: 'npx tsc --noEmit',
        output: "src/new.ts(1,1): error TS2304: Cannot find name 'b'.",
      });

      expect(older.latest()?.files).toEqual(['src/old.ts']);
      expect(newer.latest()?.files).toEqual(['src/new.ts']);
      expect(olderRecord!.recordedAt).toBeLessThanOrEqual(newerRecord!.recordedAt);

      const latestAcross = DiagnosticsStore.latestAcrossSessions(dir);
      expect(latestAcross?.files).toEqual(['src/new.ts']);
      expect(latestAcross?.sessionId).toBe('session-newer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null latest() when no diagnostics have been recorded yet', async () => {
    const { mkdtempSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const { DiagnosticsStore } = await import('../src/features/ce/runtime/DiagnosticsStore');

    const dir = mkdtempSync(join(tmpdir(), 'thunder-diagnostics-empty-'));
    try {
      const store = new DiagnosticsStore(dir, 'session-empty');
      expect(store.latest()).toBeNull();
      expect(DiagnosticsStore.latestAcrossSessions(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('isStaleDiagnosticLogPath — DiagnosticsStore exemption', () => {
  it('does not flag paths under .mitii/diagnostics/ as stale, but still flags ad hoc dumps', async () => {
    const { isStaleDiagnosticLogPath } = await import('../src/features/ce/pipeline/classify/artifactClassifier');

    expect(isStaleDiagnosticLogPath('.mitii/diagnostics/session-abc/latest.json')).toBe(false);
    expect(isStaleDiagnosticLogPath('.mitii/diagnostics/session-abc/1700000000000-ab12cd.json')).toBe(false);

    // Still stale: legacy checkpoint file and ad hoc log dumps outside the managed store.
    expect(isStaleDiagnosticLogPath('.mitii-state.json')).toBe(true);
    expect(isStaleDiagnosticLogPath('build-error.log')).toBe(true);
    expect(isStaleDiagnosticLogPath('scripts/typecheck-errors.log')).toBe(true);
  });
});
