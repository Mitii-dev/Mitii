import type {
  ReviewChangedFile,
  ReviewFileGroup,
  ReviewParsedInput,
  ReviewWarning,
} from "../contracts";
import { fingerprintGroup, normalizeRelativePath } from "../internal/pathUtils";
import { batchScanFiles } from "../internal/scanBatch";

/**
 * Heuristic grouping. P0: no LLM — bundle small change sets,
 * otherwise one file per group, capped by maxFilesPerGroup / token budget.
 */
export function groupReviewFiles(params: {
  selected: readonly ReviewChangedFile[];
  input: ReviewParsedInput;
}): { groups: ReviewFileGroup[]; warnings: ReviewWarning[] } {
  const warnings: ReviewWarning[] = [];
  const files = params.selected.map((f) => ({
    ...f,
    path: normalizeRelativePath(f.path),
  }));

  if (files.length === 0) {
    return { groups: [], warnings };
  }

  if (params.input.mode === "scan") {
    const batches = batchScanFiles(files, params.input.scanBatchSize);
    return {
      groups: batches.map((batch, index) => ({
        groupId: `scan-${index + 1}`,
        label: batch.label,
        paths: batch.paths,
      })),
      warnings,
    };
  }

  if (files.length === 1) {
    return {
      groups: [
        {
          groupId: "g1",
          label: files[0]!.path,
          paths: [files[0]!.path],
        },
      ],
      warnings,
    };
  }

  const totalChurn = files.reduce(
    (sum, f) => sum + f.insertions + f.deletions,
    0,
  );
  const canBundleAll =
    files.length < params.input.groupingMinFiles ||
    (files.length <= params.input.maxFilesPerGroup &&
      totalChurn <= params.input.groupingBundleLineThreshold);

  if (canBundleAll && files.length <= params.input.maxFilesPerGroup) {
    const paths = files.map((f) => f.path);
    return {
      groups: [
        {
          groupId: "g1",
          label: "small change set",
          paths,
        },
      ],
      warnings,
    };
  }

  // Per-file with maxFilesPerGroup chunking for very large sets
  const groups: ReviewFileGroup[] = [];
  let chunk: string[] = [];
  let chunkIndex = 0;
  for (const file of files) {
    chunk.push(file.path);
    if (chunk.length >= params.input.maxFilesPerGroup) {
      chunkIndex += 1;
      groups.push({
        groupId: `g${chunkIndex}`,
        label: chunk.length === 1 ? chunk[0]! : `group ${chunkIndex}`,
        paths: [...chunk],
      });
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    chunkIndex += 1;
    groups.push({
      groupId: `g${chunkIndex}`,
      label: chunk.length === 1 ? chunk[0]! : `group ${chunkIndex}`,
      paths: [...chunk],
    });
  }

  // Prefer one-file-per-group when above thresholds (more stable reviews)
  if (
    files.length >= params.input.groupingMinFiles &&
    totalChurn > params.input.groupingBundleLineThreshold
  ) {
    return {
      groups: files.map((file, index) => ({
        groupId: `g${index + 1}`,
        label: file.path,
        paths: [file.path],
      })),
      warnings,
    };
  }

  // Deduplicate accidental empty
  const unique = groups.filter((g) => g.paths.length > 0);
  if (unique.length === 0) {
    warnings.push({
      code: "group_fallback",
      message: "Grouping produced no groups; falling back to per-file.",
    });
    return {
      groups: files.map((file, index) => ({
        groupId: `g${index + 1}`,
        label: file.path,
        paths: [file.path],
      })),
      warnings,
    };
  }

  // Ensure group fingerprints are stable
  for (const group of unique) {
    void fingerprintGroup(group.paths);
  }
  return { groups: unique, warnings };
}
