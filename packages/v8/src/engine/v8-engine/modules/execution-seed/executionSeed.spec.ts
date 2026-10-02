import { describe, expect, it } from "vitest";

import {
  formatExecutionSeedForPrompt,
  isExecutionSeedTrusted,
  resolveExecutionSeed,
} from "./index";
import type { RequestUnderstandingResult } from "../../../../modules/request-understanding";

function understandingWithTargets(
  targets: Array<{ kind: "file" | "folder" | "symbol"; value: string; explicit: boolean }>,
): RequestUnderstandingResult {
  return {
    intent: {
      schemaVersion: 1,
      classification: {
        primaryTaskIntent: "bugfix",
        interactionIntent: "act",
        confidence: 0.9,
      },
      diagnostics: {
        ruleSource: "deterministic",
        taskAgreement: true,
        interactionConflict: false,
      },
    },
    taskAnalysis: {
      scope: "multi_file",
      complexity: "simple",
      risk: "low",
      clarity: "clear",
      targets,
      constraints: [],
      requestedOutcomes: ["fix"],
      recommendsRepositoryDiscovery: false,
      recommendsPlanning: false,
      recommendsVerification: true,
      signals: [],
    },
  } as RequestUnderstandingResult;
}

describe("resolveExecutionSeed", () => {
  it("trusts explicit user file targets", () => {
    const seed = resolveExecutionSeed({
      userPrompt: "fix the redirect in apps/desktop/src/renderer/SettingsPanel.tsx",
      understanding: understandingWithTargets([
        {
          kind: "file",
          value: "apps/desktop/src/renderer/SettingsPanel.tsx",
          explicit: true,
        },
      ]),
    });
    expect(seed.confidence).toBe("trusted");
    expect(seed.source).toBe("user");
    expect(seed.paths).toContain("apps/desktop/src/renderer/SettingsPanel.tsx");
    expect(isExecutionSeedTrusted(seed)).toBe(true);
  });

  it("trusts diagnostic paths for fix-all-ts asks without cited files", () => {
    const seed = resolveExecutionSeed({
      userPrompt: "fix all ts errors in this project",
      diagnosticSummary: {
        diagnostics: [
          {
            path: "test/Desktop/pages/NavigationPage.ts",
            code: "TS2415",
            message: "Class incorrectly extends base class",
          },
        ],
      },
    });
    expect(seed.confidence).toBe("trusted");
    expect(seed.source).toBe("diagnostic");
    expect(seed.paths[0]).toBe("test/Desktop/pages/NavigationPage.ts");
    expect(seed.causeNotes[0]).toMatch(/TS2415/);
  });

  it("drops unrelated preflight when user cites other files", () => {
    const seed = resolveExecutionSeed({
      userPrompt:
        "upon clicking Index settings fix apps/desktop/src/renderer/SettingsPanel.tsx",
      diagnosticSummary: {
        diagnostics: [
          {
            path: "packages/v8/src/engine/v8-engine/actions/resolveAgentEngineThresholds.ts",
            message: "unrelated type error",
          },
        ],
      },
      understanding: understandingWithTargets([
        {
          kind: "file",
          value: "apps/desktop/src/renderer/SettingsPanel.tsx",
          explicit: true,
        },
      ]),
    });
    expect(seed.confidence).toBe("trusted");
    expect(seed.paths).toContain("apps/desktop/src/renderer/SettingsPanel.tsx");
    expect(seed.paths.join(" ")).not.toMatch(/resolveAgentEngineThresholds/);
  });

  it("returns weak/none when nothing authoritative exists", () => {
    const seed = resolveExecutionSeed({
      userPrompt: "make the settings better somehow",
    });
    expect(seed.confidence).toBe("weak");
    expect(seed.source).toBe("none");
    expect(seed.paths).toEqual([]);
    expect(isExecutionSeedTrusted(seed)).toBe(false);
    expect(formatExecutionSeedForPrompt(seed)).toBe("");
  });

  it("formats a binding prompt block for trusted seeds", () => {
    const seed = resolveExecutionSeed({
      userPrompt: "fix apps/desktop/src/renderer/App.tsx",
      understanding: understandingWithTargets([
        { kind: "file", value: "apps/desktop/src/renderer/App.tsx", explicit: true },
      ]),
    });
    const text = formatExecutionSeedForPrompt(seed);
    expect(text).toMatch(/ExecutionSeed confidence=trusted/);
    expect(text).toMatch(/Binding:/);
    expect(text).toMatch(/App\.tsx/);
  });
});

describe("applyExecutionSeedToTaskList", () => {
  it("fills empty write/mustRead on the active step from trusted seed", async () => {
    const { applyExecutionSeedToTaskList } = await import("./applyExecutionSeedToTaskList");
    const seed = resolveExecutionSeed({
      userPrompt: "fix apps/desktop/src/renderer/SettingsPanel.tsx",
      understanding: understandingWithTargets([
        {
          kind: "file",
          value: "apps/desktop/src/renderer/SettingsPanel.tsx",
          explicit: true,
        },
      ]),
    });
    const result = applyExecutionSeedToTaskList({
      seed,
      taskList: {
        schemaVersion: 1,
        source: "plan",
        purpose: "execution",
        items: [
          {
            id: "step-1",
            title: "Change settings redirect",
            status: "active",
          },
        ],
      },
    });
    expect(result.applied).toBe(true);
    expect(result.taskList?.items[0]?.write).toEqual([
      "apps/desktop/src/renderer/SettingsPanel.tsx",
    ]);
    expect(result.taskList?.items[0]?.mustRead).toEqual([
      "apps/desktop/src/renderer/SettingsPanel.tsx",
    ]);
  });
});
