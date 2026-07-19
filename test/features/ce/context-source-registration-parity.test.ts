import { describe, expect, it } from 'vitest';
import { buildRuntime } from '../../../src/kernel/bootstrap';
import { ceFeatures } from '../../../src/composition/ce/featureManifest';

/**
 * Locks in exactly which context-source ids the CE (+ vscode-host) `FeatureModule`s register
 * through `buildRuntime()`, cross-checked by hand against `ThunderController.buildRetriever()`
 * (the ground truth for what a real running session actually registers today).
 *
 * `buildRetriever()` gates several sources behind `contextToggles` (fts, repoMap, gitDiff,
 * diagnostics, memory, vectors, callGraph) and optional service availability
 * (projectRulesService, skillCatalogService, gitService, vectorIndexService, autoMemoryWriter,
 * languageService). This registration-only pass does not model those runtime toggles/guards —
 * it registers every source unconditionally, matching what `initMinimalChat()`'s superset would
 * look like with every dependency present. `diagnostics` defaults to *off* in
 * `defaultContextToggles()` but is still registered here since toggle gating happens at
 * retrieval time, not registration time, in the new design.
 *
 * Uses `ceFeatures` from `composition/ce/featureManifest` (not the bare `ceFeatureModules`)
 * because the four vscode-specific sources (`current-editor`, `open-files`, `mentioned-files`,
 * `git-diff`, `diagnostics`) are only reachable through the `vscodeHostFeature` bridge that lives
 * in the composition layer — `features/ce/**` cannot import `adapters/**` directly.
 */
describe('CE context-source factory registration parity with ThunderController', () => {
  const runtime = buildRuntime({
    features: ceFeatures,
    hostPorts: { workspace: { workspaceRoot: '/tmp/workspace', readText: async () => '', writeText: async () => {} } },
  });
  const ids = runtime.registries.contextSources.list().map((f) => f.id).sort();

  it('registers no duplicate ids', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('matches the exact set of context sources ThunderController.buildRetriever() constructs today', () => {
    const expected = [
      // CE, features/ce/context/factories/ceContextSources.ts
      'project-rules', 'skill-catalog', 'project-catalog', 'workspace-overview',
      'fts', 'indexed-file-search', 'repo-map', 'memory', 'auto-memory', 'vector', 'call-graph',
      // vscode host, adapters/vscode/context/factories/vscodeContextSources.ts
      'current-editor', 'open-files', 'mentioned-files', 'git-diff', 'diagnostics',
    ].sort();

    expect(ids).toEqual(expected);
  });
});
