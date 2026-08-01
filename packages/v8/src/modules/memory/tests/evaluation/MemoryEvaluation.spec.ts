import { describe, expect, it } from "vitest";

import { InMemoryMemoryStore, MemoryPipeline } from "../..";
import {
  MEMORY_EVALUATION_CASES,
  MEMORY_EVAL_SEED,
  toRetrieveInput,
} from "../fixtures/memoryEvalCases";

/**
 * Phase 9 memory evaluation gates:
 * - Relevant-memory recall ≥90%
 * - Irrelevant-memory rate <10%
 * - Stale memories accepted = 0
 * - Budget never exceeded
 */
describe("Memory evaluation dataset", () => {
  it("meets recall, irrelevant, stale, and budget targets", async () => {
    const pipeline = new MemoryPipeline({
      store: new InMemoryMemoryStore(MEMORY_EVAL_SEED),
    });

    let expectedRelevant = 0;
    let relevantHits = 0;
    let selectedCount = 0;
    let irrelevantHits = 0;
    let staleAccepted = 0;
    let budgetViolations = 0;

    for (const fixture of MEMORY_EVALUATION_CASES) {
      const result = await pipeline.retrieve(toRetrieveInput(fixture));
      const selectedIds = new Set(result.instructions.map((block) => block.id));

      for (const id of fixture.expectedRelevantIds) {
        expectedRelevant += 1;
        if (selectedIds.has(id)) {
          relevantHits += 1;
        }
      }

      for (const id of selectedIds) {
        selectedCount += 1;
        if (fixture.forbiddenIds.includes(id)) {
          irrelevantHits += 1;
        }
        if (fixture.staleIds?.includes(id)) {
          staleAccepted += 1;
        }
      }

      if (result.usedTokens > result.budgetTokens) {
        budgetViolations += 1;
      }

      for (const forbidden of fixture.forbiddenIds) {
        expect(selectedIds.has(forbidden), `${fixture.id}:${forbidden}`).toBe(
          false,
        );
      }
      for (const staleId of fixture.staleIds ?? []) {
        expect(selectedIds.has(staleId), `${fixture.id}:stale:${staleId}`).toBe(
          false,
        );
      }
    }

    const recall = relevantHits / Math.max(1, expectedRelevant);
    const irrelevantRate =
      selectedCount === 0 ? 0 : irrelevantHits / selectedCount;

    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(irrelevantRate).toBeLessThan(0.1);
    expect(staleAccepted).toBe(0);
    expect(budgetViolations).toBe(0);
  });
});
