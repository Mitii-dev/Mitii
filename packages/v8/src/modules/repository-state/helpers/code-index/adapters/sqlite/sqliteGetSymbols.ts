import { SQLITE_CODE_INDEX_SQL } from "../../constants";

import { throwIfCodeIndexAborted } from "../../CodeIndexError";

import {
  codeIndexSymbolQuerySchema,
  codeIndexSymbolSchema,
} from "../../schema";

import type {
  CodeIndexContext,
  CodeIndexSymbol,
  CodeIndexSymbolQuery,
  CodeIndexSymbolQueryResult,
  SqliteCodeIndexSymbolRow,
} from "../../types";

import {
  createBatches,
  normalizeSqliteCodeIndexError,
  optionalLine,
  placeholders,
  resolveRequestedFiles,
  type SqliteCodeIndexState,
} from "./sqliteCodeIndexSupport";

function parentSymbolProperty(
  state: SqliteCodeIndexState,
  fileId: string,
  row: SqliteCodeIndexSymbolRow,
): Partial<{ parentSymbolId: string }> {
  if (!row.parentName || !row.parentKind) {
    return {};
  }

  return {
    parentSymbolId: state.idBuilder.createSymbolId({
      fileId,
      name: row.parentName,
      kind: row.parentKind,
      ...optionalLine("startLine", row.parentStartLine),
    }),
  };
}

export async function sqliteGetSymbols(
  state: SqliteCodeIndexState,
  query: CodeIndexSymbolQuery,
  context: CodeIndexContext,
): Promise<CodeIndexSymbolQueryResult> {
  throwIfCodeIndexAborted(context.abortSignal);

  const validatedQuery = codeIndexSymbolQuerySchema.parse(
    query,
  ) as CodeIndexSymbolQuery;

  const symbolsByFile = new Map<string, CodeIndexSymbol[]>();

  for (const fileId of validatedQuery.fileIds) {
    symbolsByFile.set(fileId, []);
  }

  const truncatedFileIds = new Set<string>();

  try {
    const resolved = await resolveRequestedFiles(
      state,
      validatedQuery.fileIds,
      context,
    );

    const databaseIds = resolved.rows.map((row) => row.id);

    for (const batch of createBatches(state, databaseIds)) {
      throwIfCodeIndexAborted(context.abortSignal);

      const rows = state.database
        .prepare(
          `${SQLITE_CODE_INDEX_SQL.GET_SYMBOLS_PREFIX}
             (${placeholders(batch.length)})
             ORDER BY s.file_id, s.start_line, s.id`,
        )
        .all(
          state.workspace,
          ...batch,
        ) as SqliteCodeIndexSymbolRow[];

      for (const row of rows) {
        const fileId = resolved.domainIdByDatabaseId.get(
          row.fileId,
        );

        if (!fileId) {
          continue;
        }

        const kind = row.kind || "symbol";

        if (
          validatedQuery.kinds &&
          validatedQuery.kinds.length > 0 &&
          !validatedQuery.kinds.includes(kind)
        ) {
          continue;
        }

        if (
          validatedQuery.namePrefix &&
          !row.name
            .toLowerCase()
            .startsWith(
              validatedQuery.namePrefix.toLowerCase(),
            )
        ) {
          continue;
        }

        const fileSymbols = symbolsByFile.get(fileId);

        if (!fileSymbols) {
          continue;
        }

        if (
          fileSymbols.length >=
          validatedQuery.maximumSymbolsPerFile
        ) {
          truncatedFileIds.add(fileId);
          continue;
        }

        const symbol = codeIndexSymbolSchema.parse({
          id: state.idBuilder.createSymbolId({
            fileId,
            kind,
            name: row.name,
            ...optionalLine("startLine", row.startLine),
          }),

          fileId,
          name: row.name,
          kind,

          ...parentSymbolProperty(state, fileId, row),

          ...(row.signature
            ? { signature: row.signature }
            : {}),

          ...(row.exported !== null
            ? { exported: row.exported === 1 }
            : {}),

          ...optionalLine("startLine", row.startLine),
          ...optionalLine("endLine", row.endLine),
        }) as CodeIndexSymbol;

        fileSymbols.push(symbol);
      }
    }

    return {
      symbolsByFile,
      truncatedFileIds: [...truncatedFileIds].sort(),
    };
  } catch (error) {
    throw normalizeSqliteCodeIndexError(
      state,
      error,
      "Unable to read symbols from SQLite.",
      "get_symbols",
    );
  }
}
