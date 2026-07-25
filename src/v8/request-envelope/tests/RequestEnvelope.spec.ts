import assert from "node:assert/strict";
import test from "node:test";

import {
  UserRequestEnvelopeBuilder,
  userRequestEnvelopeSchema,
} from "../index";

const NOW =
  Date.parse(
    "2026-07-25T12:00:00.000Z",
  );

const createBuilder = () =>
  new UserRequestEnvelopeBuilder({
    clock: {
      now:
        () =>
          NOW,
    },
    idGenerator: {
      generate:
        (namespace) =>
          `${namespace}-1`,
    },
  });

test(
  "request envelope preserves explicit repository-state anchors",
  () => {
    const result =
      createBuilder()
        .build({
          sessionId:
            "session-1",
          mode:
            "agent",
          userMessage:
            "  Fix the selected file.  ",
          referencedArtifacts: [
            {
              name:
                "auth.ts",
              path:
                "src/auth.ts",
              kind:
                "selection",
              contentHash:
                "sha256:abc123",
              startLine:
                10,
              endLine:
                20,
            },
          ],
          workspace: {
            workspaceId:
              "workspace-1",
            rootIds: [
              "root-1",
            ],
            observedSnapshotId:
              "snapshot-1",
            observedCodeIndexChangeToken:
              "index-1",
          },
          correlation: {
            traceId:
              "trace-1",
          },
        });

    assert.equal(
      result.requestId,
      "request-1",
    );
    assert.equal(
      result.message,
      "Fix the selected file.",
    );
    assert.equal(
      result
        .referencedArtifacts[0]
        ?.contentHash,
      "sha256:abc123",
    );
    assert.equal(
      result.workspace
        ?.observedSnapshotId,
      "snapshot-1",
    );
    assert.equal(
      result.createdAt,
      "2026-07-25T12:00:00.000Z",
    );
  },
);

test(
  "request envelope rejects empty requests and unknown metadata",
  () => {
    assert.throws(
      () =>
        createBuilder()
          .build({
            sessionId:
              "session-1",
            mode:
              "ask",
            userMessage:
              "   ",
          }),
    );

    const parsed =
      userRequestEnvelopeSchema
        .safeParse({
          schemaVersion:
            1,
          requestId:
            "request-1",
          sessionId:
            "session-1",
          mode:
            "ask",
          origin:
            "user",
          message:
            "Explain this.",
          referencedArtifacts:
            [],
          metadata: {
            apiKey:
              "must-not-be-accepted",
          },
          createdAt:
            "2026-07-25T12:00:00.000Z",
        });

    assert.equal(
      parsed.success,
      false,
    );
  },
);
