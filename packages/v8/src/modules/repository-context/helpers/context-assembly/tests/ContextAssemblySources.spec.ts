import assert from "node:assert/strict";
import test from "node:test";

import {
  createAssembler,
  createItem,
  createSelection,
  createSnapshot,
} from "./fixtures/assemblyFixtures";

import type {
  ContextContentSource,
} from "../types";

test(
  "can load sensitive paths only when mandatory redaction remains enabled",
  async () => {
    const files = {
      ".env":
        "PASSWORD=super-secret-value",
    };
    const result =
      await createAssembler(
        files,
        {
          sensitivePathMode:
            "redact",
        },
      ).assemble({
        selection:
          createSelection([
            createItem({
              key:
                "file:app:.env",
              relativePath:
                ".env",
              priority:
                "required",
              origin: [
                "explicit_file",
              ],
            }),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });

    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.blocks[0]
        ?.content
        .includes(
          "super-secret-value",
        ),
      false,
    );
    assert.ok(
      result.blocks[0]
        ?.redactions
        .length,
    );

    assert.throws(
      () =>
        createAssembler(
          files,
          {
            sensitivePathMode:
              "redact",
            redactSecrets:
              false,
          },
        ),
    );
  },
);

test(
  "reports missing selected files instead of silently fabricating content",
  async () => {
    const files = {};
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            createItem({
              relativePath:
                "src/missing.ts",
              key:
                "file:app:src/missing.ts",
            }),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });

    assert.equal(
      result.status,
      "partial",
    );
    assert.equal(
      result.blocks.length,
      0,
    );
    assert.equal(
      result.dropped[0]
        ?.cause,
      "content_not_found",
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "content_not_found",
      ),
    );
  },
);

test(
  "preserves source failures when a lower-priority source succeeds",
  async () => {
    const files = {
      "src/app.ts":
        "export const ok = true;",
    };
    const failingSource:
      ContextContentSource = {
        id:
          "failing-source",
        priority:
          200,
        supports: () =>
          true,
        load: async () => {
          throw new Error(
            "index is unavailable",
          );
        },
      };
    const result =
      await createAssembler(
        files,
        {},
        [
          failingSource,
        ],
      ).assemble({
        selection:
          createSelection([
            createItem(),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });

    assert.equal(
      result.status,
      "partial",
    );
    assert.equal(
      result.blocks.length,
      1,
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
            "content_source_failed" &&
          warning.sourceId ===
            "failing-source",
      ),
    );
  },
);

test(
  "can assemble a retrieved preview without filesystem content",
  async () => {
    const files = {};
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            createItem({
              key:
                "chunk:app:src/missing.ts:chunk-1",
              entityKind:
                "chunk",
              chunkId:
                "chunk-1",
              representation:
                "targeted_excerpt",
              retrievalCandidate: {
                key:
                  "chunk:app:src/missing.ts:chunk-1",
                entityKind:
                  "chunk",
                rootId:
                  "app",
                relativePath:
                  "src/missing.ts",
                chunkId:
                  "chunk-1",
                preview:
                  "export const preview = true;",
                fusedScore:
                  0.8,
                score:
                  0.8,
                matchedSourceCount:
                  1,
                contributions: [
                  {
                    sourceId:
                      "text-index",
                    sourceRank:
                      1,
                    sourceScore:
                      0.8,
                    sourceWeight:
                      1,
                    reciprocalRankScore:
                      0.8,
                    reasons: [
                      {
                        type:
                          "lexical_match",
                        evidence:
                          "Matched preview.",
                      },
                    ],
                  },
                ],
                reasons: [
                  {
                    type:
                      "lexical_match",
                    evidence:
                      "Matched preview.",
                  },
                ],
              },
              relativePath:
                "src/missing.ts",
            }),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });

    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.blocks[0]
        ?.sourceId,
      "selected-preview-context-source",
    );
    assert.deepEqual(
      result.blocks[0]
        ?.provenance
        .retrievalSourceIds,
      [
        "text-index",
      ],
    );
  },
);

test(
  "returns a deterministic empty cancellation result",
  async () => {
    const files = {
      "src/app.ts":
        "export const ok = true;",
    };
    const controller =
      new AbortController();
    controller.abort();

    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            createItem(),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
        abortSignal:
          controller.signal,
      });

    assert.equal(
      result.status,
      "cancelled",
    );
    assert.equal(
      result.blocks.length,
      0,
    );
    assert.equal(
      result.budget
        .usedTokens,
      0,
    );
  },
);
