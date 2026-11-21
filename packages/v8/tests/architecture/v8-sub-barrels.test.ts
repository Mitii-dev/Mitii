import { readFileSync } from 'fs';
import { basename } from 'path';
import { describe, expect, it } from 'vitest';

import {
  diffAgainstBaseline,
  listRuntimeTypeScriptFiles,
  PUBLIC_ROOTS,
  readBaseline,
  toRepoPath,
  WRITE_BASELINES,
  writeBaseline,
} from './support/v8Sources';

const EXPORT_STAR_BASELINE = 'export-star-baseline.json';

/**
 * `export *` hides ownership and leaks private symbols. Module root barrels
 * are already clean (see v8-public-surface.test.ts). Sub-barrels may keep the
 * wildcard counts recorded in the baseline; counts may only go down, and new
 * files may not introduce `export *`.
 */
function exportStarCounts(): Record<string, number> {
  const rootIndexes = new Set(
    PUBLIC_ROOTS.map(({ root }) => toRepoPath(`${root}/index.ts`)),
  );
  const counts: Record<string, number> = {};
  for (const file of listRuntimeTypeScriptFiles()) {
    const repoPath = toRepoPath(file);
    if (rootIndexes.has(repoPath)) continue;
    const count = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^\s*export\s+\*(?:\s+as\s+\w+)?\s+from\b/.test(line))
      .length;
    if (count > 0) counts[repoPath] = count;
  }
  return counts;
}

describe('v8 sub-barrels', () => {
  it('does not grow `export *` in module sub-barrels', () => {
    const current = exportStarCounts();
    if (WRITE_BASELINES) writeBaseline(EXPORT_STAR_BASELINE, current);
    const baseline = readBaseline<Record<string, number>>(
      EXPORT_STAR_BASELINE,
      {},
    );

    const grown = Object.entries(current)
      .filter(([file, count]) => count > (baseline[file] ?? 0))
      .map(([file, count]) => `${file}: ${baseline[file] ?? 0} -> ${count}`);
    expect(grown, 'new `export *`; export named symbols instead').toEqual([]);

    const { stale } = diffAgainstBaseline(
      Object.entries(current).map(([file, count]) => `${file}#${count}`),
      Object.entries(baseline).map(([file, count]) => `${file}#${count}`),
    );
    expect(
      stale,
      `wildcards removed; rerun with MITII_ARCH_WRITE_BASELINES=1 to shrink ${EXPORT_STAR_BASELINE}`,
    ).toEqual([]);
  });

  it('only allows `export *` in barrel-style files', () => {
    const offenders = Object.keys(exportStarCounts()).filter((file) => {
      const name = basename(file);
      return name !== 'index.ts' && name !== 'ToolCatalog.ts' && name !== 'types.ts';
    });
    expect(offenders).toEqual([]);
  });
});
