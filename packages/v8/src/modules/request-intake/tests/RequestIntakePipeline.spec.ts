import assert from "node:assert/strict";
import test from "node:test";

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

test("request intake facade validates mode and builds an envelope", () => {
  const result = createPipeline().intake({
    sessionId: "session-1",
    mode: "agent",
    userMessage: "  Explain the bug.  ",
  });

  assert.equal(result.mode, "agent");
  assert.equal(result.message, "Explain the bug.");
  assert.equal(result.requestId, "request-intake-1");
  assert.equal(userRequestEnvelopeSchema.safeParse(result).success, true);
});

test("request intake facade rejects invalid modes", () => {
  assert.equal(agentModeSchema.safeParse("debug").success, false);
  assert.throws(() =>
    createPipeline().intake({
      sessionId: "session-1",
      mode: "debug" as "ask",
      userMessage: "hi",
    }),
  );
});

test("createUserRequestInputSchema rejects unknown nested shapes", () => {
  const invalidArtifacts = createUserRequestInputSchema.safeParse({
    sessionId: "session-1",
    mode: "ask",
    userMessage: "hi",
    referencedArtifacts: [{ notAnArtifact: true }],
  });
  assert.equal(invalidArtifacts.success, false);

  const invalidWorkspace = createUserRequestInputSchema.safeParse({
    sessionId: "session-1",
    mode: "ask",
    userMessage: "hi",
    workspace: { unexpected: true },
  });
  assert.equal(invalidWorkspace.success, false);

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
  assert.equal(valid.success, true);
});
