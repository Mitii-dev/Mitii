import { throwIfCodeIndexAborted } from "../../CodeIndexError";

import { codeIndexFileQueryResultSchema } from "../../schema";

import type {
  CodeIndexContext,
  CodeIndexFile,
  CodeIndexFileQuery,
  CodeIndexFileQueryResult,
} from "../../types";

import {
  getSnapshotFiles,
  languageProperty,
  loadFileRows,
  normalizePath,
  normalizeSqliteCodeIndexError,
  validatePositiveInteger,
  type SqliteCodeIndexState,
} from "./sqliteCodeIndexSupport";

export async function sqliteGetFiles(
  state: SqliteCodeIndexState,
  query: CodeIndexFileQuery,
  context: CodeIndexContext,
): Promise<CodeIndexFileQueryResult> {
  throwIfCodeIndexAborted(context.abortSignal);

  validatePositiveInteger(
    query.maximumFiles,
    "maximumFiles",
  );

  if (
    query.rootIds &&
    !query.rootIds.includes(state.rootId)
  ) {
    return { files: [], totalAvailable: 0, truncated: false };
  }

  const folderPrefix = normalizePath(
    query.folderPrefix ?? "",
  );

  const snapshotFiles = getSnapshotFiles(
    state,
    context,
    folderPrefix,
  );

  if (snapshotFiles.length === 0) {
    return { files: [], totalAvailable: 0, truncated: false };
  }

  const snapshotByPath = new Map(
    snapshotFiles.map((entry) => [
      normalizePath(entry.relativePath),
      entry,
    ]),
  );

  try {
    const rows = await loadFileRows(
      state,
      [...snapshotByPath.keys()],
      context,
    );

    const files: CodeIndexFile[] = [];

    for (const row of rows) {
      const relativePath = normalizePath(row.relativePath);
      const snapshotEntry = snapshotByPath.get(relativePath);

      if (!snapshotEntry) {
        continue;
      }

      files.push({
        id: state.idBuilder.createFileId({
          rootId: state.rootId,
          relativePath,
        }),

        rootId: state.rootId,
        relativePath,

        ...languageProperty(relativePath),

        ...(snapshotEntry.size !== undefined
          ? { size: snapshotEntry.size }
          : {}),

        ...(snapshotEntry.modifiedAt
          ? { modifiedAt: snapshotEntry.modifiedAt }
          : {}),

        ...(snapshotEntry.contentHash
          ? { contentHash: snapshotEntry.contentHash }
          : {}),
      });
    }

    files.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );

    const totalAvailable = files.length;

    return codeIndexFileQueryResultSchema.parse({
      files: files.slice(0, query.maximumFiles),
      totalAvailable,
      truncated: totalAvailable > query.maximumFiles,
    }) as CodeIndexFileQueryResult;
  } catch (error) {
    throw normalizeSqliteCodeIndexError(
      state,
      error,
      "Unable to read indexed files from SQLite.",
      "get_files",
    );
  }
}
