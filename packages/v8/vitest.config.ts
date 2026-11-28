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
      'src/runtime/**/*.spec.ts',
      'tests/architecture/**/*.test.ts',
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
      'src/modules/prompt-construction/**/*.spec.ts',
      'src/modules/repository-context/tests/**/*.spec.ts',
      'src/modules/window-budget/**/*.spec.ts',
      'src/modules/skills/**/*.spec.ts',
      'src/modules/mcp-attach/**/*.spec.ts',
      'src/modules/verification/**/*.spec.ts',
      'src/modules/repository-state/helpers/repo-map/**/*.spec.ts',
      'src/modules/repository-state/tests/adapters/**/*.spec.ts',
      'src/modules/repository-state/tests/helpers/**/*.spec.ts',
      'src/modules/repository-state/tests/unit/workspace/**/*.spec.ts',
      'src/modules/repository-state/tests/unit/chunking/CodeCollapse.spec.ts',
      'src/modules/repository-state/tests/unit/text-index/TrigramFts.spec.ts',
      'src/modules/repository-state/tests/unit/embedding/EmbeddingVectorCache.spec.ts',
      'src/modules/repository-state/tests/unit/embedding/SqliteEmbeddingVectorCache.spec.ts',
      'src/modules/repository-state/tests/unit/ws-indexing-pipeline/FileProcessorStatFreshness.spec.ts',
      'src/modules/model-gateway/tests/**/*.spec.ts',
    ],
    exclude: [
      '**/node_modules/**',
      // node:test suites — run with `node --test`
      'src/modules/repository-context/tests/unit/context-assembly/**',
      'src/modules/repository-context/tests/unit/context-selection/**',
      'src/modules/request-understanding/tests/unit/intent/**',
      'src/modules/request-understanding/tests/unit/task-analyzer/**',
      'src/modules/repository-state/tests/helpers/workspace/utils/ws-ignore-policy/WorkspaceIgnorePolicy.spec.ts',
    ],
  },
});
