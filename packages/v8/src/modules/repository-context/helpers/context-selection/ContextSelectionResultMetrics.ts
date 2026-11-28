import type {
  ContextSelectionBudgetUsage,
  ContextSelectionStatistics,
  ContextSelectionStatus,
  ContextSelectionWarning,
  DroppedContextItem,
  NormalizedContextSelectionBudget,
  NormalizedContextSelectionRequest,
  SelectedContextItem,
} from "./types";

export function resolveStatus(
  request:
    NormalizedContextSelectionRequest,
  items:
    readonly SelectedContextItem[],
  dropped:
    readonly DroppedContextItem[],
  warnings:
    readonly ContextSelectionWarning[],
): ContextSelectionStatus {
  if (
    items.length ===
    0
  ) {
    if (
      dropped.some(
        (item) =>
          item.priority ===
            "required" &&
          (
            item.cause ===
              "required_reference_omitted" ||
            item.cause ===
              "excluded_path"
          ),
      )
    ) {
      return "partial";
    }

    return request.retrieval
      .status ===
      "failed"
      ? "failed"
      : "empty";
  }

  const limitingDrops =
    dropped.some(
      (item) =>
        item.cause ===
          "token_budget" ||
        item.cause ===
          "item_limit" ||
        item.cause ===
          "file_limit" ||
        item.cause ===
          "per_file_limit" ||
        item.cause ===
          "required_reference_omitted" ||
        item.cause ===
          "excluded_path",
    );
  const degraded =
    warnings.some(
      (warning) =>
        warning.code ===
          "upstream_retrieval_partial" ||
        warning.code ===
          "upstream_retrieval_failed" ||
        warning.code ===
          "required_reference_omitted" ||
        warning.code ===
          "representation_downgraded",
    );

  return limitingDrops ||
    degraded
    ? "partial"
    : "complete";
}

export function budgetUsage(
  budget:
    NormalizedContextSelectionBudget,
  usedTokens: number,
): ContextSelectionBudgetUsage {
  return {
    maximumTokens:
      budget.maximumTokens,
    usedTokens,
    remainingTokens:
      budget
        .maximumTokens -
      usedTokens,
    maximumItems:
      budget.maximumItems,
    maximumFiles:
      budget.maximumFiles,
    maximumItemsPerFile:
      budget
        .maximumItemsPerFile,
  };
}

export function statistics(
  items:
    readonly SelectedContextItem[],
  dropped:
    readonly DroppedContextItem[],
  retrievedCandidates: number,
  synthesizedReferences: number,
  consideredCandidates: number,
): ContextSelectionStatistics {
  const fileKeys =
    new Set(
      items.map(
        (item) =>
          `${item.rootId ?? ""}\u0000${item.relativePath}`,
      ),
    );
  const rootIds =
    new Set(
      items.flatMap(
        (item) =>
          item.rootId
            ? [
                item
                  .rootId,
              ]
            : [],
      ),
    );

  return {
    retrievedCandidates,
    synthesizedReferences,
    consideredCandidates,
    selectedItems:
      items.length,
    droppedItems:
      dropped.length,
    selectedFiles:
      fileKeys.size,
    selectedRoots:
      rootIds.size,
    requiredItems:
      count(
        items,
        "priority",
        "required",
      ),
    preferredItems:
      count(
        items,
        "priority",
        "preferred",
      ),
    supplementaryItems:
      count(
        items,
        "priority",
        "supplementary",
      ),
    fullFileItems:
      count(
        items,
        "representation",
        "full_file",
      ),
    exactRangeItems:
      count(
        items,
        "representation",
        "exact_range",
      ),
    targetedExcerptItems:
      count(
        items,
        "representation",
        "targeted_excerpt",
      ),
    fileOutlineItems:
      count(
        items,
        "representation",
        "file_outline",
      ),
    symbolSignatureItems:
      count(
        items,
        "representation",
        "symbol_signature",
      ),
  };
}

function count<
  K extends
    | "priority"
    | "representation",
>(
  items:
    readonly SelectedContextItem[],
  key: K,
  value:
    SelectedContextItem[K],
): number {
  return items.filter(
    (item) =>
      item[key] ===
      value,
  ).length;
}
