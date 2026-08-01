import {
  CONTEXT_SELECTION_DEFAULTS,
  CONTEXT_SELECTION_IDS,
  CONTEXT_SELECTION_MESSAGES,
} from "./constants";

import {
  ContextSelectionError,
} from "./ContextSelectionError";

import {
  contextSelectionInputSchema,
} from "./schema";

import type {
  ContextFileReference,
  ContextReferencePriority,
  ContextSelectionBudget,
  ContextSelectionInput,
  ContextSelectionNormalization,
  ContextSelectionWarning,
  NormalizedContextSelectionBudget,
  NormalizedEditorSelectionReference,
  NormalizedPinnedContextReference,
} from "./types";

export class ContextSelectionRequestNormalizer {
  public readonly id =
    CONTEXT_SELECTION_IDS
      .REQUEST_NORMALIZER;

  public normalize(
    input:
      ContextSelectionInput,
  ): ContextSelectionNormalization {
    const parsed =
      contextSelectionInputSchema
        .parse(input) as
        ContextSelectionInput;

    const warnings:
      ContextSelectionWarning[] = [];

    const rawQuery =
      parsed.query.trim() ||
      parsed.retrieval
        .query.trim();

    if (!rawQuery) {
      warnings.push({
        code:
          "empty_query",
        message:
          CONTEXT_SELECTION_MESSAGES
            .EMPTY_QUERY,
      });

      return {
        warnings,
      };
    }

    const query =
      rawQuery.slice(
        0,
        CONTEXT_SELECTION_DEFAULTS
          .MAXIMUM_QUERY_CHARACTERS,
      );

    if (
      query.length <
      rawQuery.length
    ) {
      warnings.push({
        code:
          "query_truncated",
        message:
          CONTEXT_SELECTION_MESSAGES
            .QUERY_TRUNCATED,
      });
    }

    const references =
      parsed.references ?? {};
    let duplicateCount = 0;

    const normalizeGroup = (
      values:
        readonly ContextFileReference[] |
        undefined,
    ): ContextFileReference[] => {
      const result =
        this.uniqueReferences(
          values ?? [],
        );

      duplicateCount +=
        (
          values?.length ??
          0
        ) -
        result.length;

      return result;
    };

    const explicitFiles =
      normalizeGroup(
        references
          .explicitFiles,
      );
    const openFiles =
      normalizeGroup(
        references.openFiles,
      );
    const gitDiffFiles =
      normalizeGroup(
        references
          .gitDiffFiles,
      );
    const diagnosticFiles =
      normalizeGroup(
        references
          .diagnosticFiles,
      );
    const recentEditFiles =
      normalizeGroup(
        references
          .recentEditFiles,
      );

    const pinnedFiles =
      this.normalizePinned(
        references
          .pinnedFiles ??
        [],
      );

    duplicateCount +=
      (
        references
          .pinnedFiles
          ?.length ??
        0
      ) -
      pinnedFiles.length;

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

    const currentFile =
      references.currentFile
        ? this.normalizeReference(
            references.currentFile,
          )
        : undefined;

    const currentSelection =
      references.currentSelection
        ? this.normalizeSelection(
            references
              .currentSelection,
          )
        : undefined;

    const budget =
      this.resolveBudget(
        parsed.budget,
      );

    return {
      request: {
        query,
        retrieval:
          parsed.retrieval,
        mode:
          parsed.mode ??
          CONTEXT_SELECTION_DEFAULTS
            .MODE,
        breadth:
          parsed.breadth ??
          CONTEXT_SELECTION_DEFAULTS
            .BREADTH,
        references: {
          explicitFiles,
          pinnedFiles,
          ...(currentFile
            ? {
                currentFile,
              }
            : {}),
          ...(currentSelection
            ? {
                currentSelection,
              }
            : {}),
          openFiles,
          gitDiffFiles,
          diagnosticFiles,
          recentEditFiles,
        },
        budget,
      },
      warnings,
    };
  }

  private resolveBudget(
    budget:
      ContextSelectionBudget |
      undefined,
  ): NormalizedContextSelectionBudget {
    const maximumItems =
      budget
        ?.maximumItems ??
      CONTEXT_SELECTION_DEFAULTS
        .MAXIMUM_ITEMS;
    const resolved:
      NormalizedContextSelectionBudget = {
      maximumTokens:
        budget
          ?.maximumTokens ??
        CONTEXT_SELECTION_DEFAULTS
          .MAXIMUM_TOKENS,
      maximumItems:
        maximumItems,
      maximumFiles:
        budget
          ?.maximumFiles ??
        CONTEXT_SELECTION_DEFAULTS
          .MAXIMUM_FILES,
      maximumItemsPerFile:
        budget
          ?.maximumItemsPerFile ??
        Math.min(
          CONTEXT_SELECTION_DEFAULTS
            .MAXIMUM_ITEMS_PER_FILE,
          maximumItems,
        ),
      minimumItems:
        budget
          ?.minimumItems ??
        CONTEXT_SELECTION_DEFAULTS
          .MINIMUM_ITEMS,
      minimumScore:
        budget
          ?.minimumScore ??
        CONTEXT_SELECTION_DEFAULTS
          .MINIMUM_SCORE,
    };

    if (
      resolved.minimumItems >
        resolved.maximumItems ||
      resolved
        .maximumItemsPerFile >
        resolved.maximumItems
    ) {
      throw new ContextSelectionError(
        CONTEXT_SELECTION_MESSAGES
          .INVALID_BUDGET,
        {
          operation:
            "normalize_request",
          componentId:
            this.id,
        },
      );
    }

    return resolved;
  }

  private normalizePinned(
    references:
      readonly (
        ContextFileReference & {
          priority?:
            ContextReferencePriority;
        }
      )[],
  ): NormalizedPinnedContextReference[] {
    const byKey =
      new Map<
        string,
        NormalizedPinnedContextReference
      >();

    for (
      const reference of
        references
    ) {
      const normalized =
        this.normalizeReference(
          reference,
        );
      const priority =
        reference.priority ??
        "preferred";
      const key =
        this.referenceKey(
          normalized,
        );
      const existing =
        byKey.get(key);

      if (
        !existing ||
        this.priorityRank(
          priority,
        ) <
          this.priorityRank(
            existing.priority,
          )
      ) {
        byKey.set(
          key,
          {
            ...normalized,
            priority,
          },
        );
      }
    }

    return [
      ...byKey.values(),
    ].sort(
      (left, right) =>
        this.compareReferences(
          left,
          right,
        ),
    );
  }

  private normalizeSelection(
    reference:
      ContextFileReference & {
        startLine: number;
        endLine: number;
        explicitlyReferenced?:
          boolean;
      },
  ): NormalizedEditorSelectionReference {
    return {
      ...this.normalizeReference(
        reference,
      ),
      startLine:
        reference.startLine,
      endLine:
        reference.endLine,
      explicitlyReferenced:
        reference
          .explicitlyReferenced ??
        false,
    };
  }

  private uniqueReferences(
    references:
      readonly ContextFileReference[],
  ): ContextFileReference[] {
    const byKey =
      new Map<
        string,
        ContextFileReference
      >();

    for (
      const reference of
        references
    ) {
      const normalized =
        this.normalizeReference(
          reference,
        );

      byKey.set(
        this.referenceKey(
          normalized,
        ),
        normalized,
      );
    }

    return [
      ...byKey.values(),
    ].sort(
      (left, right) =>
        this.compareReferences(
          left,
          right,
        ),
    );
  }

  private normalizeReference(
    reference:
      ContextFileReference,
  ): ContextFileReference {
    const relativePath =
      reference.relativePath
        .trim()
        .replace(
          /\\/g,
          "/",
        )
        .replace(
          /^\.\/+/,
          "",
        )
        .replace(
          /\/+/g,
          "/",
        )
        .replace(
          /\/$/,
          "",
        );

    if (
      !relativePath ||
      relativePath
        .startsWith("/") ||
      relativePath
        .split("/")
        .some(
          (segment) =>
            !segment ||
            segment ===
              "." ||
            segment ===
              "..",
        )
    ) {
      throw new ContextSelectionError(
        `Invalid context reference path "${reference.relativePath}".`,
        {
          operation:
            "normalize_request",
          componentId:
            this.id,
        },
      );
    }

    const rootId =
      reference.rootId
        ?.trim();

    return {
      ...(rootId
        ? {
            rootId,
          }
        : {}),
      relativePath,
    };
  }

  private referenceKey(
    reference:
      ContextFileReference,
  ): string {
    return `${reference.rootId ?? ""}\u0000${reference.relativePath}`;
  }

  private compareReferences(
    left:
      ContextFileReference,
    right:
      ContextFileReference,
  ): number {
    return (
      (
        left.rootId ??
        ""
      ).localeCompare(
        right.rootId ??
          "",
      ) ||
      left.relativePath
        .localeCompare(
          right.relativePath,
        )
    );
  }

  private priorityRank(
    priority:
      ContextReferencePriority,
  ): number {
    if (
      priority ===
      "required"
    ) {
      return 0;
    }

    if (
      priority ===
      "preferred"
    ) {
      return 1;
    }

    return 2;
  }
}
