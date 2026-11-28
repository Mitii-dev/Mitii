import { describe, expect, it } from "vitest";

import {
  DecisionPolicyError,
  DecisionPolicyPipeline,
  applyUpgradePlate,
  isRegisteredUpgradePlate,
} from "../../index";
import { createInput, createUnderstanding } from "../fixtures/decisionCases";

describe("applyUpgradePlate / widen via plates", () => {
  const pipeline = new DecisionPolicyPipeline();

  it("registers known upgrade plates", () => {
    expect(isRegisteredUpgradePlate("upgrade_expand_write_paths")).toBe(true);
    expect(isRegisteredUpgradePlate("upgrade_unlock_network")).toBe(true);
    expect(isRegisteredUpgradePlate("not_a_plate")).toBe(false);
  });

  it("rejects widen without a registered plate", () => {
    const previous = pipeline.decide(
      createInput({
        mode: "agent",
        message: "Fix src/a.ts",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
        }),
      }),
    );
    expect(() =>
      pipeline.widen({
        previous,
        upgradePlateId: "casual_widen",
        extraPaths: ["src/b.ts"],
      }),
    ).toThrow(DecisionPolicyError);
  });

  it("expands write paths only via expand plate", () => {
    const previous = pipeline.decide(
      createInput({
        mode: "agent",
        message: "Only edit under src/parser — fix src/parser/a.ts",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
          taskAnalysis: {
            targets: [
              { kind: "file", value: "src/parser/a.ts", explicit: true },
            ],
          },
        }),
      }),
    );
    const widened = applyUpgradePlate({
      previous,
      upgradePlateId: "upgrade_expand_write_paths",
      extraPaths: ["test/Desktop/pages/Nav.ts"],
    });
    expect(widened.reasonCodes).toContain("grant_expanded");
    expect(widened.trace?.overrides?.some((o) => o.reasonCode.includes("upgrade_"))).toBe(
      true,
    );
    expect(widened.toolGrant.mutationPathScopes ?? []).toEqual(
      expect.arrayContaining(["src/parser", "test/Desktop/pages"]),
    );
  });

  it("unlocks network tools via unlock_network plate", () => {
    const previous = pipeline.decide(
      createInput({
        mode: "ask",
        message: "Need Zebra ZP450 software compatible with Windows 11",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
        }),
      }),
    );
    const widened = pipeline.widen({
      previous,
      upgradePlateId: "upgrade_unlock_network",
      extraNetworkHosts: ["www.zebra.com"],
    });
    expect(widened.toolGrant.networkHosts).toContain("www.zebra.com");
    expect(widened.toolGrant.allowedTools).toEqual(
      expect.arrayContaining(["web_search", "fetch_url"]),
    );
  });
});
