/**
 * Intake meta + session-control goldens — real RequestIntakePipeline via wired harness.
 */
import { describe, expect, it } from "vitest";

import {
  createWiredHarness,
  WIRED_WORKSPACE_ID,
} from "./fixtures/wiredHarness";

describe("v8-engine golden — intake meta + mode inject", () => {
  it("/stop short-circuits before understand with session_control_stop", async () => {
    const { engine } = await createWiredHarness();

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
    expect(result.reasonCodes).toContain("session_control_stop");
    expect(result.reasonCodes).not.toContain("understanding_complete");
    expect(result.reasonCodes).not.toContain("decision_complete");
    expect(result.error?.code).toBe("cancelled");
    expect(result.sessionControl?.command).toBe("stop");
    expect(result.warnings.some((w) => w.startsWith("meta_command:stop:"))).toBe(
      true,
    );
  });

  it("/compact compacts host conversation without model loop", async () => {
    const { engine } = await createWiredHarness({
      runTurns: [{ content: "should-not-run" }],
    });

    const longConversation = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Turn ${i} `.repeat(80),
    }));

    const result = await engine.start({
      schemaVersion: 1,
      workspaceRoot: "/workspace",
      conversation: longConversation,
      request: {
        sessionId: "sess_intake_compact",
        mode: "agent",
        userMessage: "/compact",
        workspace: { workspaceId: WIRED_WORKSPACE_ID },
      },
    }).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("intake_meta_command");
    expect(result.reasonCodes).toContain("session_control_compacted");
    expect(result.reasonCodes).not.toContain("model_completed");
    expect(result.usage.modelCalls).toBe(0);
    expect(result.sessionControl?.command).toBe("compact");
    expect(result.sessionControl?.compactedConversation).toBeDefined();
    expect(
      (result.sessionControl?.compactStats?.afterMessages ?? 0) <
        (result.sessionControl?.compactStats?.beforeMessages ?? 0) ||
        result.sessionControl?.compactStats?.beforeMessages === 0,
    ).toBe(true);
    expect(result.answer).toMatch(/compact/i);
  });

  it("/new finalizes session for the host", async () => {
    const { engine } = await createWiredHarness();

    const result = await engine.start({
      schemaVersion: 1,
      workspaceRoot: "/workspace",
      request: {
        sessionId: "sess_intake_new",
        mode: "agent",
        userMessage: "/new",
        workspace: { workspaceId: WIRED_WORKSPACE_ID },
      },
    }).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("session_control_finalized");
    expect(result.sessionControl?.sessionAction).toBe("new");
    expect(result.answer).toMatch(/new chat/i);
  });

  it("/help returns the command list", async () => {
    const { engine } = await createWiredHarness();

    const result = await engine.start({
      schemaVersion: 1,
      workspaceRoot: "/workspace",
      request: {
        sessionId: "sess_intake_help",
        mode: "ask",
        userMessage: "/help",
        workspace: { workspaceId: WIRED_WORKSPACE_ID },
      },
    }).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("session_control_side_channel");
    expect(result.answer).toMatch(/\/compact/);
    expect(result.answer).toMatch(/\/stop/);
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
