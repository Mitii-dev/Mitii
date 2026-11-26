import { describe, expect, it } from "vitest";

import { attachPreDecideMaterials } from "../../helpers/orient/AttachPreDecideMaterials";
import type { SituationPack } from "../../contracts/orient/SituationPack";

function basePack(overrides?: Partial<SituationPack>): SituationPack {
  return {
    schemaVersion: 1,
    request: { text: "fix auth", mode: "agent" },
    requestText: "fix auth",
    mode: "agent",
    scope: {
      focusPaths: ["src/auth.ts"],
      relatedSeeds: [],
      evidence: "focus_only",
    },
    ...overrides,
  } as SituationPack;
}

describe("attachPreDecideMaterials", () => {
  it("skips when no enrich ports", async () => {
    const result = await attachPreDecideMaterials({
      pack: basePack(),
      query: "fix auth",
    });
    expect(result.reasonCodes).toContain("pre_decide_materials_skipped_no_ports");
  });

  it("stamps memory factCount before decide", async () => {
    const result = await attachPreDecideMaterials({
      pack: basePack(),
      query: "fix auth",
      enrich: {
        memory: {
          retrieve: async () => ({
            facts: ["auth uses JWT"],
            reasonCodes: ["memory_hit"],
          }),
        },
      },
    });
    expect(result.pack.memory?.factCount).toBe(1);
    expect(result.reasonCodes).toContain("pre_decide_memory_retrieved");
  });

  it("merges skill pins when skills port returns items", async () => {
    const result = await attachPreDecideMaterials({
      pack: basePack({
        pins: {
          skillIds: ["skill.auth"],
          mcpIds: [],
          projectRules: [],
          userSafetyRules: [],
        },
      }),
      query: "fix auth",
      skillIds: ["skill.auth"],
      enrich: {
        skills: {
          retrieve: async () => ({
            items: ["auth-repair skill body"],
            reasonCodes: ["skills_hit"],
          }),
        },
      },
    });
    expect(result.pack.pins?.skillIds).toContain("skill.auth");
    expect(result.reasonCodes).toContain("pre_decide_skills_selected");
  });
});
