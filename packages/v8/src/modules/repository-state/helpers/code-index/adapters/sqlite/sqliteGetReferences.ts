import { SQLITE_CODE_INDEX_SQL } from "../../constants";

import { throwIfCodeIndexAborted } from "../../CodeIndexError";

import { codeIndexReferenceSchema } from "../../schema";

import type {
  CodeIndexContext,
  CodeIndexReference,
  SqliteCodeIndexReferenceRow,
} from "../../types";

import {
  createBatches,
  getSnapshotPathSet,
  normalizePath,
  normalizeSqliteCodeIndexError,
  optionalLine,
  placeholders,
  resolveRequestedFiles,
  type SqliteCodeIndexState,
} from "./sqliteCodeIndexSupport";

interface ReferenceCandidate {
  toFileId: string;
  toSymbolId: string;
}

interface ReferenceGroup {
  fromFileId: string;
  symbolName: string;
  kind: CodeIndexReference["kind"];
  line?: number;
  candidates: Map<string, ReferenceCandidate>;
}

function buildReference(
  group: ReferenceGroup,
): CodeIndexReference {
  const candidates = [...group.candidates.values()];
  const onlyCandidate =
    candidates.length === 1 ? candidates[0] : undefined;

  const base = {
    fromFileId: group.fromFileId,
    symbolName: group.symbolName,
    kind: group.kind,
    ...(group.line !== undefined
      ? { line: group.line }
      : {}),
  };

  const reference = onlyCandidate
    ? {
        ...base,
        resolution: "resolved" as const,
        toFileId: onlyCandidate.toFileId,
        toSymbolId: onlyCandidate.toSymbolId,
      }
    : {
        ...base,
        resolution:
          candidates.length > 1
            ? ("ambiguous" as const)
            : ("unresolved" as const),
      };

  return codeIndexReferenceSchema.parse(
    reference,
  ) as CodeIndexReference;
}

function referenceSortKey(
  reference: CodeIndexReference,
): string {
  return [
    reference.fromFileId,
    reference.line ?? 0,
    reference.symbolName,
    reference.kind,
  ].join("\u0000");
}

export async function sqliteGetReferences(
  state: SqliteCodeIndexState,
  fromFileIds: readonly string[],
  context: CodeIndexContext,
): Promise<readonly CodeIndexReference[]> {
  throwIfCodeIndexAborted(context.abortSignal);

  const snapshotPaths = getSnapshotPathSet(state, context);

  try {
    const resolved = await resolveRequestedFiles(
      state,
      fromFileIds,
      context,
    );

    const groups = new Map<string, ReferenceGroup>();
    const databaseIds = resolved.rows.map((row) => row.id);

    for (const batch of createBatches(state, databaseIds)) {
      throwIfCodeIndexAborted(context.abortSignal);

      const rows = state.database
        .prepare(
          `${SQLITE_CODE_INDEX_SQL.GET_REFERENCES_PREFIX}
             (${placeholders(batch.length)})
             ORDER BY sr.file_id, sr.line, sr.symbol_name, sr.reference_kind, target_symbol.file_id`,
        )
        .all(
          state.workspace,
          ...batch,
        ) as SqliteCodeIndexReferenceRow[];

      for (const row of rows) {
        const fromFileId = resolved.domainIdByDatabaseId.get(
          row.fromFileId,
        );

        if (!fromFileId) {
          continue;
        }

        const key = [
          fromFileId,
          row.symbolName,
          row.kind,
          row.line,
        ].join("\u0000");

        let group = groups.get(key);

        if (!group) {
          group = {
            fromFileId,
            symbolName: row.symbolName,
            kind: row.kind,
            ...optionalLine("line", row.line),
            candidates: new Map(),
          };

          groups.set(key, group);
        }

        const targetPath = row.targetRelativePath
          ? normalizePath(row.targetRelativePath)
          : undefined;

        if (
          !targetPath ||
          !snapshotPaths.has(targetPath) ||
          !row.targetSymbolName ||
          !row.targetSymbolKind
        ) {
          continue;
        }

        const toFileId = state.idBuilder.createFileId({
          rootId: state.rootId,
          relativePath: targetPath,
        });

        const toSymbolId = state.idBuilder.createSymbolId({
          fileId: toFileId,
          kind: row.targetSymbolKind,
          name: row.targetSymbolName,
          ...optionalLine(
            "startLine",
            row.targetSymbolStartLine,
          ),
        });

        group.candidates.set(toSymbolId, {
          toFileId,
          toSymbolId,
        });
      }
    }

    return [...groups.values()]
      .map(buildReference)
      .sort((left, right) =>
        referenceSortKey(left).localeCompare(
          referenceSortKey(right),
        ),
      );
  } catch (error) {
    throw normalizeSqliteCodeIndexError(
      state,
      error,
      "Unable to read references from SQLite.",
      "get_references",
    );
  }
}
