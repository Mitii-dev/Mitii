import {
  CONTEXT_SELECTION_EXCLUDED_FILE_NAMES,
  CONTEXT_SELECTION_EXCLUDED_PATH_SEGMENTS,
  CONTEXT_SELECTION_IDS,
  CONTEXT_SELECTION_MESSAGES,
  CONTEXT_SELECTION_ORIGIN_ORDER,
  CONTEXT_SELECTION_PRIORITY_ORDER,
} from "./constants";

import {
  ContextReferenceKeyBuilder,
} from "./ContextReferenceKeyBuilder";

import type {
  ContextCandidate,
  ContextCandidateOrigin,
  ContextCandidatePreparation,
  ContextFileReference,
  ContextReferencePriority,
  DroppedContextItem,
  NormalizedContextSelectionRequest,
} from "./types";

export class ContextCandidatePreparer {
  public readonly id =
    CONTEXT_SELECTION_IDS
      .CANDIDATE_PREPARER;

  public constructor(
    private readonly keyBuilder =
      new ContextReferenceKeyBuilder(),
  ) {}

  public prepare(
    request:
      NormalizedContextSelectionRequest,
  ): ContextCandidatePreparation {
    const candidates =
      new Map<
        string,
        ContextCandidate
      >();
    const dropped:
      DroppedContextItem[] = [];
    let synthesizedReferences =
      0;
    let excludedCount =
      0;
    let duplicateCount =
      0;

    for (
      const retrievalCandidate of
        request.retrieval
          .candidates
    ) {
      const key =
        retrievalCandidate
          .entityKind ===
          "file"
          ? this.keyBuilder
              .buildFileKey(
                retrievalCandidate,
              )
          : `retrieval:${retrievalCandidate.key}`;

      if (
        this.isExcluded(
          retrievalCandidate
            .relativePath,
        )
      ) {
        excludedCount += 1;
        dropped.push({
          key,
          relativePath:
            retrievalCandidate
              .relativePath,
          cause:
            "excluded_path",
          priority:
            "supplementary",
          score:
            retrievalCandidate
              .score,
          estimatedTokens:
            retrievalCandidate
              .tokenEstimate ??
            0,
          evidence:
            "The path is internal, generated, or excluded by the context-selection safety policy.",
        });
        continue;
      }

      if (
        candidates.has(key)
      ) {
        duplicateCount += 1;
        dropped.push({
          key,
          relativePath:
            retrievalCandidate
              .relativePath,
          cause:
            "duplicate",
          priority:
            "supplementary",
          score:
            retrievalCandidate
              .score,
          estimatedTokens:
            retrievalCandidate
              .tokenEstimate ??
            0,
          evidence:
            "A retrieval candidate with the same canonical key was already prepared.",
        });
        continue;
      }

      candidates.set(
        key,
        {
          key,
          entityKind:
            retrievalCandidate
              .entityKind,
          rootId:
            retrievalCandidate
              .rootId,
          relativePath:
            retrievalCandidate
              .relativePath,
          ...(retrievalCandidate
            .chunkId
            ? {
                chunkId:
                  retrievalCandidate
                    .chunkId,
              }
            : {}),
          ...(retrievalCandidate
            .symbolId
            ? {
                symbolId:
                  retrievalCandidate
                    .symbolId,
              }
            : {}),
          ...(retrievalCandidate
            .startLine !==
          undefined
            ? {
                startLine:
                  retrievalCandidate
                    .startLine,
              }
            : {}),
          ...(retrievalCandidate
            .endLine !==
          undefined
            ? {
                endLine:
                  retrievalCandidate
                    .endLine,
              }
            : {}),
          retrievalCandidate,
          origins: [
            "retrieval",
          ],
          priority:
            "supplementary",
        },
      );
    }

    const addFileReference = (
      reference:
        ContextFileReference,
      origin:
        ContextCandidateOrigin,
      priority:
        ContextReferencePriority,
    ): void => {
      if (
        this.isExcluded(
          reference.relativePath,
        )
      ) {
        excludedCount += 1;
        const key =
          this.keyBuilder
            .buildFileKey(
              reference,
            );

        dropped.push({
          key,
          relativePath:
            reference
              .relativePath,
          cause:
            "excluded_path",
          priority,
          score:
            priority ===
            "required"
              ? 1
              : 0,
          estimatedTokens:
            0,
          evidence:
            "The referenced path is internal, generated, or excluded by the context-selection safety policy.",
        });
        return;
      }

      const key =
        this.keyBuilder
          .buildFileKey(
            reference,
          );
      const matchingKeys =
        reference.rootId
          ? [
              key,
            ]
          : [
              ...candidates
                .values(),
            ]
              .filter(
                (candidate) =>
                  candidate
                    .entityKind ===
                    "file" &&
                  candidate
                    .relativePath ===
                    reference
                      .relativePath,
              )
              .map(
                (candidate) =>
                  candidate.key,
              );
      const mergeKey =
        matchingKeys.length ===
          1
          ? matchingKeys[0]
          : key;
      const existing =
        mergeKey
          ? candidates.get(
              mergeKey,
            )
          : undefined;

      if (
        existing &&
        mergeKey
      ) {
        candidates.set(
          mergeKey,
          this.merge(
            existing,
            origin,
            priority,
          ),
        );
        return;
      }

      synthesizedReferences +=
        1;
      candidates.set(
        key,
        {
          key,
          entityKind:
            "file",
          ...(reference.rootId
            ? {
                rootId:
                  reference
                    .rootId,
              }
            : {}),
          relativePath:
            reference
              .relativePath,
          origins: [
            origin,
          ],
          priority,
        },
      );
    };

    for (
      const reference of
        request.references
          .explicitFiles
    ) {
      addFileReference(
        reference,
        "explicit_file",
        "required",
      );
    }

    for (
      const reference of
        request.references
          .pinnedFiles
    ) {
      addFileReference(
        reference,
        "pinned_file",
        reference.priority,
      );
    }

    if (
      request.references
        .currentFile
    ) {
      addFileReference(
        request.references
          .currentFile,
        "current_file",
        "preferred",
      );
    }

    for (
      const reference of
        request.references
          .openFiles
    ) {
      addFileReference(
        reference,
        "open_file",
        "supplementary",
      );
    }

    for (
      const reference of
        request.references
          .gitDiffFiles
    ) {
      addFileReference(
        reference,
        "git_diff",
        "preferred",
      );
    }

    for (
      const reference of
        request.references
          .diagnosticFiles
    ) {
      addFileReference(
        reference,
        "diagnostic",
        "preferred",
      );
    }

    for (
      const reference of
        request.references
          .recentEditFiles
    ) {
      addFileReference(
        reference,
        "recent_edit",
        "supplementary",
      );
    }

    const selection =
      request.references
        .currentSelection;

    if (selection) {
      const key =
        this.keyBuilder
          .buildRangeKey(
            selection,
            selection.startLine,
            selection.endLine,
          );

      if (
        this.isExcluded(
          selection.relativePath,
        )
      ) {
        excludedCount += 1;
        dropped.push({
          key,
          relativePath:
            selection
              .relativePath,
          cause:
            "excluded_path",
          priority:
            selection
              .explicitlyReferenced
              ? "required"
              : "preferred",
          score:
            selection
              .explicitlyReferenced
              ? 1
              : 0,
          estimatedTokens:
            0,
          evidence:
            "The selected editor path is excluded by the context-selection safety policy.",
        });
      } else {
        synthesizedReferences +=
          1;
        candidates.set(
          key,
          {
            key,
            entityKind:
              "chunk",
            ...(selection.rootId
              ? {
                  rootId:
                    selection
                      .rootId,
                }
              : {}),
            relativePath:
              selection
                .relativePath,
            chunkId:
              key,
            startLine:
              selection.startLine,
            endLine:
              selection.endLine,
            origins: [
              "current_selection",
            ],
            priority:
              selection
                .explicitlyReferenced
                ? "required"
                : "preferred",
          },
        );
      }
    }

    const warnings:
      ContextCandidatePreparation[
        "warnings"
      ] = [];

    if (
      excludedCount > 0
    ) {
      warnings.push({
        code:
          "excluded_path_removed",
        message:
          CONTEXT_SELECTION_MESSAGES
            .EXCLUDED_PATH_REMOVED,
        count:
          excludedCount,
      });
    }

    if (
      duplicateCount > 0
    ) {
      warnings.push({
        code:
          "duplicate_reference_removed",
        message:
          CONTEXT_SELECTION_MESSAGES
            .DUPLICATE_REFERENCE_REMOVED,
        count:
          duplicateCount,
      });
    }

    return {
      candidates: [
        ...candidates
          .values(),
      ].sort(
        (left, right) =>
          CONTEXT_SELECTION_PRIORITY_ORDER[
            left.priority
          ] -
            CONTEXT_SELECTION_PRIORITY_ORDER[
              right.priority
            ] ||
          left.key.localeCompare(
            right.key,
          ),
      ),
      dropped,
      warnings,
      synthesizedReferences,
    };
  }

  private merge(
    candidate:
      ContextCandidate,
    origin:
      ContextCandidateOrigin,
    priority:
      ContextReferencePriority,
  ): ContextCandidate {
    const origins =
      new Set([
        ...candidate.origins,
        origin,
      ]);

    return {
      ...candidate,
      origins:
        CONTEXT_SELECTION_ORIGIN_ORDER
          .filter(
            (value) =>
              origins.has(
                value,
              ),
          ),
      priority:
        CONTEXT_SELECTION_PRIORITY_ORDER[
          priority
        ] <
        CONTEXT_SELECTION_PRIORITY_ORDER[
          candidate.priority
        ]
          ? priority
          : candidate.priority,
    };
  }

  private isExcluded(
    relativePath: string,
  ): boolean {
    const segments = relativePath
      .replace(
        /\\/g,
        "/",
      )
      .toLowerCase()
      .split("/");

    const fileName =
      segments.at(-1) ??
      "";

    return (
      CONTEXT_SELECTION_EXCLUDED_FILE_NAMES.has(fileName) ||
      segments.some(
        (segment) =>
          CONTEXT_SELECTION_EXCLUDED_PATH_SEGMENTS
            .has(segment),
      )
    );
  }
}
