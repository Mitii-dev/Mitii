import { describe, expect, it } from "vitest";
import { PlanningError, PlanningPipeline } from "../index";
import { baseInput } from "./planningHarness";

describe("PlanningPipeline classification and architecture", () => {
  const pipeline = new PlanningPipeline();

  it("classifies strategy without drafting a plan", async () => {
    const classified = await pipeline.resolveStrategy(
      baseInput({
        query: "@packages/mui-builder fix all the ts errors",
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          interactionIntent: "act",
          scope: "package",
          complexity: "moderate",
          risk: "low",
          clarity: "clear",
          targets: [
            {
              kind: "folder",
              value: "packages/mui-builder",
              explicit: true,
            },
          ],
          constraints: [],
          requestedOutcomes: ["Fix all TypeScript errors"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        buildEvidence: {
          phase: "before",
          summary: "1 error(s)",
          diagnostics: [
            {
              path: "packages/mui-builder/src/Button.tsx",
              severity: "error",
              message: "Type mismatch",
              startLine: 12,
              code: "TS2322",
            },
          ],
        },
      }),
    );
    expect(classified.decision.strategy).toBe("follow_evidence");
    expect(classified.decision.skipDiscover).toBe(true);
  });

  it("throws PlanningError on invalid input", async () => {
    await expect(
      pipeline.plan({
        schemaVersion: 999,
        query: "x",
        mode: "plan",
        route: "plan",
        planningDepth: "visible",
        evidence: {
          primaryIntent: "feature",
          scope: "package",
          complexity: "simple",
          risk: "low",
          clarity: "clear",
        },
      } as never),
    ).rejects.toThrow(PlanningError);
  });

  it("splits package-scale refactor asks into multiple architecture change steps", async () => {
    const result = await pipeline.plan(
      baseInput({
        query:
          "Refactor the entire test package POM across Desktop, Tablet, and shared layers",
        evidence: {
          primaryIntent: "refactor",
          secondaryIntents: ["feature"],
          interactionIntent: "act",
          scope: "package",
          complexity: "complex",
          risk: "medium",
          clarity: "clear",
          targets: [
            { kind: "folder", value: "test/shared", explicit: true },
            { kind: "folder", value: "test/Desktop/pages", explicit: true },
            { kind: "folder", value: "test/Tablet/pages", explicit: true },
            {
              kind: "file",
              value: "test/specs/Cross/dinein-complete-order.spec.ts",
              explicit: true,
            },
          ],
          constraints: [],
          requestedOutcomes: [],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
      }),
    );
    expect(result.plan).toBeDefined();
    const change = result.plan!.phases.find((phase) => phase.id === "phase-change");
    expect(change).toBeDefined();
    const stepIds = change!.steps.map((step) => step.id);
    expect(stepIds).toEqual(
      expect.arrayContaining([
        "step-shared-foundation",
        "step-platform-pages",
        "step-specs-flows",
      ]),
    );
    expect(change!.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps architecture Change steps ahead of preflight diagnostics and skill playbooks", async () => {
    const result = await pipeline.plan(
      baseInput({
        query:
          "1. Build shared base under test/shared\n2. Adapt Desktop and Tablet pages\n3. Migrate specs\nImplement a full cross-platform Page Object Model refactor across test/",
        evidence: {
          primaryIntent: "refactor",
          secondaryIntents: ["scaffold"],
          interactionIntent: "act",
          scope: "package",
          complexity: "very_complex",
          risk: "low",
          clarity: "clear",
          targets: [
            { kind: "folder", value: "test/shared", explicit: true },
            { kind: "folder", value: "test/Desktop/pages", explicit: true },
            { kind: "folder", value: "test/Tablet/pages", explicit: true },
            { kind: "folder", value: "test/specs", explicit: true },
          ],
          constraints: ["do not silently patch one file and stop"],
          requestedOutcomes: ["shared base", "platform adapters", "migrated specs"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        skills: [
          {
            id: "security-and-hardening",
            title: "Security and hardening",
            priority: 10,
            content: [
              "Planning:",
              "Change:",
              "- Validate and sanitize at boundaries",
              "- Remove secrets from code and logs",
              "Verify:",
              "- Re-run typecheck",
            ].join("\n"),
          },
          {
            id: "git-commit-message",
            title: "Git commit message",
            priority: 5,
            content: [
              "Planning:",
              "Change:",
              "- Subject ≤72 chars: type(scope): why",
            ].join("\n"),
          },
        ],
        buildEvidence: {
          phase: "before",
          summary: "1 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: [
            {
              path: "test/Desktop/pages/NavigationPage.ts",
              severity: "error",
              message:
                "Class 'NavigationPage' incorrectly extends base class 'BasePage'.",
              startLine: 10,
              source: "tsc",
              code: "TS2415",
            },
          ],
        },
      }),
    );

    const change = result.plan?.phases.find((phase) =>
      /change/i.test(phase.name),
    );
    expect(change).toBeDefined();
    const stepIds = change!.steps.map((step) => step.id);
    expect(stepIds[0]).not.toMatch(/^step-fix-diagnostic-/);
    expect(stepIds.some((id) => id.startsWith("step-fix-diagnostic-"))).toBe(
      true,
    );
    expect(
      change!.steps.some((step) =>
        /validate and sanitize|remove secrets|subject ≤72/i.test(step.intent),
      ),
    ).toBe(false);
    expect(
      stepIds.some(
        (id) =>
          id.startsWith("step-shared") ||
          id.startsWith("step-platform") ||
          id.startsWith("step-goal-") ||
          id.startsWith("step-specs"),
      ),
    ).toBe(true);
  });
});
