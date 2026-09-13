import { describe, expect, it } from 'vitest';

import { isMitiiRuntimeDiagnosticPath } from '../src/diagnosticsPort';

describe('isMitiiRuntimeDiagnosticPath', () => {
  it('filters Mitii log and model-io artifacts', () => {
    expect(
      isMitiiRuntimeDiagnosticPath(
        '.mitii/logs/09-12-2026-21-01-thread_x-model-io.jsonl',
      ),
    ).toBe(true);
    expect(isMitiiRuntimeDiagnosticPath('.mitii/plans/foo.md')).toBe(true);
    expect(isMitiiRuntimeDiagnosticPath('test/Desktop/pages/BasePage.ts')).toBe(
      false,
    );
  });
});
