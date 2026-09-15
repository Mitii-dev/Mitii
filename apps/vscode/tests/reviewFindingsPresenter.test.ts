import { describe, expect, it } from 'vitest';

import {
  parseFindingFromOutputPreview,
  parseFindingFromSummary,
} from '../src/review/reviewFindingsPresenter.ts';

describe('parseFindingFromSummary', () => {
  it('parses compact finding summaries', () => {
    const finding = parseFindingFromSummary(
      'finding path=src/a.ts line=12 sev=high cat=bug :: Missing null check',
    );
    expect(finding).toMatchObject({
      path: 'src/a.ts',
      startLine: 12,
      endLine: 12,
      severity: 'high',
      category: 'bug',
      content: 'Missing null check',
    });
  });
});

describe('parseFindingFromOutputPreview', () => {
  it('parses nested finding JSON', () => {
    const finding = parseFindingFromOutputPreview(
      JSON.stringify({
        accepted: true,
        finding: {
          path: 'lib/x.ts',
          content: 'Race on shared state',
          existingCode: 'let x = 1',
          startLine: 40,
          endLine: 42,
          severity: 'critical',
          category: 'bug',
          anchored: true,
        },
        warnings: [],
      }),
    );
    expect(finding).toMatchObject({
      path: 'lib/x.ts',
      content: 'Race on shared state',
      startLine: 40,
      severity: 'critical',
      category: 'bug',
    });
  });
});
