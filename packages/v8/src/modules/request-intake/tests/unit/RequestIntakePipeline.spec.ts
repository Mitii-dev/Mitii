import { describe, expect, it } from "vitest";

import {
  createUserRequestInputSchema,
  agentModeSchema,
  RequestIntakePipeline,
  REQUEST_INTAKE_STAGES,
  userRequestEnvelopeSchema,
  extractMentionArtifacts,
  classifyLeadingCommand,
  parseLeadingCommand,
  sanitizeUserMessage,
  type ModuleLoggerPort,
} from "../../index";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");

const createPipeline = (log?: ModuleLoggerPort) =>
  new RequestIntakePipeline({
    clock: { now: () => NOW },
    idGenerator: {
      generate: (namespace) => `${namespace}-intake-1`,
    },
    log,
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
    expect(result.turnKind).toBe("new");
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
      turnKind: "steer",
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

  it("injects @path mentions into referencedArtifacts", () => {
    const result = createPipeline().intake({
      sessionId: "session-1",
      mode: "agent",
      userMessage: "Fix @src/LoginForm.tsx:10-20 please",
    });

    expect(result.referencedArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/LoginForm.tsx",
          kind: "selection",
          startLine: 10,
          endLine: 20,
        }),
      ]),
    );
    expect(result.message).toContain("@src/LoginForm.tsx:10-20");
  });

  it("resolves mode from leading /plan slash", () => {
    const result = createPipeline().intake({
      sessionId: "session-1",
      mode: "agent",
      userMessage: "/plan redesign the auth flow",
    });

    expect(result.mode).toBe("plan");
    expect(result.message).toBe("redesign the auth flow");
    expect(result.messageOriginal).toBe("/plan redesign the auth flow");
  });

  it("classifies /stop as meta short-circuit", () => {
    const detailed = createPipeline().intakeDetailed({
      sessionId: "session-1",
      mode: "agent",
      userMessage: "/stop",
    });

    expect(detailed.shortCircuitMeta).toBe(true);
    expect(detailed.envelope.metaCommand).toEqual({
      name: "stop",
      args: "",
      lifecycle: "stop",
    });
  });

  it("preserves host turnKind", () => {
    const result = createPipeline().intake({
      sessionId: "session-1",
      mode: "agent",
      userMessage: "Keep going on the patch",
      turnKind: "steer",
      parentRequestId: "request-parent-1",
    });

    expect(result.turnKind).toBe("steer");
    expect(result.parentRequestId).toBe("request-parent-1");
  });

  it("emits logger stage events when a logger is injected", () => {
    const stages: string[] = [];
    const log: ModuleLoggerPort = {
      stage(event) {
        stages.push(event.stage);
      },
    };
    createPipeline(log).intake({
      sessionId: "session-1",
      mode: "agent",
      userMessage: "Explain the bug.",
    });
    expect(stages).toEqual([
      REQUEST_INTAKE_STAGES.sanitize,
      REQUEST_INTAKE_STAGES.classifyCommand,
      REQUEST_INTAKE_STAGES.extractMentions,
      REQUEST_INTAKE_STAGES.normalizeAttachments,
      REQUEST_INTAKE_STAGES.resolveMode,
      REQUEST_INTAKE_STAGES.buildEnvelope,
    ]);
  });
});

describe("sanitizeUserMessage", () => {
  it("trims and strips control characters", () => {
    expect(sanitizeUserMessage("  hello\u0000world  ")).toBe("helloworld");
  });
});

describe("parseLeadingCommand", () => {
  it("parses name and args", () => {
    expect(parseLeadingCommand("/compact")).toEqual({
      name: "compact",
      args: "",
      matchedPrefix: "/compact",
    });
    expect(parseLeadingCommand("/resume abc")).toEqual({
      name: "resume",
      args: "abc",
      matchedPrefix: "/resume abc",
    });
  });

  it("ignores comment-like prefixes", () => {
    expect(classifyLeadingCommand("// not a command").kind).toBe("none");
  });
});

describe("extractMentionArtifacts", () => {
  it("skips bare @handles without path signals", () => {
    expect(extractMentionArtifacts("ping @alice about this")).toEqual([]);
  });

  it("extracts quoted paths", () => {
    expect(extractMentionArtifacts('see @"src/a b.ts"')).toEqual([
      expect.objectContaining({
        path: "src/a b.ts",
        kind: "file",
      }),
    ]);
  });

  it("promotes a bare path message to a file artifact", () => {
    expect(extractMentionArtifacts("src/LoginForm.tsx")).toEqual([
      expect.objectContaining({
        path: "src/LoginForm.tsx",
        kind: "file",
        name: "LoginForm.tsx",
      }),
    ]);
  });
});
