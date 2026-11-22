import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ensureScipArtifacts } from './ensureScipArtifacts.js';

describe('ensureScipArtifacts', () => {
  it('loads occurrences from .mitii/scip/index.jsonl when present', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-scip-'));
    const scipDir = join(root, '.mitii', 'scip');
    mkdirSync(scipDir, { recursive: true });
    writeFileSync(
      join(scipDir, 'index.jsonl'),
      `${JSON.stringify({
        relative_path: 'src/a.ts',
        start_line: 3,
        symbol_name: 'run',
        symbol: 'scip-typescript npm . a.ts run().',
      })}\n`,
      'utf8',
    );

    const result = await ensureScipArtifacts(root);
    expect(result.source).toBe('jsonl');
    expect(result.occurrences).toEqual([
      {
        relativePath: 'src/a.ts',
        line: 3,
        symbolName: 'run',
        scipSymbol: 'scip-typescript npm . a.ts run().',
      },
    ]);
  });

  it('returns none when workspace has no TS/JS project and no artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-scip-empty-'));
    const result = await ensureScipArtifacts(root);
    expect(result).toEqual({ occurrences: [], source: 'none' });
  });
});
