import { describe, expect, it } from "vitest";

import {
  InMemorySkillsCatalog,
  SkillsPipeline,
  SKILLS_SCHEMA_VERSION,
} from "..";
import type { SkillDescriptor } from "..";

const baseCatalog: SkillDescriptor[] = [
  {
    id: "bugfix-localize",
    title: "Localize bug fixes",
    content: "Prefer the smallest change that fixes the reported failure.",
    intents: ["bugfix"],
    routes: ["execute", "diagnose"],
    tags: ["null", "fix"],
    paths: [],
    priority: 120,
    alwaysApply: false,
  },
  {
    id: "safety-always",
    title: "Safety",
    content: "Never invent permissions beyond the granted tools.",
    intents: [],
    routes: [],
    tags: [],
    paths: [],
    priority: 200,
    alwaysApply: true,
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

describe("SkillsPipeline preferred / required / excluded", () => {
  it("loads preferred skills when present without failing when missing", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog([
        ...baseCatalog,
        {
          id: "medium-planning",
          title: "Medium planning",
          content: "Bounded discover then concrete Change steps.",
          intents: ["feature"],
          routes: ["plan", "execute"],
          tags: ["planning"],
          paths: [],
          priority: 200,
          conflictGroup: "planning",
          alwaysApply: false,
        },
        {
          id: "planning-default",
          title: "Planning default",
          content: "Generic planning.",
          intents: ["feature"],
          routes: ["plan", "execute"],
          tags: ["planning"],
          paths: [],
          priority: 180,
          conflictGroup: "planning",
          alwaysApply: false,
        },
      ]),
    });

    const preferred = await pipeline.select(
      baseInput({
        route: "execute",
        query: "Add retry support to the API client",
        evidence: {
          primaryIntent: "feature",
          secondaryIntents: [],
        },
        preferredSkillIds: ["medium-planning", "missing-skill"],
      }),
    );

    expect(preferred.status).toBe("selected");
    expect(preferred.reasonCodes).toContain("skills_preferred");
    expect(preferred.instructions.map((block) => block.id)).toContain(
      "medium-planning",
    );
    expect(
      preferred.instructions.find((block) => block.id === "medium-planning")
        ?.provenance.selection,
    ).toBe("preferred");
    expect(preferred.instructions.map((block) => block.id)).not.toContain(
      "planning-default",
    );
  });

  it("loads required skills even when relevance matching would skip them", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog([
        ...baseCatalog,
        {
          id: "module-doc-generator",
          title: "Module Doc Generator",
          content: "Follow the module documentation playbook.",
          intents: [],
          routes: [],
          tags: [],
          paths: [],
          priority: 220,
          alwaysApply: false,
        },
      ]),
    });

    const result = await pipeline.select(
      baseInput({
        route: "execute",
        query: "Generate docs for test/Tablet",
        evidence: {
          primaryIntent: "docs",
          secondaryIntents: [],
        },
        requiredSkillIds: ["module-doc-generator"],
      }),
    );

    expect(result.status).toBe("selected");
    expect(result.required).toEqual(["module-doc-generator"]);
    expect(result.requiredCount).toBe(1);
    expect(result.instructions.map((block) => block.id)).toContain(
      "module-doc-generator",
    );
    expect(
      result.instructions.find((block) => block.id === "module-doc-generator")
        ?.provenance.selection,
    ).toBe("required");
  });

  it("excludes auto-matched skills listed in excludedSkillIds", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog(baseCatalog),
    });

    const included = await pipeline.select(
      baseInput({
        route: "execute",
        query: "Fix the null check",
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
        },
      }),
    );
    expect(included.instructions.map((block) => block.id)).toContain(
      "bugfix-localize",
    );

    const excluded = await pipeline.select(
      baseInput({
        route: "execute",
        query: "Fix the null check",
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
        },
        excludedSkillIds: ["bugfix-localize"],
      }),
    );

    expect(excluded.instructions.map((block) => block.id)).not.toContain(
      "bugfix-localize",
    );
    expect(
      excluded.warnings.some((warning) => warning.includes("Excluded")),
    ).toBe(true);
  });
});
