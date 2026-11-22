import type {
  ReviewChangedFile,
  ReviewExcludeReason,
  ReviewFileDecision,
  ReviewFileFilter,
  ReviewParsedInput,
} from "../contracts";
import {
  estimateDiffTokens,
  isAllowedExtension,
  isDefaultExcludedPath,
  matchesAny,
  normalizeRelativePath,
} from "../internal/pathUtils";

export interface FileSelectionResult {
  decisions: ReviewFileDecision[];
  selected: ReviewChangedFile[];
  retained: ReviewChangedFile[];
  selectedCount: number;
  excludedCount: number;
  totalInsertions: number;
  totalDeletions: number;
}

/**
 * Pure pre-dispatch selection shared by preview and prepare.
 * Gate order: binary → user exclude → include override →
 * extension allowlist → default path → deleted → size ceiling.
 */
export function selectReviewFiles(
  input: ReviewParsedInput,
): FileSelectionResult {
  const filter = input.filter;
  const decisions: ReviewFileDecision[] = [];
  const selected: ReviewChangedFile[] = [];
  const retained: ReviewChangedFile[] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;

  for (const file of input.files) {
    const path = normalizeRelativePath(file.path);
    const reason = whyExcluded(file, filter, input.maxDiffTokens);
    const diffTokens =
      reason === "too_large" || reason === "none"
        ? estimateDiffTokens(file.diff)
        : 0;
    const willReview = reason === "none";
    const decision: ReviewFileDecision = {
      path,
      willReview,
      excludeReason: reason,
      insertions: file.insertions,
      deletions: file.deletions,
      diffTokens,
      status: file.status,
    };
    decisions.push(decision);
    totalInsertions += file.insertions;
    totalDeletions += file.deletions;

    if (willReview) {
      selected.push({ ...file, path });
      retained.push({ ...file, path });
    } else if (reason === "deleted") {
      retained.push({ ...file, path });
    }
  }

  const selectedCount = decisions.filter((d) => d.willReview).length;
  const excludedCount = decisions.length - selectedCount;
  return {
    decisions,
    selected,
    retained,
    selectedCount,
    excludedCount,
    totalInsertions,
    totalDeletions,
  };
}

function whyExcluded(
  file: ReviewChangedFile,
  filter: ReviewFileFilter | undefined,
  maxDiffTokens: number,
): ReviewExcludeReason {
  const path = normalizeRelativePath(file.path);
  if (file.isBinary) {
    return "binary";
  }
  if (filter?.exclude?.length && matchesAny(path, filter.exclude)) {
    return "user_exclude";
  }
  if (filter?.include?.length) {
    if (matchesAny(path, filter.include)) {
      return sizeOrDeleted(file, maxDiffTokens);
    }
    // Has include list but path not included → treat as user exclude
    return "user_exclude";
  }
  if (!isAllowedExtension(path)) {
    return "unsupported_ext";
  }
  if (isDefaultExcludedPath(path)) {
    return "default_path";
  }
  return sizeOrDeleted(file, maxDiffTokens);
}

function sizeOrDeleted(
  file: ReviewChangedFile,
  maxDiffTokens: number,
): ReviewExcludeReason {
  if (file.isDeleted) {
    return "deleted";
  }
  const tokens = estimateDiffTokens(file.diff || file.content || "");
  if (maxDiffTokens > 0 && tokens > maxDiffTokens) {
    return "too_large";
  }
  return "none";
}
