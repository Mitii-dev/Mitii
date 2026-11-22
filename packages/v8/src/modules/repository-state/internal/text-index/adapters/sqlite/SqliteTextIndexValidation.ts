import {
  textIndexWriteResultSchema,
} from "../../schema";

import type {
  TextIndexDocumentLocator,
  TextIndexWriteResult,
} from "../../types";

export function locatorOf(
  document:
    TextIndexDocumentLocator,
): TextIndexDocumentLocator {
  return {
    workspace:
      document.workspace,
    rootId:
      document.rootId,
    relativePath:
      document.relativePath,
  };
}

export function validateChangeMetadata(
  snapshotId: string,
  changedAt: number,
): void {
  if (!snapshotId.trim()) {
    throw new TypeError(
      "workspaceSnapshotId must be a non-empty string.",
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

export function validateWrite(
  result: TextIndexWriteResult,
): TextIndexWriteResult {
  return textIndexWriteResultSchema
    .parse(result) as
    TextIndexWriteResult;
}
