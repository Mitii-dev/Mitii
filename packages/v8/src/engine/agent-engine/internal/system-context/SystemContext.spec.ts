import { describe, expect, it } from "vitest";

import {
  SYSTEM_CONTEXT_SOURCE_KEYS,
  SYSTEM_CONTEXT_UNAVAILABLE,
  composeMitiiSystemContext,
  initializeSystemContext,
  makeSystemContextSource,
  reconcileSystemContext,
  encodeJson,
  decodeJsonString,
} from "./index";

describe("SystemContext formulae (OpenCode discipline)", () => {
  it("initialize blocks when any source is unavailable", () => {
    const context = composeMitiiSystemContext({
      route: "ask",
      planningDepth: "none",
      skillIds: [],
      ruleIds: [],
      environmentIds: [],
      memoryIds: [],
      unavailableKeys: new Set([SYSTEM_CONTEXT_SOURCE_KEYS.skills]),
    });
    const result = initializeSystemContext(context, "baseline");
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.unavailableKeys).toContain(SYSTEM_CONTEXT_SOURCE_KEYS.skills);
    }
  });

  it("initialize freezes baseline override and encodes source snapshots", () => {
    const context = composeMitiiSystemContext({
      route: "repository_answer",
      planningDepth: "none",
      skillIds: ["s1"],
      ruleIds: ["r1"],
      environmentIds: [],
      memoryIds: ["m1"],
    });
    const result = initializeSystemContext(context, "FULL SYSTEM BASELINE");
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.generation.baseline).toBe("FULL SYSTEM BASELINE");
      expect(
        result.generation.snapshot[SYSTEM_CONTEXT_SOURCE_KEYS.skills]?.value,
      ).toBe(JSON.stringify(["s1"]));
    }
  });

  it("reconcile returns unchanged when sources match", () => {
    const observed = {
      route: "ask",
      planningDepth: "none",
      skillIds: ["a"],
      ruleIds: [],
      environmentIds: [],
      memoryIds: [],
    };
    const context = composeMitiiSystemContext(observed);
    const init = initializeSystemContext(context, "baseline");
    expect(init.kind).toBe("ready");
    if (init.kind !== "ready") {
      return;
    }
    const result = reconcileSystemContext({
      context,
      previous: init.generation.snapshot,
    });
    expect(result.kind).toBe("unchanged");
  });

  it("reconcile emits Updated mid-conversation text for skill changes", () => {
    const initial = composeMitiiSystemContext({
      route: "ask",
      planningDepth: "none",
      skillIds: ["a"],
      ruleIds: [],
      environmentIds: [],
      memoryIds: [],
    });
    const init = initializeSystemContext(initial, "baseline");
    expect(init.kind).toBe("ready");
    if (init.kind !== "ready") {
      return;
    }
    const next = composeMitiiSystemContext({
      route: "ask",
      planningDepth: "none",
      skillIds: ["a", "b"],
      ruleIds: [],
      environmentIds: [],
      memoryIds: [],
    });
    const result = reconcileSystemContext({
      context: next,
      previous: init.generation.snapshot,
    });
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.text).toContain("skills");
      expect(result.changedKeys).toContain(SYSTEM_CONTEXT_SOURCE_KEYS.skills);
    }
  });

  it("forceReplace yields ReplacementReady with fresh generation", () => {
    const context = composeMitiiSystemContext({
      route: "ask",
      planningDepth: "none",
      skillIds: [],
      ruleIds: [],
      environmentIds: [],
      memoryIds: [],
    });
    const init = initializeSystemContext(context, "old baseline");
    expect(init.kind).toBe("ready");
    if (init.kind !== "ready") {
      return;
    }
    const result = reconcileSystemContext({
      context,
      previous: init.generation.snapshot,
      forceReplace: true,
      baselineOverride: "new baseline after compaction",
    });
    expect(result.kind).toBe("replace_ready");
    if (result.kind === "replace_ready") {
      expect(result.generation.baseline).toBe("new baseline after compaction");
    }
  });

  it("stale-while-revalidate keeps prior snapshot when source is unavailable", () => {
    const initial = composeMitiiSystemContext({
      route: "ask",
      planningDepth: "none",
      skillIds: ["a"],
      ruleIds: [],
      environmentIds: [],
      memoryIds: [],
    });
    const init = initializeSystemContext(initial, "baseline");
    expect(init.kind).toBe("ready");
    if (init.kind !== "ready") {
      return;
    }
    const unavailable = composeMitiiSystemContext({
      route: "ask",
      planningDepth: "none",
      skillIds: ["a", "b"],
      ruleIds: [],
      environmentIds: [],
      memoryIds: [],
      unavailableKeys: new Set([SYSTEM_CONTEXT_SOURCE_KEYS.skills]),
    });
    const result = reconcileSystemContext({
      context: unavailable,
      previous: init.generation.snapshot,
    });
    expect(result.kind).toBe("unchanged");
  });

  it("makeSystemContextSource rejects empty baseline render on initialize", () => {
    const ctx = makeSystemContextSource({
      key: "test/empty",
      encode: encodeJson,
      decode: decodeJsonString,
      equivalent: (a, b) => a === b,
      load: () => "x",
      baseline: () => "",
      update: () => "u",
    });
    expect(() => initializeSystemContext(ctx)).toThrow(/empty baseline/);
  });

  it("exposes UNAVAILABLE symbol for loaders", () => {
    expect(SYSTEM_CONTEXT_UNAVAILABLE).toBeDefined();
  });
});
