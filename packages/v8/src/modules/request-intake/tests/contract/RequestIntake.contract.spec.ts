import { describe, expect, it } from "vitest";

import {
  AGENT_MODES,
  RequestIntakePipeline,
  createUserRequestInputSchema,
  userRequestEnvelopeSchema,
} from "../../index";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");

const createPipeline = () =>
  new RequestIntakePipeline({
    clock: { now: () => NOW },
    idGenerator: {
      generate: (namespace) => `${namespace}-contract-1`,
    },
  });

describe("Request Intake contract", () => {
  it("accepts valid input and returns a versioned envelope", () => {
    const input = createUserRequestInputSchema.parse({
      sessionId: "session-1",
      mode: "agent",
      userMessage: "Explain the auth flow.",
    });

    const envelope = createPipeline().intake(input);

    expect(envelope.schemaVersion).toBe(1);
    expect(userRequestEnvelopeSchema.parse(envelope).message).toBe(
      "Explain the auth flow.",
    );
    expect(AGENT_MODES).toContain(envelope.mode);
  });

  it("rejects empty requests at the public input boundary", () => {
    expect(
      createUserRequestInputSchema.safeParse({
        sessionId: "session-1",
        mode: "ask",
        userMessage: "   ",
      }).success,
    ).toBe(false);
  });

  it("keeps ask / plan / agent as the only interaction modes", () => {
    expect(AGENT_MODES).toEqual(["ask", "plan", "agent"]);
  });
});
