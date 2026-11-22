import { describe, expect, it } from "vitest";
import {
  PLANNING_SCHEMA_VERSION,
  PlanningPipeline,
  serializePlanForPrompt,
} from "../index";
import { fakeLlm, baseInput } from "./planningHarness";

describe("PlanningPipeline diagnostics", () => {
  const pipeline = new PlanningPipeline();

  it("drafts concrete diagnostic repair steps from preflight build evidence", async () => {
    const result = await pipeline.plan(
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
          summary: "2 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: [
            {
              path: "packages/mui-builder/src/Button.tsx",
              severity: "error",
              message: "Type 'number' is not assignable to type 'string'.",
              startLine: 42,
              source: "tsc",
              code: "TS2322",
            },
            {
              path: "packages/mui-builder/src/theme.ts",
              severity: "error",
              message: "Property 'palette' does not exist.",
              startLine: 7,
              source: "tsc",
              code: "TS2339",
            },
          ],
        },
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];

    expect(result.strategy?.strategy).toBe("follow_evidence");
    expect(result.reasonCodes).toContain("plan_strategy_follow_evidence");
    expect(result.reasonCodes).toContain("plan_diagnostics_considered");
    expect(result.plan?.phases.map((phase) => phase.name)).toEqual([
      "Change",
      "Verify",
    ]);
    expect(changeSteps.map((step) => step.intent)).toEqual(
      expect.arrayContaining([
        "Fix TS2322 in packages/mui-builder/src/Button.tsx",
        "Fix TS2339 in packages/mui-builder/src/theme.ts",
      ]),
    );
    expect(changeSteps.map((step) => step.id)).not.toContain("step-implement");
    expect(changeSteps[0]?.targetRefs).toEqual([
      "packages/mui-builder/src/Button.tsx",
    ]);
    expect(serializePlanForPrompt(result.plan!, result.strategy)).toContain(
      "bind to the listed evidence",
    );
  });

  it("splits a same-code diagnostic class into capped write batches", async () => {
    const files = Array.from(
      { length: 8 },
      (_, index) => `packages/mui-builder/src/file${index + 1}.ts`,
    );
    const result = await pipeline.plan(
      baseInput({
        query: "Fix all the ts errors in packages/mui-builder",
        maxFilesPerBatch: 3,
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "package",
          complexity: "simple",
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
          summary: "8 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: files.map((path) => ({
            path,
            severity: "error",
            message: "Type 'number' is not assignable to type 'string'.",
            startLine: 1,
            source: "tsc",
            code: "TS2322",
          })),
        },
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];
    expect(result.strategy?.strategy).toBe("follow_evidence");
    expect(changeSteps).toHaveLength(3);
    expect(changeSteps.map((step) => step.targetRefs.length)).toEqual([
      3, 3, 2,
    ]);
    expect(changeSteps.every((step) => step.targetRefs.length <= 3)).toBe(
      true,
    );
    expect(changeSteps[0]?.targetRefs).toEqual(files.slice(0, 3));
    expect(changeSteps[0]?.intent).toContain("(1/3)");
    expect(changeSteps[1]?.intent).toContain("(2/3)");
    expect(changeSteps[2]?.intent).toContain("(3/3)");
    expect(changeSteps.map((step) => step.id)).toEqual([
      "step-fix-diagnostic-1",
      "step-fix-diagnostic-2",
      "step-fix-diagnostic-3",
    ]);
  });

  it("keeps up to twelve discovered package-port change surfaces on the plan", async () => {
    const surfaces = Array.from(
      { length: 12 },
      (_, index) => `packages/mui-builder/src/file-${index + 1}.ts`,
    );
    const result = await pipeline.plan(
      baseInput({
        query:
          "Create packages/mui-builder as a full port of packages/formik-form-builder",
        budgetTokens: 6_000,
        evidence: {
          primaryIntent: "migrate",
          secondaryIntents: ["scaffold"],
          interactionIntent: "act",
          scope: "package",
          complexity: "complex",
          risk: "medium",
          clarity: "clear",
          targets: [
            {
              kind: "folder",
              value: "packages/mui-builder",
              explicit: true,
            },
            {
              kind: "folder",
              value: "packages/formik-form-builder",
              explicit: true,
            },
          ],
          constraints: ["Use MUI Material instead of Joy"],
          requestedOutcomes: ["A usable package port"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code", "config"],
        },
        discoveryBrief: {
          schemaVersion: PLANNING_SCHEMA_VERSION,
          objective:
            "Create packages/mui-builder as a full port of packages/formik-form-builder",
          filesRead: [
            {
              path: "packages/formik-form-builder/src/index.ts",
              reason: "Template entry",
            },
          ],
          targets: [
            {
              kind: "folder",
              value: "packages/mui-builder",
              reason: "Requested target package",
              explicit: true,
            },
          ],
          proposedChangeSurfaces: surfaces.map((path) => ({
            path,
            actionHint: "Create/adapt toward packages/mui-builder",
            riskLevel: "low",
            evidence: "Template package file",
          })),
          discoveredConstraints: [],
          verificationHints: [{ kind: "typecheck", reason: "Typed package" }],
          openQuestions: [],
          confidence: "high",
        },
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];
    expect(result.strategy?.strategy).toBe("discover_and_plan");
    expect(changeSteps).toHaveLength(12);
    expect(changeSteps.map((step) => step.targetRefs[0])).toEqual(surfaces);
  });

  it("backfills discovered surfaces when the discovery draft is too short", async () => {
    const surfaces = Array.from(
      { length: 10 },
      (_, index) => `packages/mui-builder/src/file-${index + 1}.ts`,
    );
    const draftingPipeline = new PlanningPipeline({
      llm: fakeLlm([
        JSON.stringify({
          steps: [
            {
              phaseHint: "change",
              intent: "Create the first ported file",
              actionSummary: "Port the first discovered file",
              targetRefs: [surfaces[0]],
              expectedOutcome: "The first file is ported.",
            },
          ],
        }),
      ]),
    });

    const result = await draftingPipeline.plan(
      baseInput({
        query:
          "Create packages/mui-builder as a full port of packages/formik-form-builder",
        budgetTokens: 6_000,
        evidence: {
          primaryIntent: "migrate",
          secondaryIntents: ["scaffold"],
          interactionIntent: "act",
          scope: "package",
          complexity: "complex",
          risk: "medium",
          clarity: "clear",
          targets: [
            {
              kind: "folder",
              value: "packages/mui-builder",
              explicit: true,
            },
            {
              kind: "folder",
              value: "packages/formik-form-builder",
              explicit: true,
            },
          ],
          constraints: [],
          requestedOutcomes: ["A usable package port"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        discoveryBrief: {
          schemaVersion: PLANNING_SCHEMA_VERSION,
          objective:
            "Create packages/mui-builder as a full port of packages/formik-form-builder",
          filesRead: [
            {
              path: "packages/formik-form-builder/src/index.ts",
              reason: "Template entry",
            },
          ],
          targets: [
            {
              kind: "folder",
              value: "packages/mui-builder",
              reason: "Requested target package",
              explicit: true,
            },
          ],
          proposedChangeSurfaces: surfaces.map((path) => ({
            path,
            actionHint: "Create/adapt toward packages/mui-builder",
            riskLevel: "low",
            evidence: "Template package file",
          })),
          discoveredConstraints: [],
          verificationHints: [{ kind: "typecheck", reason: "Typed package" }],
          openQuestions: [],
          confidence: "high",
        },
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];
    expect(result.reasonCodes).toContain("plan_drafted_from_discovery");
    expect(changeSteps).toHaveLength(10);
    expect(changeSteps.map((step) => step.targetRefs[0])).toEqual(surfaces);
  });

  it("keeps overflow diagnostic batches on the plan when maxDiagnosticSteps is smaller than the split", async () => {
    const files = Array.from(
      { length: 8 },
      (_, index) => `packages/mui-builder/src/file${index + 1}.ts`,
    );
    const result = await pipeline.plan(
      baseInput({
        query: "Fix all the ts errors in packages/mui-builder",
        maxFilesPerBatch: 3,
        maxDiagnosticSteps: 2,
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "package",
          complexity: "simple",
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
          summary: "8 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: files.map((path) => ({
            path,
            severity: "error",
            message: "Type 'number' is not assignable to type 'string'.",
            startLine: 1,
            source: "tsc",
            code: "TS2322",
          })),
        },
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];
    expect(changeSteps).toHaveLength(3);
    expect(changeSteps.map((step) => step.targetRefs)).toEqual([
      files.slice(0, 3),
      files.slice(3, 6),
      files.slice(6, 8),
    ]);
  });

  it("keeps more diagnostic batches on the plan than the live task list can show", async () => {
    const files = Array.from(
      { length: 12 },
      (_, index) => `packages/mui-builder/src/file${index + 1}.ts`,
    );
    const result = await pipeline.plan(
      baseInput({
        query: "Fix all the ts errors in packages/mui-builder",
        maxFilesPerBatch: 1,
        maxDiagnosticSteps: 2,
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "package",
          complexity: "simple",
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
          summary: "12 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: files.map((path) => ({
            path,
            severity: "error",
            message: "Type 'number' is not assignable to type 'string'.",
            startLine: 1,
            source: "tsc",
            code: "TS2322",
          })),
        },
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];
    expect(changeSteps).toHaveLength(12);
    expect(changeSteps.every((step) => step.targetRefs.length === 1)).toBe(
      true,
    );
  });
});
