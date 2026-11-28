import type {
  CodeIndexFileLocator,
  CodeIndexRemoveMissingInput,
} from "../../types";

export function toMilliseconds(
  value?: string,
): number {
  if (!value) {
    return 0;
  }

  const milliseconds =
    Date.parse(value);

  if (
    !Number.isFinite(milliseconds)
  ) {
    throw new RangeError(
      `Invalid modifiedAt value "${value}".`,
    );
  }

  return milliseconds;
}

export function validateChangeMetadata(
  workspaceSnapshotId: string,
  changedAt: number,
): void {
  if (!workspaceSnapshotId.trim()) {
    throw new RangeError(
      "workspaceSnapshotId cannot be empty.",
    );
  }

  if (
    !Number.isSafeInteger(
      changedAt,
    ) ||
    changedAt < 0
  ) {
    throw new RangeError(
      "changedAt must be a non-negative safe integer.",
    );
  }
}

export function validateRemoveMissingInput(
  input: CodeIndexRemoveMissingInput,
): void {
  if (
    !input.workspace.trim() ||
    !input.rootId.trim()
  ) {
    throw new RangeError(
      "workspace and rootId cannot be empty.",
    );
  }

  if (
    new Set(
      input.retainedRelativePaths,
    ).size !==
    input.retainedRelativePaths
      .length
  ) {
    throw new RangeError(
      "retainedRelativePaths must be unique.",
    );
  }

  validateChangeMetadata(
    input.workspaceSnapshotId,
    input.changedAt,
  );
}

export function toLocator(
  file: CodeIndexFileLocator,
): CodeIndexFileLocator {
  return {
    workspace: file.workspace,
    rootId: file.rootId,
    relativePath:
      file.relativePath,
  };
}

export function emptyCounts(): {
  symbols: 0;
  imports: 0;
  references: 0;
} {
  return {
    symbols: 0,
    imports: 0,
    references: 0,
  };
}
