import { describe, expect, it } from "vitest";

import { WORKING_SET_MARKER } from "../../../../modules/task-list";

import { estimateStickyMutableChars } from "../estimateStickyMutableChars";

describe("estimateStickyMutableChars", () => {
  it("counts system and early transcript as sticky", () => {
    const estimate = estimateStickyMutableChars([
      { role: "system", content: "sys".repeat(10) },
      { role: "user", content: "ask".repeat(10) },
      { role: "assistant", content: "ok" },
    ]);
    expect(estimate.stickyChars).toBeGreaterThan(0);
    expect(estimate.mutableChars).toBe(0);
    expect(estimate.workingSetChars).toBe(0);
  });

  it("counts working set as mutable", () => {
    const ws = `${WORKING_SET_MARKER}\n## Checklist\nx\n</working_set>`;
    const estimate = estimateStickyMutableChars([
      { role: "system", content: "system prompt" },
      { role: "user", content: "please implement" },
      { role: "user", content: ws },
    ]);
    expect(estimate.workingSetChars).toBe(ws.length);
    expect(estimate.mutableChars).toBe(ws.length);
    expect(estimate.stickyChars).toBe(
      "system prompt".length + "please implement".length,
    );
  });

  it("counts trailing recovery prompts after working set as mutable", () => {
    const ws = `${WORKING_SET_MARKER}\nlive\n</working_set>`;
    const recovery = "Verification failed. Call apply_patch now.";
    const estimate = estimateStickyMutableChars([
      { role: "system", content: "sys" },
      { role: "user", content: ws },
      { role: "user", content: recovery },
    ]);
    expect(estimate.mutableChars).toBe(ws.length + recovery.length);
    expect(estimate.stickyChars).toBe("sys".length);
  });
});
