import { describe, expect, it } from "vitest";

import { createUserRequestInputSchema } from "../contracts/input/CreateUserRequestInput";
import { agentModeSchema } from "../interaction-mode/schema";
import { RequestIntakePipeline } from "../pipeline/RequestIntakePipeline";
import { userRequestEnvelopeSchema } from "../request-envelope/schema";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");

const createPipeline = () =>
  new RequestIntakePipeline({
    clock: { now: () => NOW },
    idGenerator: {
      generate: (namespace) => `${namespace}-intake-1`,
    },
  });

describe("RequestIntakePipeline", () => {
  it("validates mode and builds an envelope", () => {
    const result = createPipeline().intake({
      sessionId: "session-1",
      mode: "agent",
      userMessage: "  Explain the bug.  ",
    });

    expect(result.mode).toBe("agent");
    expect(result.message).toBe("Explain the bug.");
    expect(result.requestId).toBe("request-intake-1");
    expect(userRequestEnvelopeSchema.safeParse(result).success).toBe(true);
  });

  it("rejects invalid modes", () => {
    expect(agentModeSchema.safeParse("debug").success).toBe(false);
    expect(() =>
      createPipeline().intake({
        sessionId: "session-1",
        mode: "debug" as "ask",
        userMessage: "hi",
      }),
    ).toThrow();
  });

  it("rejects unknown nested shapes", () => {
    const invalidArtifacts = createUserRequestInputSchema.safeParse({
      sessionId: "session-1",
      mode: "ask",
      userMessage: "hi",
      referencedArtifacts: [{ notAnArtifact: true }],
    });
    expect(invalidArtifacts.success).toBe(false);

    const invalidWorkspace = createUserRequestInputSchema.safeParse({
      sessionId: "session-1",
      mode: "ask",
      userMessage: "hi",
      workspace: { unexpected: true },
    });
    expect(invalidWorkspace.success).toBe(false);

    const valid = createUserRequestInputSchema.safeParse({
      sessionId: "session-1",
      mode: "ask",
      userMessage: "hi",
      referencedArtifacts: [
        {
          name: "auth.ts",
          path: "src/auth.ts",
          kind: "file",
        },
      ],
      workspace: {
        workspaceId: "ws-1",
      },
      correlation: {
        traceId: "trace-1",
      },
    });
    expect(valid.success).toBe(true);
  });

  it("rejects empty content at the input boundary", () => {
    const empty = createUserRequestInputSchema.safeParse({
      sessionId: "session-1",
      mode: "ask",
      userMessage: "   ",
    });
    expect(empty.success).toBe(false);

    const artifactOnly = createUserRequestInputSchema.safeParse({
      sessionId: "session-1",
      mode: "ask",
      userMessage: "",
      referencedArtifacts: [
        {
          name: "auth.ts",
          path: "src/auth.ts",
          kind: "file",
        },
      ],
    });
    expect(artifactOnly.success).toBe(true);
  });

  it("rejects oversized messages at the input boundary", () => {
    const oversized = createUserRequestInputSchema.safeParse({
      sessionId: "session-1",
      mode: "ask",
      userMessage: "x".repeat(200_001),
    });
    expect(oversized.success).toBe(false);
  });

  it("rejects empty content before envelope build", () => {
    expect(() =>
      createPipeline().intake({
        sessionId: "session-1",
        mode: "ask",
        userMessage: "   ",
      }),
    ).toThrow();
  });
});
