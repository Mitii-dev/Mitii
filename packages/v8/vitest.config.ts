import { defineConfig } from 'vitest/config';

/**
 * Vitest owns suites that import from `vitest`.
 * Legacy `node:test` specs remain on disk and are unchanged; they are not
 * collected here (Phase 10 baseline collection mismatch). Run them later via
 * `node --test` / Phase 14 test layout work — do not redesign them in Phase 11.
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
      'src/modules/repository-context/internal/hybrid-retrieval/IdentifierAwareRetrievalReranker.spec.ts',
      'src/modules/prompt-construction/**/*.spec.ts',
      'src/modules/repository-context/tests/**/*.spec.ts',
      'src/modules/window-budget/**/*.spec.ts',
      'src/modules/skills/**/*.spec.ts',
      'src/modules/verification/**/*.spec.ts',
      'src/modules/repository-state/internal/repo-map/**/*.spec.ts',
      'src/modules/repository-state/internal/source-analysis/**/*.spec.ts',
      'src/modules/repository-state/internal/catalog/**/*.spec.ts',
      'src/modules/repository-state/adapters/**/*.spec.ts',
      'src/modules/repository-state/*.spec.ts',
      'src/modules/model-gateway/tests/OpenAiCompatibleRetry.spec.ts',
      'src/modules/model-gateway/tests/AnthropicLlmPort.spec.ts',
      'src/modules/model-gateway/tests/GeminiLlmPort.spec.ts',
    ],
  },
});
