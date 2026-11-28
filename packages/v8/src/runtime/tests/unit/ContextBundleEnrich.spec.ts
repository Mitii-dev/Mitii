import { describe, expect, it } from "vitest";

import {
  buildFullContextBundle,
  refreshContextBundleLight,
} from "../../helpers/enrich";
import { enrichContext } from "../../flow/steps/9-EnrichContext";
import { StoreManager } from "../../helpers/store";
import type { StepContext } from "../../flow/steps/StepContext";

describe("ContextBundle enrich (S11)", () => {
  it("builds full bundle with cacheClass slices", () => {
    const bundle = buildFullContextBundle({
      pack: {
        schemaVersion: 1,
        request: { text: "fix packages/demo" },
        scope: {
          focusPaths: ["packages/demo/src/a.ts"],
          readHint: "package",
          evidence: "focus_only",
          relatedSeeds: ["packages/sdk"],
        },
        pins: { skillIds: ["nl-sql"], mcpIds: [], projectRules: ["agents-md"], userSafetyRules: [] },
        navigation: {
          mentionedPaths: ["packages/demo"],
          surroundings: ["packages/demo", "packages/sdk"],
        },
        host: {
          dirtyPaths: [],
          diagnostics: ["L1: error"],
        },
        omissions: {},
        reasonCodes: [],
      },
      route: "execute",
      grantProfile: "write",
      decisionBrief: "mutate demo package",
      skillInstructions: ["skill:nl-sql"],
      memoryFacts: ["uses pnpm"],
    });

    expect(bundle.enrichMode).toBe("full");
    expect(bundle.projectRules?.cacheClass).toBe("stable");
    expect(bundle.skills?.items).toContain("skill:nl-sql");
    expect(bundle.memory?.cacheClass).toBe("semi");
    expect(bundle.repoContext?.cacheClass).toBe("volatile");
    expect(bundle.diagnostics).toContain("L1: error");
    expect(bundle.reasonCodes).toContain("enrich_full_bundle");
  });

  it("records explicit pins separately from focus noise", () => {
    const bundle = buildFullContextBundle({
      pack: {
        schemaVersion: 1,
        request: { text: "explain cases" },
        scope: {
          focusPaths: ["cases", "apps/desktop/src/a.ts"],
          readHint: "folder",
          evidence: "focus_only",
          relatedSeeds: [],
        },
        navigation: { mentionedPaths: ["cases"], surroundings: [] },
        omissions: {},
        reasonCodes: [],
      },
      route: "diagnose",
      grantProfile: "read",
      pinnedPaths: ["cases", ".mitii"],
    });
    expect(bundle.pinnedPaths).toEqual(["cases"]);
    expect(bundle.summary).toContain("pinned=cases");
    expect(bundle.reasonCodes).toContain("enrich_pinned_paths");
  });

  it("light refresh keeps stable skills/rules", () => {
    const full = buildFullContextBundle({
      route: "execute",
      grantProfile: "write",
      projectRulesText: "Always use pnpm",
      skillInstructions: ["skill:stable"],
      repoSlices: ["packages/demo"],
    });
    const light = refreshContextBundleLight({
      previous: full,
      changedPaths: ["packages/demo/src/b.ts"],
      diagnostics: ["L2: warn"],
    });
    expect(light.enrichMode).toBe("light");
    expect(light.projectRules?.text).toBe("Always use pnpm");
    expect(light.skills?.items).toEqual(["skill:stable"]);
    expect(light.repoContext?.items).toEqual(
      expect.arrayContaining(["packages/demo/src/b.ts", "packages/demo"]),
    );
    expect(light.reasonCodes).toContain("enrich_light_refresh");
  });

  it("enrichContext step wires full then light", () => {
    const store = StoreManager.create("e1");
    store.setSlice("situationPack", {
      schemaVersion: 1,
      request: { text: "hi" },
      scope: {
        focusPaths: ["src/a.ts"],
        readHint: "folder",
        evidence: "focus_only",
        relatedSeeds: [],
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
      input: { message: "hi" },
      mode: "agent",
      store,
    };
    const full = enrichContext(ctx);
    expect(full.enrichMode).toBe("full");
    const light = enrichContext(ctx, {
      mode: "light",
      changedPaths: ["src/b.ts"],
    });
    expect(light.enrichMode).toBe("light");
    expect(light.focusPaths).toContain("src/b.ts");
  });
});
