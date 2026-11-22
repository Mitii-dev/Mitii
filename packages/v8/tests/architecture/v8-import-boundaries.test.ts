import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import {
  diffAgainstBaseline,
  engineRoot,
  isTestFile,
  listCrossUnitImports,
  listRuntimeTypeScriptFiles,
  modulesRoot,
  owningPublicUnit,
  readBaseline,
  readImportRefs,
  scanImports,
  toRepoPath,
  v8SrcRoot,
  WRITE_BASELINES,
  writeBaseline,
} from './support/v8Sources';

const FORBIDDEN_V8_IMPORT_PATTERNS = [
  /\bfrom\s+['"]vscode['"]/,
  /\bfrom\s+['"].*webview(?:-ui)?(?:\/|['"])/,
  /\bfrom\s+['"]@mitii\/sdk['"]/,
  /\bfrom\s+['"].*(?:^|\/)(?:apps\/|packages\/sdk)(?:\/|['"])/,
  // Absolute / package-style paths only. Module-local `./adapters` and
  // `../adapters` folders are intentional Mitii layout — do not flag them.
  /\bfrom\s+['"](?!\.\.?\/)(?:.*\/)?(?:kernel|interfaces|features|composition)(?:\/|['"])/,
  /\bfrom\s+['"](?:\.\.\/)+(?:kernel|interfaces|features|composition)(?:\/|['"])/,
] as const;

const DEEP_IMPORT_BASELINE = 'deep-import-baseline.json';

/**
 * Cross-module deep imports (importing anything other than the owner's
 * `index.ts`) are banned. The baseline below is a shrinking allowlist for
 * test-only code that still reaches into another module's internals; it may
 * only lose entries. Production (non-test) files can never be baselined.
 */
function deepImportViolations(): string[] {
  return listCrossUnitImports()
    .filter((ref) => ref.targetRel !== '')
    .map((ref) => `${toRepoPath(ref.file)} -> ${ref.specifier}`);
}

describe('v8 import boundaries', () => {
  it('does not import features/ce, legacy host, sdk, apps, or vscode from v8', () => {
    expect([
      ...scanImports(modulesRoot, FORBIDDEN_V8_IMPORT_PATTERNS),
      ...scanImports(engineRoot, FORBIDDEN_V8_IMPORT_PATTERNS),
    ]).toEqual([]);
  });

  it('forbids V8 from importing apps packages', () => {
    expect(
      scanImports(v8SrcRoot, [
        /\bfrom\s+['"]@mitii\/(?:cli|vscode|daemon)['"]/,
        /\bfrom\s+['"].*(?:^|\/)apps\/(?:cli|vscode|daemon)/,
      ]),
    ).toEqual([]);
  });

  it('blocks imports of deleted agent-engine paths from other modules', () => {
    const violations: string[] = [];
    for (const file of listRuntimeTypeScriptFiles()) {
      if (owningPublicUnit(file) === 'v8-engine') continue;
      for (const ref of readImportRefs(file)) {
        if (/agent-engine/.test(ref.specifier)) {
          violations.push(`${toRepoPath(file)}:${ref.line}: ${ref.text}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('blocks cross-module internal/ and actions/ imports with no exemptions', () => {
    // Includes model-gateway: no module is exempt from owner-index-only imports.
    const violations = listCrossUnitImports()
      .filter((ref) => /^(?:internal|actions)(?:\/|$)/.test(ref.targetRel))
      .map((ref) => `${toRepoPath(ref.file)}:${ref.line}: ${ref.text}`)
      .filter((entry) => !deepAllowlisted(entry.split(':')[0]!));
    expect(violations).toEqual([]);
  });

  it('only imports other modules through the owner index.ts', () => {
    const current = deepImportViolations();
    if (WRITE_BASELINES) writeBaseline(DEEP_IMPORT_BASELINE, current);
    const baseline = readBaseline<string[]>(DEEP_IMPORT_BASELINE, []);
    const { added, stale } = diffAgainstBaseline(current, baseline);
    expect(
      added,
      'new deep cross-module imports; import the owner public index.ts instead',
    ).toEqual([]);
    expect(
      stale,
      `fixed deep imports still listed; rerun with MITII_ARCH_WRITE_BASELINES=1 to shrink ${DEEP_IMPORT_BASELINE}`,
    ).toEqual([]);
  });

  it('never baselines production files for deep imports', () => {
    const baseline = readBaseline<string[]>(DEEP_IMPORT_BASELINE, []);
    const production = baseline.filter(
      (entry) => !isTestFile(entry.split(' -> ')[0]!),
    );
    expect(production).toEqual([]);
  });

  it('keeps the shared runtime tree free of vscode imports', () => {
    for (const file of listRuntimeTypeScriptFiles()) {
      expect(readFileSync(file, 'utf8'), toRepoPath(file)).not.toMatch(
        /\bfrom\s+['"]vscode['"]/,
      );
    }
  });
});

function deepAllowlisted(repoPath: string): boolean {
  return readBaseline<string[]>(DEEP_IMPORT_BASELINE, []).some((entry) =>
    entry.startsWith(`${repoPath} -> `),
  );
}
