import { describe, expect, it } from "vitest";

import {
  InMemorySkillsCatalog,
  SkillsError,
  SkillsPipeline,
  SKILLS_SCHEMA_VERSION,
} from "..";
import type { SkillDescriptor } from "..";

const catalog: SkillDescriptor[] = [
  {
    id: "bugfix-localize",
    title: "Localize bug fixes",
    content: "Prefer the smallest change that fixes the reported failure.",
    intents: ["bugfix"],
    routes: ["execute", "diagnose"],
    tags: ["null", "fix"],
    priority: 120,
    alwaysApply: false,
  },
  {
    id: "review-checklist",
    title: "Review checklist",
    content: "Check correctness, tests, and API impact before approving.",
    intents: ["review"],
    routes: ["direct_answer", "repository_answer"],
    tags: ["review"],
    priority: 100,
    alwaysApply: false,
  },
  {
    id: "safety-always",
    title: "Safety",
    content: "Never invent permissions beyond the granted tools.",
    intents: [],
    routes: [],
    tags: [],
    priority: 200,
    alwaysApply: true,
  },
  {
    id: "bugfix-verbose",
    title: "Verbose bugfix",
    content: "Write a long investigation narrative for every bug.",
    intents: ["bugfix"],
    routes: ["execute"],
    tags: [],
    priority: 50,
    conflictGroup: "bugfix-style",
    alwaysApply: false,
  },
  {
    id: "bugfix-concise",
    title: "Concise bugfix",
    content: "Keep bugfix notes short and evidence-based.",
    intents: ["bugfix"],
    routes: ["execute"],
    tags: [],
    priority: 150,
    conflictGroup: "bugfix-style",
    alwaysApply: false,
  },
];

function baseInput(
  overrides: Partial<Parameters<SkillsPipeline["select"]>[0]> = {},
) {
  return {
    schemaVersion: SKILLS_SCHEMA_VERSION,
    query: "Fix the null check in parse.ts",
    mode: "agent" as const,
    route: "execute" as const,
    evidence: {
      primaryIntent: "bugfix",
      secondaryIntents: [] as string[],
    },
    ...overrides,
  };
}

describe("SkillsPipeline", () => {
  it("rejects invalid input", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog(catalog),
    });

    await expect(
      pipeline.select({
        ...baseInput(),
        schemaVersion: 2 as 1,
      }),
    ).rejects.toBeInstanceOf(SkillsError);
  });

  it("selects matching and always-apply skills with provenance", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog(catalog),
    });

    const result = await pipeline.select(baseInput());

    expect(result.status).toBe("selected");
    expect(result.reasonCodes).toContain("skills_selected");
    expect(result.instructions.map((block) => block.id)).toEqual(
      expect.arrayContaining(["safety-always", "bugfix-localize"]),
    );
    expect(result.instructions.every((block) => block.provenance.source === "skills")).toBe(
      true,
    );
  });

  it("resolves conflict groups to the higher-priority skill", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog(catalog),
    });

    const result = await pipeline.select(baseInput());

    expect(result.reasonCodes).toContain("conflicts_resolved");
    const ids = result.instructions.map((block) => block.id);
    expect(ids).toContain("bugfix-concise");
    expect(ids).not.toContain("bugfix-verbose");
  });

  it("omits skills that exceed the dedicated budget", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog(catalog),
    });

    const result = await pipeline.select(
      baseInput({
        budgetTokens: 20,
        maxSkills: 10,
      }),
    );

    expect(result.reasonCodes).toContain("budget_omitted_skills");
    expect(result.omissions.some((item) => item.reason === "budget")).toBe(
      true,
    );
    expect(result.usedTokens).toBeLessThanOrEqual(20);
  });

  it("returns empty when the catalog has no matches", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog([
        {
          id: "docs-only",
          title: "Docs",
          content: "Only for documentation tasks.",
          intents: ["docs"],
          routes: ["direct_answer"],
          tags: [],
          priority: 10,
          alwaysApply: false,
        },
      ]),
    });

    const result = await pipeline.select(
      baseInput({
        route: "execute",
        evidence: { primaryIntent: "bugfix", secondaryIntents: [] },
      }),
    );

    expect(result.status).toBe("empty");
    expect(result.reasonCodes).toContain("no_matching_skills");
    expect(result.instructions).toEqual([]);
  });
});
