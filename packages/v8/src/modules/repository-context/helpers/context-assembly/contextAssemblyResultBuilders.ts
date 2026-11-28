import {
  CONTEXT_ASSEMBLY_SCHEMA_VERSION,
} from "./constants";

import {
  contextAssemblyResultSchema,
} from "./schema";

import type {
  ContextAssemblyWarningAggregator,
} from "./ContextAssemblyWarningAggregator";

import type {
  ContextAssemblyInput,
  ContextAssemblyResult,
  ContextAssemblyStatistics,
  ContextAssemblyStatus,
  ContextAssemblyWarning,
  ContextBlock,
  DroppedContextBlock,
} from "./types";

export interface ContextAssemblyResultParts {
  input: ContextAssemblyInput;
  status: ContextAssemblyStatus;
  blocks: ContextBlock[];
  dropped: DroppedContextBlock[];
  warnings: ContextAssemblyWarning[];
  allocatedTokens: number;
  attemptedItems: number;
  inputCharacters: number;
}

export interface TerminalContextAssemblyParts {
  input: ContextAssemblyInput;
  status: Extract<ContextAssemblyStatus, "empty" | "cancelled" | "failed">;
  allocatedTokens: number;
  warnings: ContextAssemblyWarning[];
  dropped?: DroppedContextBlock[];
  attemptedItems?: number;
  inputCharacters?: number;
}

export function sumAllocatedTokens(
  input: ContextAssemblyInput,
): number {
  return input.selection.items.reduce(
    (sum, item) => sum + item.allocatedTokens,
    0,
  );
}

export function resolveAssemblyStatus(
  input: ContextAssemblyInput,
  blocks: readonly ContextBlock[],
  dropped: readonly DroppedContextBlock[],
  warnings: readonly ContextAssemblyWarning[],
): ContextAssemblyStatus {
  if (blocks.length === 0) {
    return dropped.length > 0 ? "partial" : "empty";
  }

  const degraded =
    input.selection.status === "partial" ||
    input.snapshot.status !== "complete" ||
    dropped.length > 0 ||
    warnings.some(
      (warning) =>
        warning.code === "representation_fallback" ||
        warning.code === "content_source_failed" ||
        warning.code === "required_content_omitted",
    );

  return degraded ? "partial" : "complete";
}

export function buildTerminalAssemblyResult(
  aggregator: ContextAssemblyWarningAggregator,
  parts: TerminalContextAssemblyParts,
): ContextAssemblyResult {
  return buildContextAssemblyResult(aggregator, {
    input: parts.input,
    status: parts.status,
    blocks: [],
    dropped: parts.dropped ?? [],
    warnings: parts.warnings,
    allocatedTokens: parts.allocatedTokens,
    attemptedItems: parts.attemptedItems ?? 0,
    inputCharacters: parts.inputCharacters ?? 0,
  });
}

export function buildContextAssemblyResult(
  aggregator: ContextAssemblyWarningAggregator,
  parts: ContextAssemblyResultParts,
): ContextAssemblyResult {
  const usedTokens = parts.blocks.reduce(
    (sum, block) => sum + block.tokenEstimate,
    0,
  );
  const result: ContextAssemblyResult = {
    schemaVersion: CONTEXT_ASSEMBLY_SCHEMA_VERSION,
    workspaceSnapshotId: parts.input.snapshot.snapshotId,
    selectionStatus: parts.input.selection.status,
    status: parts.status,
    blocks: parts.blocks,
    dropped: parts.dropped,
    warnings: aggregator.aggregate(parts.warnings),
    budget: {
      allocatedTokens: parts.allocatedTokens,
      usedTokens,
      remainingTokens: Math.max(0, parts.allocatedTokens - usedTokens),
    },
    statistics: buildStatistics(parts),
  };

  return contextAssemblyResultSchema.parse(result) as ContextAssemblyResult;
}

function buildStatistics(parts: {
  input: ContextAssemblyInput;
  blocks: readonly ContextBlock[];
  dropped: readonly DroppedContextBlock[];
  attemptedItems: number;
  inputCharacters: number;
}): ContextAssemblyStatistics {
  const fileKeys = new Set(
    parts.blocks.map(
      (block) => `${block.rootId ?? ""}\u0000${block.relativePath}`,
    ),
  );
  const roots = new Set(
    parts.blocks.flatMap((block) => (block.rootId ? [block.rootId] : [])),
  );

  return {
    selectedItems: parts.input.selection.items.length,
    attemptedItems: parts.attemptedItems,
    assembledBlocks: parts.blocks.length,
    droppedBlocks: parts.dropped.length,
    loadedFiles: fileKeys.size,
    loadedRoots: roots.size,
    truncatedBlocks: parts.blocks.filter((block) => block.truncated).length,
    fallbackBlocks: parts.blocks.filter(
      (block) => block.requestedRepresentation !== block.representation,
    ).length,
    redactedBlocks: parts.blocks.filter(
      (block) => block.redactions.length > 0,
    ).length,
    redactionCount: parts.blocks.reduce(
      (sum, block) =>
        sum +
        block.redactions.reduce(
          (redactionSum, redaction) => redactionSum + redaction.count,
          0,
        ),
      0,
    ),
    inputCharacters: parts.inputCharacters,
    outputCharacters: parts.blocks.reduce(
      (sum, block) => sum + block.content.length,
      0,
    ),
  };
}
