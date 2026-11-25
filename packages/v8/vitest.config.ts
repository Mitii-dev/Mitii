import { defineConfig } from 'vitest/config';

/**
 * Vitest owns suites that import from `vitest`.
 * Specs using Node's built-in test runner are not collected here; run those
 * separately with `node --test` when needed.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/engine/**/*.spec.ts',
      'src/modules/decision-policy/**/*.spec.ts',
      'src/modules/request-intake/tests/**/*.spec.ts',
      'src/modules/request-understanding/tests/**/*.spec.ts',
      'src/modules/memory/**/*.spec.ts',
      'src/modules/planning/**/*.spec.ts',
      'src/modules/task-list/**/*.spec.ts',
      'src/modules/code-navigation/**/*.spec.ts',
      'src/modules/change-impact/**/*.spec.ts',
      'src/modules/review/**/*.spec.ts',
      'src/modules/repository-context/helpers/hybrid-retrieval/IdentifierAwareRetrievalReranker.spec.ts',
      'src/modules/repository-context/helpers/hybrid-retrieval/boostByImportance.spec.ts',
      'src/modules/repository-context/helpers/hybrid-retrieval/tests/**/*.spec.ts',
      'src/modules/prompt-construction/**/*.spec.ts',
      'src/modules/repository-context/tests/**/*.spec.ts',
      'src/modules/window-budget/**/*.spec.ts',
      'src/modules/skills/**/*.spec.ts',
      'src/modules/mcp-attach/**/*.spec.ts',
      'src/modules/verification/**/*.spec.ts',
      'src/modules/repository-state/helpers/repo-map/**/*.spec.ts',
      'src/modules/repository-state/helpers/source-analysis/**/*.spec.ts',
      'src/modules/repository-state/helpers/catalog/**/*.spec.ts',
      'src/modules/repository-state/adapters/**/*.spec.ts',
      'src/modules/repository-state/helpers/*.spec.ts',
      'src/modules/repository-state/helpers/workspace/tests/**/*.spec.ts',
      'src/modules/repository-state/helpers/code-index/**/*.spec.ts',
      'src/modules/repository-state/helpers/chunking/tests/CodeCollapse.spec.ts',
      'src/modules/repository-state/helpers/text-index/tests/TrigramFts.spec.ts',
      'src/modules/repository-state/helpers/embedding/tests/EmbeddingVectorCache.spec.ts',
      'src/modules/repository-state/helpers/embedding/tests/SqliteEmbeddingVectorCache.spec.ts',
      'src/modules/repository-state/flow/ws-indexing-pipeline/tests/FileProcessorStatFreshness.spec.ts',
      'src/modules/model-gateway/tests/**/*.spec.ts',
    ],
  },
});
