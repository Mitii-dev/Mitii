import { SQLITE_CODE_INDEX_SQL } from "../../constants";

import { throwIfCodeIndexAborted } from "../../CodeIndexError";

import { codeIndexImportSchema } from "../../schema";

import type {
  CodeIndexContext,
  CodeIndexImport,
  SqliteCodeIndexImportRow,
} from "../../types";

import {
  createBatches,
  getSnapshotPathSet,
  normalizeSqliteCodeIndexError,
  optionalLine,
  placeholders,
  resolveRequestedFiles,
  toCanonicalRelativePath,
  type SqliteCodeIndexState,
} from "./sqliteCodeIndexSupport";

export function parseImportedNames(
  value: string | null,
): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return [
      ...new Set(
        parsed
          .filter(
            (item): item is string =>
              typeof item === "string" &&
              Boolean(item.trim()),
          )
          .map((item) => item.trim()),
      ),
    ];
  } catch {
    return [];
  }
}

export function deduplicateImports(
  imports: readonly CodeIndexImport[],
): CodeIndexImport[] {
  const result = new Map<string, CodeIndexImport>();

  for (const item of imports) {
    const target =
      item.resolution === "resolved"
        ? item.toFileId
        : (item.candidateRelativePath ?? "");

    const key = [
      item.resolution,
      item.fromFileId,
      target,
      item.specifier,
      item.line ?? 0,
    ].join("\u0000");

    if (!result.has(key)) {
      result.set(key, item);
    }
  }

  return [...result.values()];
}

export async function sqliteGetImports(
  state: SqliteCodeIndexState,
  fromFileIds: readonly string[],
  context: CodeIndexContext,
): Promise<readonly CodeIndexImport[]> {
  throwIfCodeIndexAborted(context.abortSignal);

  const imports: CodeIndexImport[] = [];
  const snapshotPaths = getSnapshotPathSet(state, context);

  try {
    const resolved = await resolveRequestedFiles(
      state,
      fromFileIds,
      context,
    );

    const databaseIds = resolved.rows.map((row) => row.id);

    for (const batch of createBatches(state, databaseIds)) {
      throwIfCodeIndexAborted(context.abortSignal);

      const rows = state.database
        .prepare(
          `${SQLITE_CODE_INDEX_SQL.GET_IMPORTS_PREFIX}
             (${placeholders(batch.length)})
             ORDER BY fi.from_file_id, fi.line, fi.to_rel_path`,
        )
        .all(
          state.workspace,
          ...batch,
        ) as SqliteCodeIndexImportRow[];

      for (const row of rows) {
        const fromFileId = resolved.domainIdByDatabaseId.get(
          row.fromFileId,
        );

        if (!fromFileId) {
          continue;
        }

        const candidatePath = toCanonicalRelativePath(
          row.targetRelativePath,
        );

        const targetIsCurrent =
          row.targetFileId !== null &&
          candidatePath !== undefined &&
          snapshotPaths.has(candidatePath);

        const item =
          targetIsCurrent && candidatePath
            ? codeIndexImportSchema.parse({
                resolution: "resolved",
                fromFileId,
                toFileId: state.idBuilder.createFileId({
                  rootId: state.rootId,
                  relativePath: candidatePath,
                }),
                resolvedRelativePath: candidatePath,
                specifier: row.specifier,
                ...optionalLine("line", row.line),
                importedNames: parseImportedNames(
                  row.importedNamesJson,
                ),
              })
            : codeIndexImportSchema.parse({
                resolution: "unresolved",
                fromFileId,
                specifier: row.specifier,
                ...optionalLine("line", row.line),
                ...(candidatePath
                  ? { candidateRelativePath: candidatePath }
                  : {}),
                importedNames: parseImportedNames(
                  row.importedNamesJson,
                ),
              });

        imports.push(item as CodeIndexImport);
      }
    }

    return deduplicateImports(imports);
  } catch (error) {
    throw normalizeSqliteCodeIndexError(
      state,
      error,
      "Unable to read imports from SQLite.",
      "get_imports",
    );
  }
}
