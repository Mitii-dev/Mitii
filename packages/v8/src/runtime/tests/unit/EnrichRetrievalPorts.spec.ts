import { describe, expect, it } from "vitest";

import {
  createInlineMemoryRetrieval,
  createInlineRepoRetrieval,
  createInlineSkillsRetrieval,
} from "../../adapters/enrich";
import { retrieveEnrichMaterials } from "../../helpers/enrich";
import {
  enrichContext,
  enrichContextWithRetrieval,
} from "../../flow/steps/9-EnrichContext";
import { StoreManager } from "../../helpers/store";
import type { StepContext } from "../../flow/steps/StepContext";

describe("Enrich retrieval ports (S11)", () => {
  it("retrieveEnrichMaterials uses ports when present", async () => {
    const materials = await retrieveEnrichMaterials({
      ports: {
        skills: createInlineSkillsRetrieval({ "nl-sql": "NL SQL skill body" }),
        memory: createInlineMemoryRetrieval(["prefers pnpm"]),
        repo: createInlineRepoRetrieval(),
      },
      skillIds: ["nl-sql"],
      query: "fix demo",
      focusPaths: ["packages/demo/src/a.ts"],
      route: "execute",
    });

    expect(materials.skillInstructions).toContain("NL SQL skill body");
    expect(materials.memoryFacts).toContain("prefers pnpm");
    expect(materials.repoSlices).toContain("packages/demo/src/a.ts");
    expect(materials.reasonCodes).toEqual(
      expect.arrayContaining([
        "enrich_skills_port",
        "enrich_memory_port",
        "enrich_repo_port",
      ]),
    );
  });

  it("falls back to pin/focus stubs without ports", async () => {
    const materials = await retrieveEnrichMaterials({
      skillIds: ["x"],
      focusPaths: ["src/a.ts"],
    });
    expect(materials.skillInstructions).toEqual(["skill:x"]);
    expect(materials.repoSlices).toEqual(["src/a.ts"]);
    expect(materials.reasonCodes).toContain("enrich_skills_pin_stub");
    expect(materials.reasonCodes).toContain("enrich_repo_focus_stub");
  });

  it("enrichContextWithRetrieval stamps port reason codes", async () => {
    const store = StoreManager.create("enrich-ports-1");
    store.setSlice("situationPack", {
      schemaVersion: 1,
      request: { text: "use memory" },
      scope: {
        focusPaths: ["src/main.ts"],
        readHint: "file",
        evidence: "focus_only",
        relatedSeeds: [],
      },
      pins: {
        skillIds: ["ship"],
        mcpIds: [],
        projectRules: [],
        userSafetyRules: [],
      },
      omissions: {},
      reasonCodes: [],
    });
    store.setSlice("decision", {
      route: "execute",
      grantProfile: "write",
      planningDepth: "none",
      planGate: "none",
      reasonCodes: [],
    });

    const ctx: StepContext = {
      input: { message: "use memory" },
      mode: "agent",
      store,
      deps: {
        enrich: {
          skills: createInlineSkillsRetrieval(),
          memory: createInlineMemoryRetrieval(["fact:a"]),
          repo: createInlineRepoRetrieval(),
        },
      },
    };

    const bundle = await enrichContextWithRetrieval(ctx);
    expect(bundle.skills?.items?.[0]).toBe("skill:ship");
    expect(bundle.memory?.items).toContain("fact:a");
    expect(bundle.repoContext?.items).toEqual(
      expect.arrayContaining(["src/main.ts"]),
    );
    expect(bundle.reasonCodes).toContain("enrich_skills_port");
    expect(bundle.reasonCodes).toContain("enrich_memory_port");
  });

  it("sync enrichContext still works without ports", () => {
    const store = StoreManager.create("enrich-sync");
    store.setSlice("situationPack", {
      schemaVersion: 1,
      request: { text: "hi" },
      scope: {
        focusPaths: ["a.ts"],
        readHint: "file",
        evidence: "focus_only",
        relatedSeeds: [],
      },
      pins: {
        skillIds: ["s1"],
        mcpIds: [],
        projectRules: [],
        userSafetyRules: [],
      },
      omissions: {},
      reasonCodes: [],
    });
    const ctx: StepContext = {
      input: { message: "hi" },
      mode: "agent",
      store,
    };
    const bundle = enrichContext(ctx);
    expect(bundle.skills?.items).toContain("skill:s1");
  });
});
