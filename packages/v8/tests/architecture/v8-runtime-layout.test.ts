import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { listTypeScriptFiles, toRepoPath, v8SrcRoot } from "./support/v8Sources";

const runtimeRoot = join(v8SrcRoot, "runtime");

/** Prefer ≪300; hard Mitii cap is 600 — fail early on fat skeleton files. */
const MAX_RUNTIME_SKELETON_LINES = 300;

const REQUIRED_PATHS = [
  "README.md",
  "index.ts",
  "constants.ts",
  "defaults.ts",
  "flow/order.ts",
  "flow/Pipeline.ts",
  "helpers/store/Store.ts",
  "helpers/store/StoreManager.ts",
  "helpers/store/GetStoreSlice.ts",
  "helpers/store/SetStoreSlice.ts",
  "helpers/gates/README.md",
  "helpers/gates/EvaluateGates.ts",
  "helpers/gates/ApplyGate.ts",
  "helpers/gates/catalog.ts",
  "helpers/gates/predicates/RequireClarificationAfterPlan.ts",
  "helpers/tool-journal/ToolInvocationRecord.ts",
  "helpers/checkpoint/README.md",
  "tools/README.md",
  "adapters/compose/ComposeRuntime.ts",
  "adapters/bridge/AgentRunHandleFromRuntimeResult.ts",
  "adapters/bridge/WrapEngineWithRuntimeShell.ts",
  "adapters/bridge/AdaptEngineResumeToRuntime.ts",
  "contracts/index.ts",
] as const;

describe("v8 runtime layout (rewrite P0)", () => {
  it("creates the runtime/ map from ENGINE_REWRITE_PLAN", () => {
    expect(existsSync(runtimeRoot)).toBe(true);
    for (const rel of REQUIRED_PATHS) {
      expect(existsSync(join(runtimeRoot, rel)), rel).toBe(true);
    }
  });

  it("keeps runtime skeleton TypeScript files small and VerbNoun-shaped", () => {
    const offenders: string[] = [];
    for (const file of listTypeScriptFiles(runtimeRoot)) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
      if (lines > MAX_RUNTIME_SKELETON_LINES) {
        offenders.push(`${toRepoPath(file)}:${lines}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("bans grab-bag filenames under runtime/", () => {
    const banned = /(?:^|\/)(utils|misc|helpers2|common|shared)\.ts$/i;
    const hits = listTypeScriptFiles(runtimeRoot)
      .map(toRepoPath)
      .filter((rel) => banned.test(rel));
    expect(hits).toEqual([]);
  });

  it("does not let modules import runtime/ (dependency direction)", () => {
    const modulesRoot = join(v8SrcRoot, "modules");
    const pattern = /from\s+['"][^'"]*runtime\//;
    const violations: string[] = [];
    for (const file of listTypeScriptFiles(modulesRoot)) {
      const text = readFileSync(file, "utf8");
      if (pattern.test(text)) {
        violations.push(toRepoPath(file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("exposes intentional runtime/index.ts exports only", () => {
    const index = readFileSync(join(runtimeRoot, "index.ts"), "utf8");
    const planSurface = readFileSync(
      join(runtimeRoot, "surface/PlanDiscoverStore.ts"),
      "utf8",
    );
    const verifySurface = readFileSync(
      join(runtimeRoot, "surface/VerifyGatesAdapters.ts"),
      "utf8",
    );
    const surface = `${index}\n${planSurface}\n${verifySurface}`;
    expect(surface).toContain("composeRuntime");
    expect(surface).toContain("StoreManager");
    expect(index).toContain("RUNTIME_FLOW_STEP_IDS");
    expect(index).toContain("runThroughTurnLoop");
    expect(surface).toContain("selectRouteBody");
    expect(index).toContain("checkToolAgainstGrant");
    expect(surface).toContain("wrapEngineWithRuntimeShell");
    expect(surface).toContain("createAgentRunHandleFromRuntimeResult");
    // Star re-exports only from intentional surface/ barrels (keeps index ≤300).
    const starExports = index.match(/export \* from\s+['"][^'"]+['"]/g) ?? [];
    expect(starExports.every((line) => line.includes("./surface/"))).toBe(true);
  });

  it("keeps engine/ present until cutover (dual-run during rewrite)", () => {
    expect(existsSync(join(v8SrcRoot, "engine/v8-engine"))).toBe(true);
    expect(existsSync(join(v8SrcRoot, "engine/tool-runtime"))).toBe(true);
    const helperDirs = readdirSync(join(runtimeRoot, "helpers")).filter(
      (name) => statSync(join(runtimeRoot, "helpers", name)).isDirectory(),
    );
    expect(helperDirs.sort()).toEqual(
      expect.arrayContaining([
        "store",
        "gates",
        "checkpoint",
        "tool-journal",
        "routes",
        "plan",
        "plan-discovery",
        "rails",
      ]),
    );
  });

  it("routes tool grant allowlist through runtime/tools (P8)", () => {
    const validateGrant = readFileSync(
      join(v8SrcRoot, "engine/tool-runtime/actions/ValidateGrant.ts"),
      "utf8",
    );
    expect(validateGrant).toContain("checkToolAgainstGrant");
    expect(validateGrant).toMatch(/from\s+["'][^"']*runtime\/tools/);
  });

  it("shims discovery budgets to window-budget (P3/P8)", () => {
    const shim = readFileSync(
      join(
        v8SrcRoot,
        "engine/v8-engine/modules/plan-discovery/discoveryBudgets.ts",
      ),
      "utf8",
    );
    expect(shim).toContain("window-budget");
    expect(shim).toContain("resolveDiscoveryPassBudget");
  });

  it("routes engine suspends through saveSuspendedRun (no raw checkpointStore.save)", () => {
    const engineRoot = join(v8SrcRoot, "engine/v8-engine");
    const pattern = /checkpointStore(?:!)?\.save\s*\(/;
    const violations: string[] = [];
    for (const file of listTypeScriptFiles(engineRoot)) {
      if (file.includes(`${join("helpers", "SaveSuspendedRun")}`)) continue;
      const text = readFileSync(file, "utf8");
      if (pattern.test(text)) {
        violations.push(toRepoPath(file));
      }
    }
    expect(violations).toEqual([]);
  });
});
