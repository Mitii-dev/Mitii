import { describe, expect, it } from 'vitest';

import {
  FIX_REVIEW_FINDINGS_RECIPE_ID,
  FIX_REVIEW_FINDINGS_SKILL_ID,
  buildFixReviewFindingsAsk,
} from './fixReviewFindings.js';

describe('buildFixReviewFindingsAsk', () => {
  it('compiles agent ask with skill, pins, and severity order', () => {
    const ask = buildFixReviewFindingsAsk({
      findings: [
        {
          path: 'src/b.ts',
          content: 'Nit style',
          severity: 'low',
          startLine: 3,
        },
        {
          path: 'src/a.ts',
          content: 'Null deref',
          severity: 'high',
          startLine: 10,
          existingCode: 'x.y()',
          suggestionCode: 'x?.y()',
        },
        {
          path: 'src/a.ts',
          content: 'Duplicate path finding',
          severity: 'medium',
          startLine: 20,
        },
      ],
    });

    expect(ask.recipeId).toBe(FIX_REVIEW_FINDINGS_RECIPE_ID);
    expect(ask.mode).toBe('agent');
    expect(ask.requiredSkillIds).toEqual([FIX_REVIEW_FINDINGS_SKILL_ID]);
    expect(ask.pinnedPaths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(ask.label).toBe('Fix all review findings');
    expect(ask.prompt).toContain('Fix all 3 Mitii review findings');
    expect(ask.prompt).toContain('emit_review_finding');
    expect(ask.prompt.indexOf('Null deref')).toBeLessThan(
      ask.prompt.indexOf('Duplicate path finding'),
    );
    expect(ask.prompt.indexOf('Duplicate path finding')).toBeLessThan(
      ask.prompt.indexOf('Nit style'),
    );
    expect(ask.prompt).toContain('src/a.ts:10');
    expect(ask.prompt).toContain('suggestionCode');
    expect(ask.prompt).toContain('x?.y()');
    expect(ask).not.toHaveProperty('allowedTools');
    expect(JSON.stringify(ask)).not.toMatch(/allowedTools|ToolGrant/);
  });

  it('uses single-finding language when requested or only one finding', () => {
    const ask = buildFixReviewFindingsAsk({
      findings: [
        {
          path: './lib/x.ts',
          content: 'Race on shared state',
          severity: 'critical',
          category: 'bug',
          startLine: 40,
          endLine: 42,
        },
      ],
    });

    expect(ask.label).toBe('Fix review finding');
    expect(ask.prompt).toContain('Fix this Mitii review finding');
    expect(ask.prompt).toContain('lib/x.ts:40-42');
    expect(ask.prompt).toContain('category=bug');
    expect(ask.pinnedPaths).toEqual(['lib/x.ts']);
  });

  it('throws when findings are empty or unusable', () => {
    expect(() => buildFixReviewFindingsAsk({ findings: [] })).toThrow(
      /requires at least one finding/,
    );
    expect(() =>
      buildFixReviewFindingsAsk({
        findings: [{ path: '', content: 'x' }, { path: 'a.ts', content: '  ' }],
      }),
    ).toThrow(/requires at least one finding/);
  });

  it('caps finding and code payload size', () => {
    const ask = buildFixReviewFindingsAsk({
      findings: [
        {
          path: 'big.ts',
          content: 'C'.repeat(2_000),
          existingCode: 'E'.repeat(2_000),
          suggestionCode: 'S'.repeat(2_000),
        },
      ],
    });
    expect(ask.prompt.length).toBeLessThan(5_000);
    expect(ask.prompt).toContain('…');
  });
});
