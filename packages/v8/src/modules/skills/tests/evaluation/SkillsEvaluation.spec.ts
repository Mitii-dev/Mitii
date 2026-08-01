import { describe, expect, it } from "vitest";

import { InMemorySkillsCatalog, SkillsPipeline } from "../..";
import {
  SKILLS_EVALUATION_CASES,
  SKILLS_EVAL_CATALOG,
  toSelectInput,
} from "../fixtures/skillsEvalCases";

/**
 * Phase 9 skills evaluation gates:
 * - Relevant-skill recall ≥90%
 * - Irrelevant-instruction rate <10%
 * - Budget never exceeded
 */
describe("Skills evaluation dataset", () => {
  it("meets recall, irrelevant-instruction, and budget targets", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog(SKILLS_EVAL_CATALOG),
    });

    let expectedRelevant = 0;
    let relevantHits = 0;
    let selectedOptional = 0;
    let irrelevantHits = 0;
    let budgetViolations = 0;

    for (const fixture of SKILLS_EVALUATION_CASES) {
      const result = await pipeline.select(toSelectInput(fixture));
      const selectedIds = new Set(result.instructions.map((block) => block.id));

      for (const id of fixture.expectedRelevantIds) {
        expectedRelevant += 1;
        if (selectedIds.has(id)) {
          relevantHits += 1;
        }
      }

      for (const id of selectedIds) {
        if (id === "safety-always") {
          continue;
        }
        selectedOptional += 1;
        if (fixture.forbiddenIds.includes(id)) {
          irrelevantHits += 1;
        }
      }

      if (fixture.enforceBudget !== false) {
        if (result.usedTokens > result.budgetTokens) {
          budgetViolations += 1;
        }
      }

      expect(selectedIds.has("safety-always"), fixture.id).toBe(true);
      for (const forbidden of fixture.forbiddenIds) {
        expect(selectedIds.has(forbidden), `${fixture.id}:${forbidden}`).toBe(
          false,
        );
      }
    }

    const recall = relevantHits / Math.max(1, expectedRelevant);
    const irrelevantRate =
      selectedOptional === 0 ? 0 : irrelevantHits / selectedOptional;

    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(irrelevantRate).toBeLessThan(0.1);
    expect(budgetViolations).toBe(0);
  });
});
