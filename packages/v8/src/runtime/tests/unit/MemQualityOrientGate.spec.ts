import { describe, expect, it } from "vitest";

import {
  InMemoryMemoryStore,
  MEMORY_SCHEMA_VERSION,
  MemoryPipeline,
} from "../../../modules/memory";
import { createMemoryPipelineCommit } from "../../adapters/memory/CreateMemoryPipelineCommit";
import { buildFinishMemoryContent } from "../../helpers/memory/BuildFinishMemoryContent";
import {
  commitRuntimeMemory,
  commitRuntimeMemoryAsync,
} from "../../helpers/memory/CommitRuntimeMemory";
import { enforcePlanQuality } from "../../helpers/plan/EnforcePlanQuality";
import { resolveOrientDepth } from "../../helpers/orient/ResolveOrientDepth";

describe("S11-MEM / S3A-QUALITY / S1-GATE", () => {
  it("resolveOrientDepth lights ask/compact and heavies agent/standard", () => {
    expect(resolveOrientDepth({ mode: "ask" }).depth).toBe("light");
    expect(
      resolveOrientDepth({ mode: "agent", windowBand: "compact" }).depth,
    ).toBe("light");
    expect(
      resolveOrientDepth({ mode: "agent", windowBand: "standard" }).depth,
    ).toBe("heavy");
    expect(
      resolveOrientDepth({ mode: "plan", windowBand: "wide" }).maxMemory,
    ).toBeGreaterThan(
      resolveOrientDepth({ mode: "ask", windowBand: "wide" }).maxMemory,
    );
  });

  it("forces heavy enrich for repository_answer even in ask mode", () => {
    const depth = resolveOrientDepth({
      mode: "ask",
      route: "repository_answer",
    });
    expect(depth.depth).toBe("heavy");
    expect(depth.reasonCodes).toContain("orient_repo_required");
  });

  it("enforcePlanQuality rejects vague change steps without targets", () => {
    const bad = enforcePlanQuality({
      objective: "Fix login",
      planningDepth: "visible",
      phases: [
        {
          name: "Change",
          steps: [
            {
              intent: "fix it",
              actionSummary: "make it work",
              targetRefs: ["the relevant files"],
            },
          ],
        },
      ],
      verification: { checks: ["tests"] },
    });
    expect(bad.ok).toBe(false);
    expect(bad.reasonCodes.some((c) => c.includes("plan_quality"))).toBe(true);

    const good = enforcePlanQuality({
      objective: "Fix login null crash",
      planningDepth: "visible",
      phases: [
        {
          name: "Change",
          steps: [
            {
              intent: "Guard Login submit",
              actionSummary: "Add null check before submit in Login.ts",
              targetRefs: ["src/auth/Login.ts"],
            },
          ],
        },
      ],
      verification: { checks: ["vitest run src/auth"] },
    });
    expect(good.ok).toBe(true);
    expect(good.reasonCodes).toContain("plan_quality_passed");
  });

  it("commitRuntimeMemoryAsync persists via MemoryPipeline port", async () => {
    const store = new InMemoryMemoryStore();
    const pipeline = new MemoryPipeline({ store });
    const port = createMemoryPipelineCommit({
      pipeline,
      defaultWorkspaceId: "ws-test",
    });

    const skipped = commitRuntimeMemory({
      mode: "ask",
      status: "completed",
      route: "execute",
    });
    expect(skipped.committed).toBe(false);

    const committed = await commitRuntimeMemoryAsync({
      mode: "agent",
      status: "completed",
      route: "execute",
      commitPort: port,
      objective: "Patch Login null guard",
      answerSummary: "Added early return",
      changedPaths: ["src/auth/Login.ts"],
      hadMutations: true,
    });
    expect(committed.committed).toBe(true);
    expect(committed.reasonCodes).toContain("memory_commit_module");
    expect(committed.memoryId).toBeTruthy();
    expect(store.list().length).toBeGreaterThanOrEqual(1);
  });

  it("buildFinishMemoryContent stays short and path-scoped", () => {
    const text = buildFinishMemoryContent({
      route: "execute",
      objective: "Fix crash",
      changedPaths: ["a.ts", "b.ts"],
      verifyStatus: "passed",
    });
    expect(text).toContain("route=execute");
    expect(text).toContain("a.ts");
    expect(text.length).toBeLessThan(400);
  });

  it("memory commit schema version is module-owned", () => {
    expect(MEMORY_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });
});
