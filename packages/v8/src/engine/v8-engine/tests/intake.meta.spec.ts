/**
 * Intake meta + mode goldens — real RequestIntakePipeline via wired harness.
 */
import { describe, expect, it } from "vitest";

import {
  createWiredHarness,
  WIRED_WORKSPACE_ID,
} from "./fixtures/wiredHarness";

describe("v8-engine golden — intake meta + mode inject", () => {
  it("/stop short-circuits before understand with intake_meta_command", async () => {
    const { engine } = await createWiredHarness();
    let understandingCalls = 0;
    const original = engine as {
      start: typeof engine.start;
    };
    // Spy via deps is awkward on composed engine; assert terminal shape instead.
    void original;
    void understandingCalls;

    const result = await engine.start({
      schemaVersion: 1,
      workspaceRoot: "/workspace",
      request: {
        sessionId: "sess_intake_stop",
        mode: "agent",
        userMessage: "/stop",
        workspace: { workspaceId: WIRED_WORKSPACE_ID },
      },
    }).result;

    expect(result.status).toBe("cancelled");
    expect(result.reasonCodes).toContain("intake_complete");
    expect(result.reasonCodes).toContain("intake_meta_command");
    expect(result.reasonCodes).not.toContain("understanding_complete");
    expect(result.reasonCodes).not.toContain("decision_complete");
    expect(result.error?.code).toBe("cancelled");
    expect(result.warnings.some((w) => w.startsWith("meta_command:stop:"))).toBe(
      true,
    );
  });

  it("/compact completes as meta without model loop", async () => {
    const { engine } = await createWiredHarness({
      runTurns: [{ content: "should-not-run" }],
    });

    const result = await engine.start({
      schemaVersion: 1,
      workspaceRoot: "/workspace",
      request: {
        sessionId: "sess_intake_compact",
        mode: "agent",
        userMessage: "/compact",
        workspace: { workspaceId: WIRED_WORKSPACE_ID },
      },
    }).result;

    expect(result.status).toBe("completed");
    expect(result.answer).toBe("/compact");
    expect(result.reasonCodes).toContain("intake_meta_command");
    expect(result.reasonCodes).not.toContain("model_completed");
    expect(result.usage.modelCalls).toBe(0);
  });

  it("/plan strips slash and routes as plan mode", async () => {
    const { engine } = await createWiredHarness({
      understanding: {
        interactionIntent: "act",
        primaryTaskIntent: "feature",
        needsClarification: false,
      },
      runTurns: [{ content: "Here is the plan." }],
    });

    const result = await engine.start({
      schemaVersion: 1,
      workspaceRoot: "/workspace",
      request: {
        sessionId: "sess_intake_plan",
        mode: "agent",
        userMessage: "/plan redesign the auth flow in src/auth.ts",
        workspace: { workspaceId: WIRED_WORKSPACE_ID },
      },
    }).result;

    expect(result.reasonCodes).toContain("intake_complete");
    expect(result.reasonCodes).not.toContain("intake_meta_command");
    // ModeIntentPolicy pins plan → planning route, not mutation execute.
    expect(result.route).toBe("plan");
    expect(result.status).toBe("completed");
  });

  it("@path mention lands as artifact and tags intake_mentions_extracted", async () => {
    const { engine } = await createWiredHarness({
      understanding: {
        interactionIntent: "question",
        primaryTaskIntent: "question",
        needsClarification: false,
      },
      runTurns: [{ content: "Auth exports login()." }],
    });

    const result = await engine.start({
      schemaVersion: 1,
      workspaceRoot: "/workspace",
      request: {
        sessionId: "sess_intake_mention",
        mode: "ask",
        userMessage: "What does @src/auth.ts export?",
        workspace: { workspaceId: WIRED_WORKSPACE_ID },
      },
    }).result;

    expect(result.reasonCodes).toContain("intake_mentions_extracted");
    expect(result.status).toBe("completed");
  });
});
