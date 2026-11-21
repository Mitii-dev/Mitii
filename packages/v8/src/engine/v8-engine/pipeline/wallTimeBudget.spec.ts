import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decideWallTimeDeadline,
  resolveWallTimeReserveMs,
} from "../actions/resolveWallTimeDeadline";
import { RunBudgetTracker } from "../internal/RunBudget";
import { V8EnginePipeline } from "./V8EnginePipeline";
import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  ScriptedLlmPort,
} from "../tests/fixtures/stubs";
import type { ModelEvent, ModelRequest } from "../../../modules/model-gateway";

describe("resolveWallTimeReserveMs", () => {
  it("reserves ~15% clamped to [15s, 90s]", () => {
    expect(resolveWallTimeReserveMs(300_000)).toBe(45_000);
    expect(resolveWallTimeReserveMs(900_000)).toBe(90_000);
    expect(resolveWallTimeReserveMs(60_000)).toBe(15_000);
  });

  it("never reserves more than half of a tiny budget", () => {
    expect(resolveWallTimeReserveMs(10_000)).toBe(5_000);
    expect(resolveWallTimeReserveMs(0)).toBe(0);
  });
});

describe("decideWallTimeDeadline", () => {
  const base = {
    maxWallTimeMs: 300_000,
    mutationApplied: false,
    mutationRequired: true,
    alreadyNudged: false,
  };

  it("continues while outside the reserve", () => {
    expect(decideWallTimeDeadline({ ...base, remainingMs: 120_000 })).toBe(
      "continue",
    );
  });

  it("finalizes after a landed mutation inside the reserve", () => {
    expect(
      decideWallTimeDeadline({
        ...base,
        remainingMs: 30_000,
        mutationApplied: true,
      }),
    ).toBe("finalize_after_mutation");
  });

  it("nudges once when a mutation is still required", () => {
    expect(decideWallTimeDeadline({ ...base, remainingMs: 30_000 })).toBe(
      "wrap_up_nudge",
    );
    expect(
      decideWallTimeDeadline({
        ...base,
        remainingMs: 30_000,
        alreadyNudged: true,
      }),
    ).toBe("continue");
  });

  it("does not nudge read-only runs", () => {
    expect(
      decideWallTimeDeadline({
        ...base,
        remainingMs: 30_000,
        mutationRequired: false,
      }),
    ).toBe("continue");
  });
});

describe("RunBudgetTracker wall time", () => {
  it("reports remaining wall time net of user-wait time", () => {
    const budget = new RunBudgetTracker(
      {
        unlimited: false,
        maxModelCalls: 10,
        maxToolCalls: 10,
        maxLoopIterations: 10,
        maxWallTimeMs: 100_000,
      },
      1_000,
      undefined,
      20_000,
    );
    // elapsed = now - started - waited = 31_000 - 1_000 - 20_000 = 10_000
    expect(budget.remainingWallMs(31_000)).toBe(90_000);
    expect(budget.isNearWallDeadline(31_000)).toBe(false);
    // elapsed = 111_000 - 1_000 - 20_000 = 90_000 → 10_000 left ≤ 15_000 reserve
    expect(budget.isNearWallDeadline(111_000)).toBe(true);
    expect(budget.remainingWallMs(500_000)).toBe(0);
  });
});

const startInput = {
  schemaVersion: 1 as const,
  workspaceRoot: "/repo",
  budget: {
    unlimited: false,
    maxModelCalls: 32,
    maxToolCalls: 64,
    maxLoopIterations: 32,
    maxWallTimeMs: 10_000,
  },
  request: {
    sessionId: "sess_wall",
    mode: "agent" as const,
    userMessage: "Fix src/auth/login.spec.ts — apply_patch only that file.",
    workspace: { workspaceId: "ws_wall" },
    requestId: "req_wall_1",
  },
};

const patchCall = {
  id: "call_patch",
  name: "apply_patch",
  arguments: JSON.stringify({
    patches: [
      { path: "src/auth/login.spec.ts", oldText: "old", newText: "new" },
    ],
  }),
};

const readCall = {
  id: "call_read",
  name: "read_file",
  arguments: JSON.stringify({ path: "src/auth/login.spec.ts" }),
};

/** LLM whose every completed turn advances the mocked wall clock. */
class ClockAdvancingLlm extends ScriptedLlmPort {
  constructor(
    turns: ConstructorParameters<typeof ScriptedLlmPort>[0],
    private readonly advance: () => void,
  ) {
    super(turns);
  }

  public override async *complete(
    request: ModelRequest,
    context?: { abortSignal?: AbortSignal },
  ): AsyncIterable<ModelEvent> {
    yield* super.complete(request, context);
    this.advance();
  }
}

function engineWith(llm: ScriptedLlmPort) {
  return new V8EnginePipeline(
    createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["apply_patch", "read_file", "run_readonly_command"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm,
      toolResults: {
        apply_patch: {
          status: "succeeded",
          output: {
            checkpointId: "cp_wall_1",
            changedFiles: ["src/auth/login.spec.ts"],
          },
        },
      },
    }),
  );
}

describe("model loop near the host wall-time budget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finalizes after the patch instead of starting another model turn", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const llm = new ClockAdvancingLlm(
      [
        { content: "Applying the fix.", toolCalls: [patchCall] },
        { content: "Extra turn that must never be requested." },
      ],
      () => {
        now += 6_000;
      },
    );

    const result = await engineWith(llm).start(startInput).result;

    expect(llm.requests).toHaveLength(1);
    expect(result.reasonCodes).toContain("wall_time_finalize_after_mutation");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.status).toBe("completed");
    expect(result.answer ?? "").not.toContain("Extra turn");
  });

  it("nudges once to patch when no mutation has landed yet", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const llm = new ClockAdvancingLlm(
      [
        { content: "Reading.", toolCalls: [readCall] },
        { content: "Patching.", toolCalls: [patchCall] },
        { content: "Done." },
      ],
      () => {
        now += 6_000;
      },
    );

    const result = await engineWith(llm).start(startInput).result;

    expect(result.reasonCodes).toContain("wall_time_wrap_up_nudge");
    expect(
      result.reasonCodes.filter((code) => code === "wall_time_wrap_up_nudge"),
    ).toHaveLength(1);
    const nudged = llm.requests[1]?.messages.some(
      (message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.includes("Time budget nearly exhausted"),
    );
    expect(nudged).toBe(true);
  });

  it("is a no-op with the default wall-time budget", async () => {
    const llm = new ScriptedLlmPort([
      { content: "Applying the fix.", toolCalls: [patchCall] },
      { content: "All done." },
    ]);
    const { budget: _budget, ...withoutBudget } = startInput;
    const result = await engineWith(llm).start(withoutBudget).result;

    expect(result.reasonCodes).not.toContain(
      "wall_time_finalize_after_mutation",
    );
    expect(result.reasonCodes).not.toContain("wall_time_wrap_up_nudge");
  });
});
