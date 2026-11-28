import { describe, expect, it } from "vitest";

import { pushRuntimeProgressEvents } from "../../helpers/events/PushRuntimeProgressEvents";

describe("pushRuntimeProgressEvents prompt_ready budget", () => {
  it("attaches budget sections for Context Usage meters", () => {
    const events: unknown[] = [];
    pushRuntimeProgressEvents(
      { push: (event) => events.push(event) },
      {
        runId: "run_budget",
        at: "2026-11-27T00:00:00.000Z",
        phase: "prompt_ready",
        promptStatus: "complete",
        promptBudget: {
          contextWindowTokens: 128_000,
          outputReservedTokens: 8_000,
          inputBudgetTokens: 120_000,
          totalUsedTokens: 12_500,
          totalOmittedTokens: 0,
          totalTruncatedTokens: 0,
          withinLimits: true,
          sections: [
            {
              section: "system",
              allocatedTokens: 1_000,
              usedTokens: 400,
              omittedTokens: 0,
              truncatedTokens: 0,
            },
            {
              section: "tools",
              allocatedTokens: 4_000,
              usedTokens: 3_900,
              omittedTokens: 0,
              truncatedTokens: 0,
            },
            {
              section: "conversation",
              allocatedTokens: 40_000,
              usedTokens: 8_200,
              omittedTokens: 0,
              truncatedTokens: 0,
            },
          ],
        },
      },
    );

    const ready = events[0] as {
      type: string;
      budget?: {
        totalUsedTokens: number;
        sections: Array<{ section: string; usedTokens: number }>;
      };
    };
    expect(ready.type).toBe("prompt_ready");
    expect(ready.budget?.totalUsedTokens).toBe(12_500);
    expect(ready.budget?.sections.map((s) => s.section)).toEqual([
      "system",
      "tools",
      "conversation",
    ]);
  });
});
