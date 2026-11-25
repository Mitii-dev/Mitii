import { describe, expect, it } from "vitest";

import {
  UserRequestEnvelopeBuilder,
  userRequestEnvelopeSchema,
} from "../../index";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");

const createBuilder = () =>
  new UserRequestEnvelopeBuilder({
    clock: { now: () => NOW },
    idGenerator: {
      generate: (namespace) => `${namespace}-1`,
    },
  });

describe("UserRequestEnvelopeBuilder", () => {
  it("preserves explicit repository-state anchors", () => {
    const result = createBuilder().build({
      sessionId: "session-1",
      mode: "agent",
      userMessage: "  Fix the selected file.  ",
      referencedArtifacts: [
        {
          name: "auth.ts",
          path: "src/auth.ts",
          kind: "selection",
          contentHash: "sha256:abc123",
          startLine: 10,
          endLine: 20,
        },
      ],
      workspace: {
        workspaceId: "workspace-1",
        rootIds: ["root-1"],
        observedSnapshotId: "snapshot-1",
        observedCodeIndexChangeToken: "index-1",
      },
      correlation: {
        traceId: "trace-1",
      },
    });

    expect(result.requestId).toBe("request-1");
    expect(result.message).toBe("Fix the selected file.");
    expect(result.referencedArtifacts[0]?.contentHash).toBe("sha256:abc123");
    expect(result.workspace?.observedSnapshotId).toBe("snapshot-1");
    expect(result.createdAt).toBe("2026-07-25T12:00:00.000Z");
  });

  it("rejects empty requests and unknown metadata", () => {
    expect(() =>
      createBuilder().build({
        sessionId: "session-1",
        mode: "ask",
        userMessage: "   ",
      }),
    ).toThrow();

    const parsed = userRequestEnvelopeSchema.safeParse({
      schemaVersion: 1,
      requestId: "request-1",
      sessionId: "session-1",
      mode: "ask",
      origin: "user",
      message: "Explain this.",
      referencedArtifacts: [],
      turnKind: "new",
      metadata: {
        apiKey: "must-not-be-accepted",
      },
      createdAt: "2026-07-25T12:00:00.000Z",
    });

    expect(parsed.success).toBe(false);
  });

  it("carries image attachments through the builder", () => {
    const result = createBuilder().build({
      sessionId: "session-1",
      mode: "agent",
      userMessage: "What does this screenshot show?",
      attachments: [
        {
          mimeType: "image/png",
          data: "aGVsbG8=",
          name: "screenshot.png",
        },
      ],
    });

    expect(result.attachments?.length).toBe(1);
    expect(result.attachments?.[0]?.mimeType).toBe("image/png");
    expect(result.attachments?.[0]?.data).toBe("aGVsbG8=");
    expect(result.attachments?.[0]?.name).toBe("screenshot.png");
  });

  it("rejects unsupported mime types and too many attachments", () => {
    const base = {
      schemaVersion: 1 as const,
      requestId: "request-1",
      sessionId: "session-1",
      mode: "agent" as const,
      origin: "user" as const,
      message: "Look at this.",
      referencedArtifacts: [],
      turnKind: "new" as const,
      createdAt: "2026-07-25T12:00:00.000Z",
    };

    expect(
      userRequestEnvelopeSchema.safeParse({
        ...base,
        attachments: [{ mimeType: "application/pdf", data: "aGVsbG8=" }],
      }).success,
    ).toBe(false);

    expect(
      userRequestEnvelopeSchema.safeParse({
        ...base,
        attachments: Array.from({ length: 5 }, () => ({
          mimeType: "image/png",
          data: "aGVsbG8=",
        })),
      }).success,
    ).toBe(false);

    expect(
      userRequestEnvelopeSchema.safeParse({
        ...base,
        attachments: [{ mimeType: "image/png", data: "aGVsbG8=" }],
      }).success,
    ).toBe(true);
  });
});
