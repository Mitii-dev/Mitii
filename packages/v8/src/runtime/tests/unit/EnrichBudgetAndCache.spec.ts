import { describe, expect, it } from "vitest";

import {
  buildFullContextBundle,
  prioritizeOmissions,
  sectionBudgetsFromWindowPolicy,
} from "../../helpers/enrich";
import {
  cacheBreakpointsForCapability,
  layoutBriefcaseSlots,
  packTurn,
  resolvePromptCacheCapability,
} from "../../helpers/store";
import { enrichContext } from "../../flow/steps/9-EnrichContext";
import { applyWindowPolicy } from "../../flow/steps/1-ApplyWindowPolicy";
import { StoreManager } from "../../helpers/store";
import type { StepContext } from "../../flow/steps/StepContext";
import { assessBlastRadius } from "../../helpers/rails";

describe("S11-BUDGET / S11-CACHE / S10-BLAST", () => {
  it("deriveWindowPolicy stores section budgets on start", () => {
    const store = StoreManager.create("wp1");
    const ctx: StepContext = {
      input: { message: "hi", contextWindowTokens: 128_000 },
      mode: "agent",
      store,
    };
    const policy = applyWindowPolicy(ctx);
    expect(policy?.sections.skillsTokens).toBeGreaterThan(0);
    expect(policy?.sections.repositoryTokens).toBeGreaterThan(0);
    expect(store.getSlice("windowPolicy")).toMatchObject({
      schemaVersion: 1,
      contextWindowTokens: 128_000,
    });
  });

  it("prioritizeOmissions drops broad repo before focused", () => {
    const bundle = buildFullContextBundle({
      pack: {
        schemaVersion: 1,
        request: { text: "fix" },
        scope: {
          focusPaths: ["packages/demo/src"],
          readHint: "folder",
          evidence: "focus_only",
          relatedSeeds: [],
        },
        omissions: {},
        reasonCodes: [],
      },
      route: "execute",
      grantProfile: "write",
      skillInstructions: [
        "skill:required-body",
        "skill:optional-long-".repeat(40),
      ],
      memoryFacts: ["fact-a", "fact-b-very-long-".repeat(30)],
      repoSlices: [
        "packages/demo/src/a.ts",
        `packages/other/${"z".repeat(200)}.ts`,
      ],
    });

    const result = prioritizeOmissions({
      bundle,
      budgets: {
        skillsTokens: 40,
        repositoryTokens: 12,
        memoryTokens: 10,
        maxSkills: 2,
      },
      focusPaths: ["packages/demo/src"],
      requiredSkillIds: ["required-body"],
    });

    expect(result.omitted.length).toBeGreaterThan(0);
    expect(result.bundle.reasonCodes).toContain("enrich_omissions_applied");
    expect(result.bundle.repoContext?.items ?? []).toEqual(
      expect.arrayContaining(["packages/demo/src/a.ts"]),
    );
    expect(
      (result.bundle.repoContext?.items ?? []).some((i) =>
        i.includes("packages/other/"),
      ),
    ).toBe(false);
    expect(result.omitted.some((o) => o.kind === "broad_repo")).toBe(true);
  });

  it("enrichContext applies windowPolicy budgets", () => {
    const store = StoreManager.create("enr-budget");
    applyWindowPolicy({
      input: { message: "x", contextWindowTokens: 32_000 },
      mode: "agent",
      store,
    });
    store.setSlice("situationPack", {
      schemaVersion: 1,
      request: { text: "x" },
      scope: {
        focusPaths: ["a.ts"],
        readHint: "file",
        evidence: "focus_only",
        relatedSeeds: [],
      },
      pins: {
        skillIds: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
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
    const bundle = enrichContext({
      input: { message: "x" },
      mode: "agent",
      store,
    });
    const policy = store.getSlice<{ skills?: { maxSkills?: number } }>(
      "windowPolicy",
    );
    if (policy?.skills?.maxSkills) {
      expect((bundle.skills?.items.length ?? 0) <= policy.skills.maxSkills).toBe(
        true,
      );
    }
    expect(bundle.enrichMode).toBe("full");
  });

  it("packTurn layouts stable→semi→volatile and marks cache breakpoints", () => {
    const bundle = buildFullContextBundle({
      route: "execute",
      grantProfile: "write",
      projectRulesText: "use pnpm",
      decisionBrief: "mutate demo",
      skillInstructions: ["skill:a"],
      memoryFacts: ["prefers pnpm"],
      repoSlices: ["packages/demo"],
    });
    const packed = packTurn({
      messages: [{ role: "user", content: "go" }],
      grant: { allowedTools: ["read_file"] },
      contextBundle: bundle,
      promptCache: "anthropic_ephemeral",
    });
    expect(packed.briefcaseSlots?.stable.join("\n")).toContain("rules:");
    expect(packed.briefcaseSlots?.stable.join("\n")).toContain("skills:");
    expect(packed.briefcaseSlots?.semi.join("\n")).toContain("memory:");
    expect(packed.briefcaseSlots?.volatile.join("\n")).toContain("repo:");
    expect(packed.cacheBreakpoints?.map((b) => b.afterSlot)).toEqual([
      "stable",
      "semi",
    ]);
    expect(packed.reasonCodes).toContain("pack_turn_cache_anthropic_ephemeral");
  });

  it("resolvePromptCacheCapability is capability-based", () => {
    expect(resolvePromptCacheCapability({})).toBe("none");
    expect(
      resolvePromptCacheCapability({ supportsPromptCaching: true }),
    ).toBe("anthropic_ephemeral");
    expect(
      resolvePromptCacheCapability({ promptCache: "openai_prefix" }),
    ).toBe("openai_prefix");
    const slots = layoutBriefcaseSlots(
      buildFullContextBundle({
        route: "execute",
        grantProfile: "read",
        skillInstructions: ["s"],
      }),
    );
    expect(cacheBreakpointsForCapability("none", slots)).toEqual([]);
    expect(
      cacheBreakpointsForCapability("openai_prefix", slots).map((m) => m.afterSlot),
    ).toEqual(["stable"]);
  });

  it("assessBlastRadius escalates outside plan / oversize", () => {
    const outside = assessBlastRadius({
      changedPaths: ["packages/demo/a.ts", "packages/other/b.ts"],
      allowedWritePaths: ["packages/demo"],
    });
    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.escalate).toBe("mutation_approval");
      expect(outside.needsMutationApproval).toBe(true);
    }

    const oversize = assessBlastRadius({
      changedPaths: Array.from({ length: 30 }, (_, i) => `f${i}.ts`),
      maxFiles: 10,
      destructiveIfOversize: true,
    });
    expect(oversize.ok).toBe(false);
    if (!oversize.ok) {
      expect(oversize.escalate).toBe("destructive_action");
      expect(oversize.needsDestructiveApproval).toBe(true);
    }

    expect(
      assessBlastRadius({
        changedPaths: ["packages/demo/a.ts"],
        allowedWritePaths: ["packages/demo"],
      }).ok,
    ).toBe(true);
  });

  it("sectionBudgetsFromWindowPolicy maps skills/repo/memory", () => {
    const budgets = sectionBudgetsFromWindowPolicy({
      sections: { skillsTokens: 100, repositoryTokens: 200 },
      skills: { budgetTokens: 80, maxSkills: 4 },
      compaction: { memoryReinjectChars: 400 },
    });
    expect(budgets.skillsTokens).toBe(80);
    expect(budgets.repositoryTokens).toBe(200);
    expect(budgets.memoryTokens).toBe(100);
    expect(budgets.maxSkills).toBe(4);
  });
});
