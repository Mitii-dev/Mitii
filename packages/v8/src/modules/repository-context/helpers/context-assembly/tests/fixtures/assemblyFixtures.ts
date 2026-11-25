import type {
  SelectedContextItem,
  ContextSelectionResult,
} from "../../../context-selection";

import {
  CharacterTokenEstimator,
  InMemoryFileSystemAdapter,
} from "../../../../../repository-state/index";

import type {
  WorkspaceSnapshot,
} from "../../../../../repository-state/index";

import {
  ContextAssemblyFactory,
} from "../../ContextAssemblyFactory";

import type {
  ContextAssemblerOptions,
  ContextContentSource,
} from "../../types";

const SNAPSHOT_ID =
  "a".repeat(64);

export function createItem(
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

export function createSelection(
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

export function createSnapshot(
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

export function createAssembler(
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
