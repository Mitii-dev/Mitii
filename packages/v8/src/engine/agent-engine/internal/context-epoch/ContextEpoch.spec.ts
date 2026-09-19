import { describe, expect, it } from "vitest";

import {
  CONTEXT_EPOCH_SOURCE_KEYS,
  extractBaselineSystemText,
  hashContextText,
  initializeContextEpoch,
  markContextEpochForReplacement,
  reconcileContextEpoch,
  replaceContextEpoch,
} from "./index";

describe("ContextEpoch formulae (OpenCode discipline)", () => {
  it("initializes an immutable baseline with hashed sources", () => {
    const epoch = initializeContextEpoch({
      runId: "run_1",
      baselineSystemText: "You are Mitii.\nExecution route: repository_answer.",
      sources: {
        [CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem]:
          "You are Mitii.\nExecution route: repository_answer.",
        [CONTEXT_EPOCH_SOURCE_KEYS.route]: "repository_answer",
      },
      nowMs: 1_000,
    });
    expect(epoch.baselineHash).toBe(
      hashContextText(epoch.baselineSystemText),
    );
    expect(epoch.replacementRequested).toBe(false);
    expect(epoch.structuredSnapshot.sources[CONTEXT_EPOCH_SOURCE_KEYS.route]).toBe(
      hashContextText("repository_answer"),
    );
  });

  it("reports unchanged when observed sources match the snapshot", () => {
    const epoch = initializeContextEpoch({
      runId: "run_1",
      baselineSystemText: "baseline",
      sources: {
        [CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem]: "baseline",
        [CONTEXT_EPOCH_SOURCE_KEYS.route]: "ask",
      },
      nowMs: 1,
    });
    const result = reconcileContextEpoch({
      epoch,
      observedSources: {
        [CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem]: "baseline",
        [CONTEXT_EPOCH_SOURCE_KEYS.route]: "ask",
      },
      baselineAvailable: true,
    });
    expect(result.kind).toBe("unchanged");
  });

  it("emits updated for non-baseline source changes", () => {
    const epoch = initializeContextEpoch({
      runId: "run_1",
      baselineSystemText: "baseline",
      sources: {
        [CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem]: "baseline",
        [CONTEXT_EPOCH_SOURCE_KEYS.skills]: "skill-a",
      },
      nowMs: 1,
    });
    const result = reconcileContextEpoch({
      epoch,
      observedSources: {
        [CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem]: "baseline",
        [CONTEXT_EPOCH_SOURCE_KEYS.skills]: "skill-a,skill-b",
      },
      baselineAvailable: true,
    });
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.changedSourceKeys).toContain(
        CONTEXT_EPOCH_SOURCE_KEYS.skills,
      );
    }
  });

  it("requests replace when baseline-affecting sources change", () => {
    const epoch = initializeContextEpoch({
      runId: "run_1",
      baselineSystemText: "baseline-a",
      sources: {
        [CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem]: "baseline-a",
        [CONTEXT_EPOCH_SOURCE_KEYS.route]: "ask",
      },
      nowMs: 1,
    });
    const result = reconcileContextEpoch({
      epoch,
      observedSources: {
        [CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem]: "baseline-b",
        [CONTEXT_EPOCH_SOURCE_KEYS.route]: "agent",
      },
      baselineAvailable: true,
    });
    expect(result.kind).toBe("replace_ready");
  });

  it("replaces after compaction with a fresh epoch id and baseline", () => {
    const previous = markContextEpochForReplacement(
      initializeContextEpoch({
        runId: "run_1",
        baselineSystemText: "old baseline",
        sources: {
          [CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem]: "old baseline",
        },
        nowMs: 1,
      }),
    );
    const next = replaceContextEpoch({
      previous,
      baselineSystemText: "new baseline after compaction",
      sources: {
        [CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem]:
          "new baseline after compaction",
      },
      nowMs: 2,
    });
    expect(next.epochId).not.toBe(previous.epochId);
    expect(next.baselineSystemText).toContain("compaction");
    expect(next.replacementRequested).toBe(false);
  });

  it("extracts the first non-empty system message as baseline text", () => {
    expect(
      extractBaselineSystemText([
        { role: "user", content: "hi" },
        { role: "system", content: "  You are Mitii.  " },
      ]),
    ).toBe("  You are Mitii.  ");
  });
});
