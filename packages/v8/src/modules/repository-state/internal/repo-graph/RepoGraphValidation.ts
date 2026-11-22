import type {
  RepoGraphBuildInput,
  RepoGraphBuilderOptions,
} from "./types";

export function validateRepoGraphInput(
  input: RepoGraphBuildInput,
): void {
  if (
    input.catalog.workspaceSnapshotId !==
    input.snapshot.snapshotId
  ) {
    throw new Error(
      "ProjectCatalog.workspaceSnapshotId must match WorkspaceSnapshot.snapshotId.",
    );
  }

  if (!input.rootIds) {
    return;
  }

  if (
    new Set(input.rootIds).size !==
    input.rootIds.length
  ) {
    throw new RangeError(
      "RepoGraphBuildInput.rootIds must be unique.",
    );
  }

  const snapshotRootIds = new Set(
    input.snapshot.roots.map((root) => root.id),
  );

  for (const rootId of input.rootIds) {
    if (!snapshotRootIds.has(rootId)) {
      throw new RangeError(
        `Unknown workspace root ID "${rootId}".`,
      );
    }
  }
}

export function validateRepoGraphOptions(
  options: Required<RepoGraphBuilderOptions>,
): void {
  const positiveValues = {
    maximumFiles: options.maximumFiles,
    maximumSymbolsPerFile:
      options.maximumSymbolsPerFile,
    maximumSymbolNodes: options.maximumSymbolNodes,
    maximumNodes: options.maximumNodes,
    maximumEdges: options.maximumEdges,
    maximumEvidencePerEdge:
      options.maximumEvidencePerEdge,
    symbolBatchSize: options.symbolBatchSize,
    graphBatchSize: options.graphBatchSize,
  };

  for (const [name, value] of Object.entries(
    positiveValues,
  )) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(
        `${name} must be a positive safe integer.`,
      );
    }
  }

  if (
    !Number.isSafeInteger(
      options.maximumConsistencyRetries,
    ) ||
    options.maximumConsistencyRetries < 0
  ) {
    throw new RangeError(
      "maximumConsistencyRetries must be a non-negative safe integer.",
    );
  }
}
