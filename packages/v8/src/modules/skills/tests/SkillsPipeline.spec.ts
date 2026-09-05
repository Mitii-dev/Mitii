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
    paths: [],
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
    paths: [],
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
    paths: [],
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
    paths: [],
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
    paths: [],
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

  it("matches on L1 metadata and hydrates only selected L2 bodies", async () => {
    const loadBodyCalls: string[] = [];
    const pipeline = new SkillsPipeline({
      catalog: {
        list: () => [
          {
            id: "parse-ts-null-debugging",
            title: "Parse TS null debugging",
            description: "Fix empty-input null crashes in TypeScript parsers.",
            intents: ["bugfix"],
            routes: ["execute"],
            tags: ["null", "parse"],
            paths: ["**/parse.ts"],
            priority: 160,
            alwaysApply: false,
            resources: {
              references: ["references/checklist.md"],
              scripts: ["scripts/repro.ts"],
            },
          },
          {
            id: "docs-style",
            title: "Docs style",
            description: "Write concise documentation.",
            intents: ["docs"],
            routes: ["execute"],
            tags: ["docs"],
            paths: [],
            priority: 100,
            alwaysApply: false,
          },
        ],
        loadBody: (id: string) => {
          loadBodyCalls.push(id);
          if (id !== "parse-ts-null-debugging") {
            return undefined;
          }
          return {
            content:
              "Full playbook: reproduce empty input, add the smallest guard, then test parse.ts.",
            resources: {
              references: ["references/checklist.md"],
              scripts: ["scripts/repro.ts"],
            },
          };
        },
      },
    });

    const result = await pipeline.select(
      baseInput({
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          paths: ["src/compiler/parse.ts"],
        },
      }),
    );

    expect(result.status).toBe("selected");
    expect(loadBodyCalls).toEqual(["parse-ts-null-debugging"]);
    expect(result.instructions.map((block) => block.id)).toEqual([
      "parse-ts-null-debugging",
    ]);
    expect(result.instructions[0]?.content).toContain("Full playbook");
    expect(result.instructions[0]?.resources?.references).toEqual([
      "references/checklist.md",
    ]);
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

  it("injects compact metadata when the hydrated playbook exceeds the budget", async () => {
    const pipeline = new SkillsPipeline({
      catalog: {
        list: () => [
          {
            id: "debugging-and-error-recovery",
            title: "Debugging",
            content:
              "Skill: Debugging\nInstruction: Reproduce, localize, then fix the root cause.",
            intents: ["bugfix"],
            routes: ["execute"],
            tags: ["debug"],
            paths: [],
            priority: 175,
            alwaysApply: false,
          },
        ],
        loadBody: () => ({
          content: "FULL PLAYBOOK\n".repeat(400),
        }),
      },
    });

    const result = await pipeline.select(
      baseInput({
        budgetTokens: 80,
        maxSkills: 2,
      }),
    );

    expect(result.status).toBe("selected");
    expect(result.reasonCodes).toContain("skills_compacted");
    expect(result.instructions[0]?.id).toBe("debugging-and-error-recovery");
    expect(result.instructions[0]?.content).toContain("Reproduce, localize");
    expect(result.instructions[0]?.content).not.toContain("FULL PLAYBOOK");
    expect(result.usedTokens).toBeLessThanOrEqual(80);
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

  it("soft-boosts already-applicable skills with recommendedSkillTags", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog([
        {
          id: "bugfix-localize",
          title: "Localize",
          content: "Prefer the smallest change that fixes the failure.",
          intents: ["bugfix"],
          routes: ["execute"],
          tags: ["localize"],
          paths: [],
          priority: 10,
          alwaysApply: false,
        },
        {
          id: "bugfix-generic",
          title: "Generic bugfix",
          content: "General bugfix guidance.",
          intents: ["bugfix"],
          routes: ["execute"],
          tags: ["general"],
          paths: [],
          priority: 200,
          alwaysApply: false,
        },
      ]),
    });

    const result = await pipeline.select(
      baseInput({
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          recommendedSkillTags: ["localize"],
        },
      }),
    );

    expect(result.status).toBe("selected");
    expect(result.instructions[0]?.id).toBe("bugfix-localize");
  });

  it("does not select skills from recommendedSkillTags alone", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog([
        {
          id: "docs-localize",
          title: "Docs localize",
          content: "Only for documentation tasks.",
          intents: ["docs"],
          routes: ["direct_answer"],
          tags: ["localize"],
          paths: [],
          priority: 200,
          alwaysApply: false,
        },
      ]),
    });

    const result = await pipeline.select(
      baseInput({
        route: "execute",
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          recommendedSkillTags: ["localize"],
        },
      }),
    );

    expect(result.status).toBe("empty");
    expect(result.instructions).toEqual([]);
  });

  it("omits requireTagEvidence skills without tag evidence", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog([
        {
          id: "cicd-agent",
          title: "CI/CD Agent",
          content: "Diff-first CI guidance.",
          intents: ["test", "config"],
          routes: ["execute"],
          tags: ["ci", "workflow", "coverage"],
          paths: [],
          priority: 200,
          alwaysApply: false,
          requireTagEvidence: true,
        },
        {
          id: "safety-always",
          title: "Safety",
          content: "Never invent permissions beyond the granted tools.",
          intents: [],
          routes: [],
          tags: [],
          paths: [],
          priority: 10,
          alwaysApply: true,
        },
      ]),
    });

    const withoutTags = await pipeline.select(
      baseInput({
        query: "Add unit tests for the parser",
        evidence: {
          primaryIntent: "test",
          secondaryIntents: [],
        },
      }),
    );
    expect(withoutTags.instructions.map((block) => block.id)).not.toContain(
      "cicd-agent",
    );

    const withTags = await pipeline.select(
      baseInput({
        query: "Fix the GitHub Actions workflow coverage gate",
        evidence: {
          primaryIntent: "test",
          secondaryIntents: [],
        },
      }),
    );
    expect(withTags.instructions.map((block) => block.id)).toContain(
      "cicd-agent",
    );
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
          paths: [],
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

  it("gates path-scoped skills on repository evidence paths", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog([
        {
          id: "vscode-bugfix",
          title: "VS Code bugfix",
          content: "Use VS Code extension APIs and webview protocol checks.",
          intents: ["bugfix"],
          routes: ["execute"],
          tags: ["sidebar"],
          paths: ["apps/vscode/**"],
          priority: 200,
          alwaysApply: false,
        },
        {
          id: "cli-bugfix",
          title: "CLI bugfix",
          content: "Use CLI session and stdout conventions.",
          intents: ["bugfix"],
          routes: ["execute"],
          tags: ["cli"],
          paths: ["apps/cli/**"],
          priority: 100,
          alwaysApply: false,
        },
      ]),
    });

    const result = await pipeline.select(
      baseInput({
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          paths: ["apps/vscode/src/sidebar.ts"],
        },
      }),
    );

    expect(result.status).toBe("selected");
    expect(result.instructions.map((block) => block.id)).toEqual([
      "vscode-bugfix",
    ]);
  });

  it("does not select path-scoped skills without path evidence", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog([
        {
          id: "vscode-bugfix",
          title: "VS Code bugfix",
          content: "Use VS Code extension APIs.",
          intents: ["bugfix"],
          routes: ["execute"],
          tags: [],
          paths: ["apps/vscode/**"],
          priority: 200,
          alwaysApply: false,
        },
      ]),
    });

    const result = await pipeline.select(baseInput());

    expect(result.status).toBe("empty");
    expect(result.instructions).toEqual([]);
  });

  it("does not apply intent-matched skills on incompatible routes", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog([
        {
          id: "ask-concise",
          title: "Ask concise",
          content: "Keep answers short in ask routes.",
          intents: ["question", "docs", "explain"],
          routes: ["direct_answer", "repository_answer"],
          tags: ["concise"],
          paths: [],
          priority: 180,
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
      ]),
    });

    const result = await pipeline.select(
      baseInput({
        route: "execute",
        query: "Explain how the preview loader works",
        evidence: {
          primaryIntent: "question",
          secondaryIntents: [],
        },
      }),
    );

    expect(result.status).toBe("selected");
    expect(result.instructions.map((block) => block.id)).toEqual([
      "safety-always",
    ]);
    expect(result.instructions.map((block) => block.id)).not.toContain(
      "ask-concise",
    );
  });

  it("loads required skills even when relevance matching would skip them", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog([
        ...catalog,
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

  it("reports not_found omissions for missing required skills", async () => {
    const pipeline = new SkillsPipeline({
      catalog: new InMemorySkillsCatalog(catalog),
    });

    const result = await pipeline.select(
      baseInput({
        requiredSkillIds: ["missing-skill"],
      }),
    );

    expect(result.reasonCodes).toContain("skills_required_not_found");
    expect(result.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillId: "missing-skill",
          reason: "not_found",
        }),
      ]),
    );
  });
});
