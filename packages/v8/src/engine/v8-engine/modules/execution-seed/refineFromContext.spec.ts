import { describe, expect, it } from "vitest";

import { refineExecutionSeedFromContext } from "./refineFromContext";
import type { ExecutionSeed } from "./resolve";

function seed(partial: Partial<ExecutionSeed> & { paths: string[] }): ExecutionSeed {
  return {
    symbols: [],
    causeNotes: [],
    confidence: "trusted",
    source: "artifact",
    ...partial,
  };
}

describe("refineExecutionSeedFromContext", () => {
  it("promotes folder-only seed to scored context files", () => {
    const refined = refineExecutionSeedFromContext({
      seed: seed({ paths: ["apps/desktop"] }),
      contextPaths: [
        "apps/desktop/src/renderer/SettingsPanel.tsx",
        "apps/desktop/src/renderer/IndexStatusChip.tsx",
        "apps/desktop/src/shared/settings.ts",
        "apps/desktop/src/engine/server.ts",
      ],
      userPrompt:
        "upon clicking Index settings its should redirect properly to semantic tab",
    });
    expect(refined.paths.some((path) => path.includes("IndexStatusChip"))).toBe(
      true,
    );
    expect(refined.paths.some((path) => path.includes("SettingsPanel"))).toBe(
      true,
    );
    expect(refined.paths.some((path) => /\/App\.tsx$/i.test(path))).toBe(true);
    expect(refined.paths).not.toContain("apps/desktop");
    expect(refined.source).toBe("mixed");
  });

  it("binds App.tsx for Index/settings navigation even when retrieval omitted it", () => {
    const refined = refineExecutionSeedFromContext({
      seed: seed({
        paths: [
          "apps/desktop/src/renderer/IndexStatusChip.tsx",
          "apps/desktop/src/renderer/SettingsPanel.tsx",
          "apps/desktop/src/shared/settings.ts",
        ],
        source: "mixed",
      }),
      contextPaths: [
        "apps/desktop/src/renderer/IndexStatusChip.tsx",
        "apps/desktop/src/renderer/SettingsPanel.tsx",
        "apps/desktop/src/shared/settings.ts",
      ],
      userPrompt:
        "upon clicking Index settings its should redirect properly to semantic tab",
    });
    expect(refined.paths).toContain("apps/desktop/src/renderer/App.tsx");
    expect(refined.paths[0]).toMatch(/App\.tsx$/i);
  });

  it("leaves file seeds unchanged for non-navigation asks", () => {
    const original = seed({
      paths: ["apps/desktop/src/renderer/SettingsPanel.tsx"],
      source: "user",
    });
    const refined = refineExecutionSeedFromContext({
      seed: original,
      contextPaths: [
        "apps/desktop/src/renderer/SettingsPanel.tsx",
        "apps/desktop/src/renderer/IndexStatusChip.tsx",
      ],
      userPrompt: "rename a label in the settings panel copy",
    });
    expect(refined).toEqual(original);
  });
});
