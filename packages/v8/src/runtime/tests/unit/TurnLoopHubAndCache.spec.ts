import { describe, expect, it } from "vitest";

import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { scriptedModelPort } from "../../adapters/model/ScriptedModelPort";
import { executeViaCallback } from "../../adapters/tools/ExecuteViaCallback";
import { runThroughTurnLoop } from "../../flow/RunThroughTurnLoop";
import {
  attachHandoffsToCheckpointPayload,
  evaluateAfterToolGate,
  evaluateOnBudgetGate,
  resolveBudgetHardWall,
  ToolCallCache,
} from "../../index";
import { InMemoryGateCheckpointStore } from "../../helpers/gates";
import { saveRuntimeGateCheckpoint } from "../../helpers/checkpoint";
import { StoreManager } from "../../helpers/store";

describe("S11-LOOP / S11-CACHE-TOOL / S13-CHECKPOINT", () => {
  it("evaluateAfterToolGate suspends mutate under every_mutation via hub", () => {
    const verdict = evaluateAfterToolGate({
      runId: "r1",
      effect: "mutate",
      grant: {
        allowedTools: ["apply_patch"],
        maximumWorkspaceEffect: "write",
        approvalMode: "every_mutation",
      },
    });
    expect(verdict?.action).toBe("suspend");
    expect(verdict?.kind).toBe("mutation_approval_required");
  });

  it("evaluateAfterToolGate expands on path_out_of_scope deny", () => {
    const verdict = evaluateAfterToolGate({
      runId: "r2",
      effect: "read",
      grant: { allowedTools: ["read_file"], approvalMode: "never" },
      denyReason: "path_out_of_scope",
    });
    expect(verdict?.kind).toBe("grant_expansion_required");
  });

  it("resolveBudgetHardWall + on_budget hub", () => {
    expect(
      resolveBudgetHardWall({ toolCallCount: 5, maxToolCalls: 5 }),
    ).toBe(true);
    expect(
      resolveBudgetHardWall({
        toolCallCount: 1,
        wallTimeSoftMs: 100,
        elapsedMs: 250,
      }),
    ).toBe(true);
    const verdict = evaluateOnBudgetGate({
      runId: "r3",
      budgetHardWall: true,
    });
    expect(verdict?.kind).toBe("continue_required");
  });

  it("ToolCallCache invalidates content on mutate paths", () => {
    const cache = new ToolCallCache();
    cache.setContent(
      "read_file",
      { path: "src/a.ts" },
      { toolId: "read_file", ok: true, paths: ["src/a.ts"] },
    );
    cache.setContent(
      "read_file",
      { path: "src/b.ts" },
      { toolId: "read_file", ok: true, paths: ["src/b.ts"] },
    );
    expect(cache.contentSize()).toBe(2);
    expect(cache.invalidateContent(["src/a.ts"])).toBe(1);
    expect(cache.getByContent("read_file", { path: "src/b.ts" })?.ok).toBe(
      true,
    );
    expect(cache.getByContent("read_file", { path: "src/a.ts" })).toBeUndefined();
  });

  it("simulated mutate still suspends via hub gate kind", async () => {
    const result = await runThroughTurnLoop({
      start: {
        message: "refactor packages/v8/src/runtime helpers for clarity",
      },
      mode: "agent",
      runId: "loop-hub-1",
      simulatedToolCalls: [{ toolId: "apply_patch", effect: "mutate" }],
    });
    expect(result.turnLoop?.gate?.kind).toBe("mutation_approval_required");
    expect(result.turnLoop?.reasonCodes).toContain("turn_loop_hub_gates");
  });

  it("ports path: read hits cache on second identical call", async () => {
    let executes = 0;
    const runtime = composeRuntime({
      model: scriptedModelPort([
        {
          text: "",
          toolCalls: [
            {
              callId: "c1",
              toolId: "read_file",
              args: { path: "src/a.ts" },
            },
            {
              callId: "c2",
              toolId: "read_file",
              args: { path: "src/a.ts" },
            },
          ],
          reasonCodes: ["scripted_read_dup"],
        },
        {
          text: "done",
          toolCalls: [],
          reasonCodes: ["scripted_done"],
        },
      ]),
      tools: executeViaCallback(async () => {
        executes += 1;
        return { ok: true, output: { text: "ok" } };
      }),
    });

    const result = await runtime.start({
      start: {
        message: "how does packages/v8/src/runtime StoreManager work?",
      },
      mode: "ask",
      runId: "cache-1",
    });
    expect(result.status).toBe("completed");
    // Second identical read in the same model turn is served from ToolCallCache.
    expect(executes).toBe(1);
  });

  it("attachHandoffsToCheckpointPayload stamps task handoffs", async () => {
    const store = StoreManager.create("cp-1");
    store.setSlice("taskList", {
      schemaVersion: 1,
      source: "plan",
      items: [{ id: "t1", title: "A", status: "active" }],
    });
    store.setSlice("taskHandoffs", [
      {
        fromTaskId: "t0",
        toTaskId: "t1",
        doneSummary: "done prior",
      },
    ]);
    const payload = attachHandoffsToCheckpointPayload({
      payload: { toolId: "apply_patch" },
      store,
    });
    expect(payload.handoffCheckpoint).toBe(true);
    expect(payload.taskHandoffs).toHaveLength(1);

    const cps = new InMemoryGateCheckpointStore();
    const saved = await saveRuntimeGateCheckpoint(
      { checkpointStore: cps },
      {
        runId: "cp-1",
        requestId: "cp-1",
        gateKind: "mutation_approval_required",
        storeSnapshot: store.snapshot(),
        liveStore: store,
      },
    );
    expect(saved).toBe(true);
    const loaded = await cps.load?.("cp-1");
    expect(loaded?.reasonCodes).toContain("checkpoint_handoffs_attached");
    expect(loaded?.payload.handoffCheckpoint).toBe(true);
  });
});
