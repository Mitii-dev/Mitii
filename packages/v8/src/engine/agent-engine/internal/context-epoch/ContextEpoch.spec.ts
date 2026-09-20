import { describe, expect, it } from "vitest";

import {
  CONTEXT_EPOCH_SOURCE_KEYS,
  extractBaselineSystemText,
  hashContextText,
  initializeContextEpoch,
  isMidConversationSystemContent,
  markContextEpochForReplacement,
  reconcileContextEpoch,
  replaceContextEpoch,
  wrapMidConversationSystemText,
} from "./index";
import {
  admitContextEpoch,
  pinBaselineSystemMessage,
  stripMidConversationSystemMessages,
} from "./admitContextEpoch";

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

  it("emits updated for non-baseline source changes with mid-conversation text", () => {
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
      expect(result.midConversationText.length).toBeGreaterThan(0);
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

  it("extracts the first non-empty non-mid system message as baseline text", () => {
    expect(
      extractBaselineSystemText([
        { role: "user", content: "hi" },
        { role: "system", content: "  You are Mitii.  " },
      ]),
    ).toBe("  You are Mitii.  ");
    expect(
      extractBaselineSystemText([
        {
          role: "system",
          content: wrapMidConversationSystemText("skills changed"),
        },
        { role: "system", content: "baseline" },
      ]),
    ).toBe("baseline");
  });

  it("recognizes marked mid-conversation system content", () => {
    const wrapped = wrapMidConversationSystemText("Available skills are now: a.");
    expect(isMidConversationSystemContent(wrapped)).toBe(true);
    expect(isMidConversationSystemContent("You are Mitii.")).toBe(false);
  });
});

describe("admitContextEpoch (OpenCode Safe Provider-Turn Boundary)", () => {
  const observed = {
    route: "repository_answer",
    planningDepth: "none",
    skillIds: ["skill-a"] as string[],
    ruleIds: ["rule-1"] as string[],
    environmentIds: [] as string[],
    memoryIds: [] as string[],
  };

  it("initializes, pins baseline, and reuses it when skills update mid-turn", () => {
    const messages = [
      { role: "system" as const, content: "You are Mitii.\nExecution route: repository_answer." },
      { role: "user" as const, content: "hello" },
    ];

    const init = admitContextEpoch({
      runId: "run_admit",
      messages,
      previous: undefined,
      compactionApplied: false,
      nowMs: 10,
      observed,
    });
    expect(init?.epoch.baselineSystemText).toContain("You are Mitii.");
    expect(init?.pinBaseline).toBe(init?.epoch.baselineSystemText);

    messages[0] = {
      role: "system",
      content: "MUTATED SYSTEM SHOULD BE REPINNED",
    };

    const updated = admitContextEpoch({
      runId: "run_admit",
      messages,
      previous: init!.epoch,
      compactionApplied: false,
      nowMs: 20,
      observed: { ...observed, skillIds: ["skill-a", "skill-b"] },
    });
    expect(updated?.midConversationText).toBeTruthy();
    expect(updated?.pinBaseline).toBe(init!.epoch.baselineSystemText);
    expect(updated?.stripPriorMidConversation).toBe(false);

    pinBaselineSystemMessage(messages, updated!.pinBaseline!);
    appendAndStrip(messages, updated!.midConversationText!);
    expect(messages[0]?.content).toBe(init!.epoch.baselineSystemText);
    expect(
      messages.some(
        (message) =>
          message.role === "system" &&
          isMidConversationSystemContent(message.content),
      ),
    ).toBe(true);
  });

  it("strips mid-conversation updates when compaction forces replace", () => {
    const baseline = "You are Mitii.\nbaseline epoch 1";
    const messages = [
      { role: "system" as const, content: baseline },
      { role: "user" as const, content: "hi" },
      {
        role: "system" as const,
        content: wrapMidConversationSystemText("skills changed"),
      },
    ];

    const init = admitContextEpoch({
      runId: "run_replace",
      messages,
      previous: undefined,
      compactionApplied: false,
      nowMs: 1,
      observed,
    });

    const replaced = admitContextEpoch({
      runId: "run_replace",
      messages,
      previous: init!.epoch,
      compactionApplied: true,
      nowMs: 2,
      observed,
    });
    expect(replaced?.stripPriorMidConversation).toBe(true);
    expect(replaced?.epoch.epochId).not.toBe(init!.epoch.epochId);

    const removed = stripMidConversationSystemMessages(messages);
    expect(removed).toBe(1);
    pinBaselineSystemMessage(messages, replaced!.pinBaseline!);
    expect(messages.every((m) => !isMidConversationSystemContent(m.content))).toBe(
      true,
    );
  });

  it("forces replace when route changes (baseline-incompatible)", () => {
    const messages = [
      { role: "system" as const, content: "You are Mitii." },
      { role: "user" as const, content: "hi" },
    ];
    const init = admitContextEpoch({
      runId: "run_route",
      messages,
      previous: undefined,
      compactionApplied: false,
      nowMs: 1,
      observed,
    });
    const next = admitContextEpoch({
      runId: "run_route",
      messages,
      previous: init!.epoch,
      compactionApplied: false,
      nowMs: 2,
      observed: { ...observed, route: "agent" },
    });
    expect(next?.stripPriorMidConversation).toBe(true);
    expect(next?.epoch.epochId).not.toBe(init!.epoch.epochId);
  });
});

function appendAndStrip(
  messages: { role: "system" | "user"; content: string }[],
  mid: string,
): void {
  messages.push({ role: "system", content: mid });
}
