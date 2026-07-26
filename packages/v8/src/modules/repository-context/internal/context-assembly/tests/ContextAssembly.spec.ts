import assert from "node:assert/strict";
import test from "node:test";

import {
  CharacterTokenEstimator,
} from "../../../../repository-state/index";

import type {
  SelectedContextItem,
  ContextSelectionResult,
} from "../../context-selection";

import {
  InMemoryFileSystemAdapter,
} from "../../../../repository-state/index";

import type {
  WorkspaceSnapshot,
} from "../../../../repository-state/index";

import {
  ContextAssemblyFactory,
} from "../ContextAssemblyFactory";

import type {
  ContextAssemblerOptions,
  ContextContentSource,
} from "../types";

const SNAPSHOT_ID =
  "a".repeat(64);

function createItem(
  overrides:
    Partial<SelectedContextItem> = {},
): SelectedContextItem {
  return {
    key:
      "file:app:src/app.ts",
    origin: [
      "retrieval",
    ],
    priority:
      "supplementary",
    entityKind:
      "file",
    rootId:
      "app",
    relativePath:
      "src/app.ts",
    representation:
      "full_file",
    allocatedTokens:
      100,
    estimatedTokens:
      100,
    score:
      0.8,
    selectionOrder:
      1,
    signals: [
      {
        type:
          "retrieval_score",
        score:
          0.8,
        evidence:
          "Test retrieval score.",
      },
    ],
    ...overrides,
  };
}

function createSelection(
  items:
    SelectedContextItem[],
  status:
    ContextSelectionResult[
      "status"
    ] = "complete",
): ContextSelectionResult {
  const usedTokens =
    items.reduce(
      (sum, item) =>
        sum +
        item.allocatedTokens,
      0,
    );
  const maximumTokens =
    Math.max(
      1,
      usedTokens,
    );

  return {
    schemaVersion:
      1,
    query:
      "test query",
    mode:
      "agent",
    breadth:
      "balanced",
    status,
    items,
    dropped: [],
    warnings: [],
    budget: {
      maximumTokens,
      usedTokens,
      remainingTokens:
        maximumTokens -
        usedTokens,
      maximumItems:
        Math.max(
          1,
          items.length,
        ),
      maximumFiles:
        Math.max(
          1,
          items.length,
        ),
      maximumItemsPerFile:
        Math.max(
          1,
          items.length,
        ),
    },
    statistics: {
      retrievedCandidates:
        items.length,
      synthesizedReferences:
        0,
      consideredCandidates:
        items.length,
      selectedItems:
        items.length,
      droppedItems:
        0,
      selectedFiles:
        new Set(
          items.map(
            (item) =>
              `${item.rootId ?? ""}:${item.relativePath}`,
          ),
        ).size,
      selectedRoots:
        new Set(
          items.flatMap(
            (item) =>
              item.rootId
                ? [
                    item.rootId,
                  ]
                : [],
          ),
        ).size,
      requiredItems:
        items.filter(
          (item) =>
            item.priority ===
            "required",
        ).length,
      preferredItems:
        items.filter(
          (item) =>
            item.priority ===
            "preferred",
        ).length,
      supplementaryItems:
        items.filter(
          (item) =>
            item.priority ===
            "supplementary",
        ).length,
      fullFileItems:
        items.filter(
          (item) =>
            item.representation ===
            "full_file",
        ).length,
      exactRangeItems:
        items.filter(
          (item) =>
            item.representation ===
            "exact_range",
        ).length,
      targetedExcerptItems:
        items.filter(
          (item) =>
            item.representation ===
            "targeted_excerpt",
        ).length,
      fileOutlineItems:
        items.filter(
          (item) =>
            item.representation ===
            "file_outline",
        ).length,
      symbolSignatureItems:
        items.filter(
          (item) =>
            item.representation ===
            "symbol_signature",
        ).length,
    },
  };
}

function createSnapshot(
  files:
    Readonly<
      Record<
        string,
        string
      >
    >,
  status:
    WorkspaceSnapshot[
      "status"
    ] = "complete",
): WorkspaceSnapshot {
  const entries =
    Object.entries(
      files,
    ).map(
      (
        [
          relativePath,
          content,
        ],
      ) => ({
        kind:
          "file" as const,
        rootId:
          "app",
        relativePath,
        providerPath:
          `/workspace/${relativePath}`,
        depth:
          relativePath
            .split("/")
            .length,
        size:
          new TextEncoder()
            .encode(content)
            .byteLength,
      }),
    );

  return {
    schemaVersion:
      1,
    snapshotId:
      SNAPSHOT_ID,
    roots: [
      {
        id:
          "app",
        name:
          "app",
        providerPath:
          "/workspace",
        kind:
          "directory",
      },
    ],
    entries,
    warnings: [],
    statistics: {
      files:
        entries.length,
      directories:
        0,
      symbolicLinks:
        0,
      otherEntries:
        0,
      ignoredEntries:
        0,
      warnings:
        0,
      durationMs:
        1,
    },
    limits: {
      maximumDepth:
        20,
      maximumFiles:
        1_000,
      maximumDirectories:
        1_000,
      timeoutMs:
        5_000,
      followSymbolicLinks:
        false,
    },
    status,
    generatedAt:
      "2026-07-25T12:00:00.000Z",
  };
}

function createAssembler(
  files:
    Readonly<
      Record<
        string,
        string
      >
    >,
  options:
    ContextAssemblerOptions = {},
  additionalSources:
    readonly ContextContentSource[] = [],
) {
  const fileSystem =
    new InMemoryFileSystemAdapter(
      Object.entries(
        files,
      ).map(
        (
          [
            relativePath,
            content,
          ],
        ) => ({
          kind:
            "file" as const,
          path:
            `/workspace/${relativePath}`,
          content,
        }),
      ),
    );

  return new ContextAssemblyFactory()
    .create(
      {
        fileSystem,
        tokenEstimator:
          new CharacterTokenEstimator(),
        additionalSources,
      },
      options,
    );
}

test(
  "assembles full files as untrusted, provenance-rich blocks",
  async () => {
    const files = {
      "src/app.ts":
        "import { run } from './run';\nrun();\n",
    };
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
      });

    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.blocks.length,
      1,
    );
    assert.equal(
      result.blocks[0]
        ?.trust,
      "untrusted_repository_content",
    );
    assert.equal(
      result.blocks[0]
        ?.content,
      files[
        "src/app.ts"
      ],
    );
    assert.equal(
      result.blocks[0]
        ?.provenance
        .selectionKey,
      "file:app:src/app.ts",
    );
  },
);

test(
  "loads exact line ranges without expanding them",
  async () => {
    const files = {
      "src/app.ts":
        "line 1\nline 2\nline 3\nline 4",
    };
    const item =
      createItem({
        key:
          "range:app:src/app.ts:2-3",
        representation:
          "exact_range",
        startLine:
          2,
        endLine:
          3,
      });
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            item,
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });

    assert.equal(
      result.blocks[0]
        ?.content,
      "line 2\nline 3",
    );
    assert.deepEqual(
      result.blocks[0]
        ?.lineRanges,
      [
        {
          startLine:
            2,
          endLine:
            3,
        },
      ],
    );
  },
);

test(
  "uses a visible representation fallback when an outline source is unavailable",
  async () => {
    const files = {
      "src/app.ts":
        "export function run() { return true; }",
    };
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            createItem({
              representation:
                "file_outline",
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
      result.blocks[0]
        ?.requestedRepresentation,
      "file_outline",
    );
    assert.equal(
      result.blocks[0]
        ?.representation,
      "targeted_excerpt",
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "representation_fallback",
      ),
    );
  },
);

test(
  "truncates content without exceeding the selected token allocation",
  async () => {
    const files = {
      "src/app.ts":
        "const value = 1;\n".repeat(
          200,
        ),
    };
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            createItem({
              allocatedTokens:
                24,
              estimatedTokens:
                24,
            }),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });
    const block =
      result.blocks[0];

    assert.ok(block);
    assert.equal(
      block.truncated,
      true,
    );
    assert.ok(
      block.tokenEstimate <=
        24,
    );
    assert.equal(
      result.budget
        .usedTokens,
      block.tokenEstimate,
    );
  },
);

test(
  "sanitizes control characters and redacts secrets before output",
  async () => {
    const files = {
      "src/config.ts":
        "const api_key = \"ghp_123456789012345678901234567890\";\u0000\n",
    };
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            createItem({
              key:
                "file:app:src/config.ts",
              relativePath:
                "src/config.ts",
            }),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });
    const content =
      result.blocks[0]
        ?.content ??
      "";

    assert.equal(
      content.includes(
        "ghp_",
      ),
      false,
    );
    assert.equal(
      content.includes(
        "\u0000",
      ),
      false,
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "secrets_redacted",
      ),
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "content_sanitized",
      ),
    );
  },
);

test(
  "blocks sensitive files and supports fail-closed required context",
  async () => {
    const files = {
      ".env":
        "PASSWORD=super-secret-value",
    };
    const item =
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
      });
    const input = {
      selection:
        createSelection([
          item,
        ]),
      snapshot:
        createSnapshot(
          files,
        ),
    };
    const partial =
      await createAssembler(
        files,
      ).assemble(
        input,
      );
    const failed =
      await createAssembler(
        files,
        {
          requiredLoadFailureMode:
            "fail",
        },
      ).assemble(
        input,
      );

    assert.equal(
      partial.status,
      "partial",
    );
    assert.equal(
      partial.blocks.length,
      0,
    );
    assert.equal(
      partial.dropped[0]
        ?.cause,
      "sensitive_path",
    );
    assert.equal(
      failed.status,
      "failed",
    );
    assert.equal(
      failed.blocks.length,
      0,
    );
  },
);

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
