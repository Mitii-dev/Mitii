import { describe, expect, it } from "vitest";

import type { ToolGrant } from "../../../modules/decision-policy";
import type { TaskList } from "../../../modules/task-list";
import { createPromptConstructionPort } from "../../adapters/prompt";
import { planRouteBody } from "../../helpers/routes";
import {
  buildBriefcaseViaPC,
  mapSketchToPromptConstructionInput,
} from "../../helpers/store";
import {
  buildReadonlyDiscoveryGrant,
  enforceDiscoveryQualityFloor,
  runDiscoveryPass,
  shouldRunDiscoveryPass,
} from "../../helpers/plan-discovery";
import { emitPlanPhaseTelemetry } from "../../helpers/plan";
import { buildFullContextBundle } from "../../helpers/enrich";
import { runThroughPlanPipeline } from "../../flow/RunThroughPlanPipeline";
import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";
import { resolveDiscoveryPassBudget } from "../../../modules/window-budget";

function sampleGrant(): ToolGrant {
  return {
    maximumWorkspaceEffect: "read",
    allowedTools: ["read_file", "list_directory"],
    allowedEffects: ["workspace_read"],
    pathScopes: ["."],
    approvalMode: "when_required",
    limits: {
      maxToolCalls: 16,
      maxWallTimeMs: 60_000,
      maxOutputBytes: 512_000,
    },
  };
}

function sampleDecision(
  overrides?: Partial<RuntimeDecisionSketch>,
): RuntimeDecisionSketch {
  return {
    plateId: "test_plan",
    route: "plan",
    grantProfile: "read",
    planningDepth: "visible",
    planGate: "none",
    runDisposition: "continue",
    routeBody: planRouteBody(),
    pathScopes: ["."],
    toolGrant: sampleGrant(),
    verification: {
      required: false,
      minimumEvidence: ["diagnostics"],
      checks: ["diagnostics"],
      allowUnavailable: true,
      onFailure: "report",
    },
    repositoryContextRequired: true,
    rationale: "test briefcase via pc",
    reasonCodes: ["runtime_decide_plate"],
    ...overrides,
  };
}

function sampleTaskList(): TaskList {
  return {
    schemaVersion: 1,
    source: "plan",
    items: [
      {
        id: "t1",
        title: "Inspect auth",
        status: "active",
        write: ["src/auth/Login.ts"],
      },
    ],
  };
}

describe("S3A-DISCOVER / S3A-TELEMETRY / S11-BRIEF PC", () => {
  it("shouldRunDiscoveryPass gates plan mode and task size", () => {
    expect(
      shouldRunDiscoveryPass({ mode: "plan", route: "plan" }).run,
    ).toBe(true);
    expect(
      shouldRunDiscoveryPass({
        mode: "agent",
        route: "execute",
        planningDepth: "visible",
      }).run,
    ).toBe(true);
    expect(
      shouldRunDiscoveryPass({
        mode: "agent",
        route: "execute",
        planningDepth: "none",
        taskSize: "small",
      }).run,
    ).toBe(false);
    expect(
      shouldRunDiscoveryPass({ skipDiscovery: true, mode: "plan" }).run,
    ).toBe(false);
  });

  it("buildReadonlyDiscoveryGrant never allows mutate tools", () => {
    const grant = buildReadonlyDiscoveryGrant({ readPaths: ["src"] });
    expect(grant.maximumWorkspaceEffect).toBe("read");
    expect(grant.allowedTools).toContain("read_file");
    expect(grant.allowedTools).not.toContain("apply_patch");
    expect(grant.writePaths).toEqual([]);
  });

  it("runDiscoveryPass compiles brief from SituationPack seeds", async () => {
    const budget = resolveDiscoveryPassBudget("medium", "standard");
    const result = await runDiscoveryPass({
      objective: "Find login null crash site",
      pack: {
        schemaVersion: 1,
        requestText: "fix login null",
        request: { text: "fix login null" },
        scope: {
          focusPaths: ["src/auth/Login.ts", "src/auth/Session.ts"],
          fencePaths: [],
          evidence: "host",
        },
        navigation: { surroundings: ["src/auth"] },
        pins: {},
      } as never,
      budget,
      requireQualityFloor: true,
    });
    expect(result.brief.filesRead.length).toBeGreaterThanOrEqual(2);
    expect(result.quality.ok).toBe(true);
    expect(result.reasonCodes).toContain("discovery_pass_compiled");
  });

  it("enforceDiscoveryQualityFloor fails thin required passes", () => {
    const thin = enforceDiscoveryQualityFloor({
      brief: {
        filesRead: [{ path: "package.json", reason: "noise" }],
        proposedChangeSurfaces: [],
        confidence: "low",
      },
      requireFloor: true,
    });
    expect(thin.ok).toBe(false);
    expect(thin.reasonCodes).toContain("discovery_quality_insufficient_reads");

    const waived = enforceDiscoveryQualityFloor({
      brief: {
        filesRead: [],
        proposedChangeSurfaces: [],
        confidence: "low",
      },
      requireFloor: false,
    });
    expect(waived.ok).toBe(true);
  });

  it("emitPlanPhaseTelemetry records budgets and discovery flags", () => {
    const budget = resolveDiscoveryPassBudget("medium", 80_000);
    const tel = emitPlanPhaseTelemetry({
      band: "standard",
      contextWindowTokens: 80_000,
      discoveryBudget: budget,
      planBudget: { maxModelCalls: 8, maxToolCalls: 24 },
      executeBudget: { maxModelCalls: 16, maxToolCalls: 48 },
      grantMaxToolCalls: 32,
      discoveryRan: true,
      discoveryQualityOk: true,
    });
    expect(tel.stage).toBe("plan_phase");
    expect(tel.discoveryBudget?.maxFileReads).toBe(budget.maxFileReads);
    expect(tel.reasonCodes).toContain("plan_telemetry_emitted");
    expect(tel.reasonCodes).toContain("telemetry_band_standard");
  });

  it("buildBriefcaseViaPC tools ⊆ grant and marks PC reason", () => {
    const decision = sampleDecision();
    const bundle = buildFullContextBundle({
      route: "plan",
      grantProfile: "read",
      projectRulesText: "prefer pnpm",
      skillInstructions: ["skill:auth"],
      taskListPresent: true,
    });
    const brief = buildBriefcaseViaPC({
      message: "plan the login fix",
      grant: {
        allowedTools: ["read_file", "list_directory"],
        maximumWorkspaceEffect: "read",
      },
      decision,
      promptConstruction: createPromptConstructionPort(),
      contextBundle: bundle,
      taskList: sampleTaskList(),
      contextWindowTokens: 80_000,
    });
    expect(brief.reasonCodes).toContain("briefcase_via_prompt_construction");
    expect(brief.tools.every((t) => t === "read_file" || t === "list_directory")).toBe(
      true,
    );
    expect(brief.tools).not.toContain("apply_patch");
  });

  it("mapSketchToPromptConstructionInput carries planText from TaskList", () => {
    const input = mapSketchToPromptConstructionInput({
      message: "plan login",
      decision: sampleDecision(),
      taskList: sampleTaskList(),
    });
    expect(input.planText).toContain("t1:");
    expect(input.decision.route).toBe("plan");
    expect(input.tools?.every((t) => t.name === "read_file" || t.name === "list_directory")).toBe(
      true,
    );
  });

  it("mapSketchToPromptConstructionInput surfaces focus paths to the model", () => {
    const input = mapSketchToPromptConstructionInput({
      message: "explain this",
      decision: sampleDecision(),
      contextBundle: {
        schemaVersion: 1,
        summary: "focus=packages/checks",
        focusPaths: ["packages/checks", "apps/desktop"],
        route: "repository_answer",
        grantProfile: "readonly",
        enrichMode: "full",
        reasonCodes: [],
      },
    });
    expect(input.instructions?.environment?.[0]?.content).toContain(
      "packages/checks",
    );
    expect(input.instructions?.environment?.[0]?.content).toContain(
      "Other focus (not pins)",
    );
    expect(input.repositoryContext?.blocks.some((b) => b.relativePath === "packages/checks")).toBe(
      true,
    );
  });

  it("mapSketch labels only pinnedPaths as user pins", () => {
    const input = mapSketchToPromptConstructionInput({
      message: "explain this",
      decision: sampleDecision(),
      contextBundle: {
        schemaVersion: 1,
        summary: "pinned=cases",
        focusPaths: ["cases", "apps/desktop/src/a.ts"],
        pinnedPaths: ["cases"],
        route: "diagnose",
        grantProfile: "readonly",
        enrichMode: "full",
        reasonCodes: [],
      },
    });
    const env = input.instructions?.environment?.[0]?.content ?? "";
    expect(env).toContain("User pinned these paths");
    expect(env).toContain("- cases");
    expect(env).toContain("Other focus (not pins)");
    expect(env).toContain("apps/desktop/src/a.ts");
  });

  it("plan pipeline emits discovery + telemetry on plan mode", async () => {
    const result = await runThroughPlanPipeline({
      start: {
        message:
          "plan a careful refactor of packages/v8/src/runtime/helpers/plan discovery",
        contextWindowTokens: 80_000,
        focusedFile: "packages/v8/src/runtime/helpers/plan/index.ts",
      },
      mode: "plan",
      runId: "discover-tel-1",
    });
    expect(result.planPipeline.ran).toBe(true);
    expect(result.planPipeline.discoveryBudget).toBeDefined();
    expect(result.planPipeline.telemetry?.stage).toBe("plan_phase");
    expect(result.planPipeline.reasonCodes).toContain("plan_telemetry_emitted");
  });
});
