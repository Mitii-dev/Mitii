import {
  CODE_INDEXING_SCHEMA_VERSION,
  CODE_INDEXING_SQL,
} from "../../constants";

import type {
  CodeIndexDocument,
  CodeIndexFileLocator,
  SqliteCodeIndexDatabasePort,
  SqliteCodeIndexFileIdRow,
  SqliteCodeIndexRevisionRow,
} from "../../types";

import {
  toMilliseconds,
} from "./SqliteCodeIndexValidation";

/** Prepared-statement operations used by the SQLite Code Index writer. */
export class SqliteCodeIndexStatements {
  constructor(
    private readonly database:
      SqliteCodeIndexDatabasePort,
  ) {}

  public upsertFile(
    document: CodeIndexDocument,
  ): void {
    this.database
      .prepare(
        CODE_INDEXING_SQL.UPSERT_FILE,
      )
      .run(
        document.file.workspace,
        document.file.rootId,
        document.file.providerPath ??
          document.file.relativePath,
        document.file.relativePath,
        document.file.contentHash,
        document.file.size,
        toMilliseconds(
          document.file.modifiedAt,
        ),
        document.file.language ?? null,
        document.indexedAt,
        document.file.analysisVersion,
        document.status,
        document.quality,
        document.parserId ?? null,
        document.workspaceSnapshotId,
      );
  }

  public requireFileId(
    file: CodeIndexFileLocator,
  ): number {
    const row = this.database
      .prepare(
        CODE_INDEXING_SQL.GET_FILE_ID,
      )
      .get(
        file.workspace,
        file.rootId,
        file.relativePath,
      ) as
      | SqliteCodeIndexFileIdRow
      | undefined;

    if (
      !row ||
      !Number.isSafeInteger(row.id)
    ) {
      throw new Error(
        `Unable to resolve the database ID for "${file.relativePath}".`,
      );
    }

    return row.id;
  }

  public deleteFacts(
    fileId: number,
  ): void {
    this.database
      .prepare(
        CODE_INDEXING_SQL
          .DELETE_REFERENCES,
      )
      .run(fileId);

    this.database
      .prepare(
        CODE_INDEXING_SQL
          .DELETE_IMPORTS,
      )
      .run(fileId);

    this.database
      .prepare(
        CODE_INDEXING_SQL
          .DELETE_SYMBOLS,
      )
      .run(fileId);
  }

  public insertSymbols(
    fileId: number,
    document: CodeIndexDocument,
  ): Map<string, number> {
    const ids =
      new Map<string, number>();

    const statement =
      this.database.prepare(
        CODE_INDEXING_SQL
          .INSERT_SYMBOL,
      );

    for (
      const symbol of
      document.symbols
    ) {
      const result = statement.run(
        fileId,
        symbol.localId,
        symbol.name,
        symbol.kind,
        symbol.signature ?? null,
        symbol.startLine,
        symbol.endLine ?? null,
        symbol.exported === undefined
          ? null
          : symbol.exported
            ? 1
            : 0,
        symbol.startColumn ?? null,
        symbol.endColumn ?? null,
      );

      const databaseId =
        Number(
          result.lastInsertRowid,
        );

      if (
        !Number.isSafeInteger(
          databaseId,
        )
      ) {
        throw new Error(
          `SQLite returned an invalid symbol ID for "${symbol.localId}".`,
        );
      }

      ids.set(
        symbol.localId,
        databaseId,
      );
    }

    return ids;
  }

  public connectSymbolParents(
    document: CodeIndexDocument,
    ids: ReadonlyMap<string, number>,
  ): void {
    const statement =
      this.database.prepare(
        CODE_INDEXING_SQL
          .UPDATE_SYMBOL_PARENT,
      );

    for (
      const symbol of
      document.symbols
    ) {
      if (!symbol.parentLocalId) {
        continue;
      }

      const symbolId =
        ids.get(symbol.localId);
      const parentId =
        ids.get(
          symbol.parentLocalId,
        );

      if (
        symbolId === undefined ||
        parentId === undefined
      ) {
        throw new Error(
          `Unable to resolve symbol parent for "${symbol.localId}".`,
        );
      }

      statement.run(
        parentId,
        symbolId,
      );
    }
  }

  public insertImports(
    fileId: number,
    document: CodeIndexDocument,
  ): void {
    const statement =
      this.database.prepare(
        CODE_INDEXING_SQL
          .INSERT_IMPORT,
      );

    for (
      const item of
      document.imports
    ) {
      const persistedPath =
        item.targetRelativePath ??
        item.candidateRelativePath ??
        item.specifier;

      statement.run(
        fileId,
        persistedPath,
        item.specifier,
        item.line,
        item.resolution,
        item.kind,
        JSON.stringify(
          item.importedNames,
        ),
        item.column ?? null,
        item.candidateRelativePath ??
          null,
      );
    }
  }

  public insertReferences(
    fileId: number,
    document: CodeIndexDocument,
  ): void {
    const statement =
      this.database.prepare(
        CODE_INDEXING_SQL
          .INSERT_REFERENCE,
      );

    for (
      const item of
      document.references
    ) {
      statement.run(
        fileId,
        item.symbolName,
        item.line,
        item.kind,
        item.column ?? null,
      );
    }
  }

  public bumpRevision(
    workspace: string,
    rootId: string,
    workspaceSnapshotId: string,
    changedAt: number,
  ): number {
    this.database
      .prepare(
        CODE_INDEXING_SQL
          .ENSURE_METADATA,
      )
      .run(
        workspace,
        rootId,
        CODE_INDEXING_SCHEMA_VERSION,
        workspaceSnapshotId,
        changedAt,
      );

    this.database
      .prepare(
        CODE_INDEXING_SQL
          .BUMP_REVISION,
      )
      .run(
        CODE_INDEXING_SCHEMA_VERSION,
        workspaceSnapshotId,
        changedAt,
        workspace,
        rootId,
      );

    return this.readRevision(
      workspace,
      rootId,
    );
  }

  public readRevision(
    workspace: string,
    rootId: string,
  ): number {
    const row = this.database
      .prepare(
        CODE_INDEXING_SQL
          .GET_REVISION,
      )
      .get(
        workspace,
        rootId,
      ) as
      | SqliteCodeIndexRevisionRow
      | undefined;

    return row?.revision ?? 0;
  }
}
