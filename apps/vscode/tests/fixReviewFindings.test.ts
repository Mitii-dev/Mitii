import { describe, expect, it } from 'vitest';

import {
  FIX_REVIEW_FINDINGS_SKILL_ID,
  buildFixReviewFindingsAsk,
} from '@mitii/host';

/**
 * Host ↔ VS Code contract for Fix / Fix all after review.
 * Keeps mutation out of the V8 review module (ADR-review-module).
 */
describe('fix review findings host recipe (vscode contract)', () => {
  it('pins finding paths and forces the fix skill in agent mode', () => {
    const ask = buildFixReviewFindingsAsk({
      findings: [
        {
          path: 'apps/vscode/src/sidebar.ts',
          content: 'Missing cancel for sticky findings',
          severity: 'medium',
          startLine: 100,
          existingCode: 'setReviewFindings(msg.findings)',
        },
      ],
      single: true,
    });

    expect(ask.mode).toBe('agent');
    expect(ask.requiredSkillIds).toEqual([FIX_REVIEW_FINDINGS_SKILL_ID]);
    expect(ask.pinnedPaths).toEqual(['apps/vscode/src/sidebar.ts']);
    expect(ask.prompt).toMatch(/Fix this Mitii review finding/);
    expect(ask.prompt).toContain('do not re-review or call emit_review_finding');
    expect(ask.prompt).toContain('Missing cancel for sticky findings');
  });

  it('selects a subset by caller indices before compile', () => {
    const stored = [
      { path: 'a.ts', content: 'A', severity: 'low' },
      { path: 'b.ts', content: 'B', severity: 'high' },
      { path: 'c.ts', content: 'C', severity: 'medium' },
    ];
    const indices = [1, 2];
    const selected = indices.map((i) => stored[i]!).filter(Boolean);
    const ask = buildFixReviewFindingsAsk({ findings: selected });

    expect(ask.pinnedPaths).toEqual(['b.ts', 'c.ts']);
    expect(ask.prompt).toContain('Fix all 2 Mitii review findings');
    expect(ask.prompt).toContain('B');
    expect(ask.prompt).toContain('C');
    expect(ask.prompt).not.toContain('\n- Issue: A\n');
  });
});
