import {
  CODE_INDEXING_IDS,
  CODE_INDEXING_SCHEMA_VERSION,
  CODE_INDEXING_SQL,
} from "../../constants";

import {
  codeIndexDocumentSchema,
  codeIndexFileLocatorSchema,
  codeIndexFileVersionSchema,
} from "../../schema";

import {
  CodeIndexWriteError,
  throwIfCodeIndexWriteAborted,
} from "../../CodeIndexWriteError";

import type {
  CodeIndexDocument,
  CodeIndexFileLocator,
  CodeIndexFileState,
  CodeIndexFileVersion,
  CodeIndexRemoveMissingInput,
  CodeIndexRemoveMissingResult,
  CodeIndexWriteContext,
  CodeIndexWritePort,
  CodeIndexWriteResult,
  CodeIndexWriteOperation,
  SqliteCodeIndexDatabasePort,
  SqliteCodeIndexFileIdRow,
  SqliteCodeIndexFileStateRow,
  SqliteCodeIndexRevisionRow,
  SqliteCodeIndexWriterOptions,
} from "../../types";

export class SqliteCodeIndexWriter
  implements CodeIndexWritePort
{
  public readonly id: string;

  constructor(
    private readonly database:
      SqliteCodeIndexDatabasePort,
    options:
      SqliteCodeIndexWriterOptions = {},
  ) {
    this.id =
      options.adapterId?.trim() ||
      CODE_INDEXING_IDS.SQLITE_WRITER;
  }

  public async getFileState(
    file: CodeIndexFileLocator,
    context: CodeIndexWriteContext = {},
  ): Promise<CodeIndexFileState | null> {
    throwIfCodeIndexWriteAborted(
      context.abortSignal,
    );

    const locator =
      codeIndexFileLocatorSchema.parse(
        this.toLocator(file),
      ) as CodeIndexFileLocator;

    try {
      const row = this.database
        .prepare(
          CODE_INDEXING_SQL.GET_FILE_STATE,
        )
        .get(
          locator.workspace,
          locator.rootId,
          locator.relativePath,
        ) as
        | SqliteCodeIndexFileStateRow
        | undefined;

      if (!row) {
        return null;
      }

      return {
        workspace: row.workspace,
        rootId: row.rootId,
        relativePath:
          row.relativePath,
        contentHash: row.hash,
        size: row.size,

        ...(row.modifiedAt !== null &&
        row.modifiedAt > 0
          ? {
              modifiedAt:
                new Date(
                  row.modifiedAt,
                ).toISOString(),
            }
          : {}),

        ...(row.language
          ? {
              language:
                row.language,
            }
          : {}),

        ...(row.providerPath
          ? {
              providerPath:
                row.providerPath,
            }
          : {}),

        analysisVersion:
          row.analysisVersion,
        analysisStatus:
          row.analysisStatus,
        indexedAt:
          row.indexedAt,
      };
    } catch (error) {
      throw this.normalizeError(
        error,
        "get_file_state",
        "Unable to read Code Index file state.",
      );
    }
  }

  public async replaceDocument(
    document: CodeIndexDocument,
    context: CodeIndexWriteContext = {},
  ): Promise<CodeIndexWriteResult> {
    throwIfCodeIndexWriteAborted(
      context.abortSignal,
    );

    const validated =
      codeIndexDocumentSchema.parse(
        document,
      ) as CodeIndexDocument;

    try {
      const existing =
        await this.getFileState(
          validated.file,
          context,
        );

      const transaction = this.database.transaction(
        () => {
          throwIfCodeIndexWriteAborted(
            context.abortSignal,
          );

          this.upsertFile(validated);

          const fileId =
            this.requireFileId(
              validated.file,
            );

          this.deleteFacts(fileId);

          const symbolDatabaseIdByLocalId =
            this.insertSymbols(
              fileId,
              validated,
            );

          this.connectSymbolParents(
            validated,
            symbolDatabaseIdByLocalId,
          );

          this.insertImports(
            fileId,
            validated,
          );

          this.insertReferences(
            fileId,
            validated,
          );

          const revision =
            this.bumpRevision(
              validated.file.workspace,
              validated.file.rootId,
              validated.workspaceSnapshotId,
              validated.indexedAt,
            );

          return {
            action: existing
              ? "replaced"
              : "inserted",
            file:
              this.toLocator(
                validated.file,
              ),
            revision,
            counts: {
              symbols:
                validated.symbols.length,
              imports:
                validated.imports.length,
              references:
                validated.references
                  .length,
            },
          };
        },
      ) as unknown;

      return typeof transaction === "function"
        ? transaction() as CodeIndexWriteResult
        : transaction as CodeIndexWriteResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "replace_document",
        "Unable to replace the SQLite Code Index document.",
      );
    }
  }

  public async refreshFileMetadata(
    file: CodeIndexFileVersion,
    workspaceSnapshotId: string,
    changedAt: number,
    context: CodeIndexWriteContext = {},
  ): Promise<CodeIndexWriteResult> {
    throwIfCodeIndexWriteAborted(
      context.abortSignal,
    );

    const validated =
      codeIndexFileVersionSchema.parse(
        file,
      ) as CodeIndexFileVersion;

    this.validateChangeMetadata(
      workspaceSnapshotId,
      changedAt,
    );

    try {
      const transaction = this.database.transaction(
        () => {
          const result = this.database
            .prepare(
              CODE_INDEXING_SQL
                .UPDATE_FILE_METADATA,
            )
            .run(
              validated.providerPath ??
                validated.relativePath,
              validated.size,
              this.toMilliseconds(
                validated.modifiedAt,
              ),
              validated.language ?? null,
              workspaceSnapshotId,
              validated.workspace,
              validated.rootId,
              validated.relativePath,
            );

          if (result.changes === 0) {
            return {
              action: "not_found",
              file:
                this.toLocator(
                  validated,
                ),
              revision:
                this.readRevision(
                  validated.workspace,
                  validated.rootId,
                ),
              counts:
                this.emptyCounts(),
            };
          }

          return {
            action:
              "metadata_refreshed",
            file:
              this.toLocator(
                validated,
              ),
            revision:
              this.bumpRevision(
                validated.workspace,
                validated.rootId,
                workspaceSnapshotId,
                changedAt,
              ),
            counts:
              this.emptyCounts(),
          };
        },
      ) as unknown;

      return typeof transaction === "function"
        ? transaction() as CodeIndexWriteResult
        : transaction as CodeIndexWriteResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "refresh_metadata",
        "Unable to refresh SQLite Code Index file metadata.",
      );
    }
  }

  public async removeFile(
    file: CodeIndexFileLocator,
    workspaceSnapshotId: string,
    changedAt: number,
    context: CodeIndexWriteContext = {},
  ): Promise<CodeIndexWriteResult> {
    throwIfCodeIndexWriteAborted(
      context.abortSignal,
    );

    const locator =
      codeIndexFileLocatorSchema.parse(
        this.toLocator(file),
      ) as CodeIndexFileLocator;

    this.validateChangeMetadata(
      workspaceSnapshotId,
      changedAt,
    );

    try {
      const transaction = this.database.transaction(
        () => {
          const result = this.database
            .prepare(
              CODE_INDEXING_SQL.DELETE_FILE,
            )
            .run(
              locator.workspace,
              locator.rootId,
              locator.relativePath,
            );

          if (result.changes === 0) {
            return {
              action: "not_found",
              file: locator,
              revision:
                this.readRevision(
                  locator.workspace,
                  locator.rootId,
                ),
              counts:
                this.emptyCounts(),
            };
          }

          return {
            action: "removed",
            file: locator,
            revision:
              this.bumpRevision(
                locator.workspace,
                locator.rootId,
                workspaceSnapshotId,
                changedAt,
              ),
            counts:
              this.emptyCounts(),
          };
        },
      ) as unknown;

      return typeof transaction === "function"
        ? transaction() as CodeIndexWriteResult
        : transaction as CodeIndexWriteResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "remove_file",
        "Unable to remove the SQLite Code Index file.",
      );
    }
  }

  public async removeMissingFiles(
    input: CodeIndexRemoveMissingInput,
    context: CodeIndexWriteContext = {},
  ): Promise<CodeIndexRemoveMissingResult> {
    throwIfCodeIndexWriteAborted(
      context.abortSignal,
    );

    this.validateRemoveMissingInput(
      input,
    );

    try {
      const transaction = this.database.transaction(
        () => {
          const retained = new Set(
            input.retainedRelativePaths,
          );

          const rows = this.database
            .prepare(
              CODE_INDEXING_SQL
                .GET_ROOT_FILES,
            )
            .all(
              input.workspace,
              input.rootId,
            ) as Array<{
            relativePath: string;
          }>;

          const removedRelativePaths:
            string[] = [];

          for (const row of rows) {
            if (
              retained.has(
                row.relativePath,
              )
            ) {
              continue;
            }

            const result =
              this.database
                .prepare(
                  CODE_INDEXING_SQL
                    .DELETE_FILE,
                )
                .run(
                  input.workspace,
                  input.rootId,
                  row.relativePath,
                );

            if (result.changes > 0) {
              removedRelativePaths.push(
                row.relativePath,
              );
            }
          }

          const revision =
            removedRelativePaths.length >
            0
              ? this.bumpRevision(
                  input.workspace,
                  input.rootId,
                  input.workspaceSnapshotId,
                  input.changedAt,
                )
              : this.readRevision(
                  input.workspace,
                  input.rootId,
                );

          return {
            removedRelativePaths:
              removedRelativePaths.sort(),
            revision,
          };
        },
      ) as unknown;

      return typeof transaction === "function"
        ? transaction() as CodeIndexRemoveMissingResult
        : transaction as CodeIndexRemoveMissingResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "remove_missing_files",
        "Unable to remove missing SQLite Code Index files.",
      );
    }
  }

  public async getRevision(
    workspace: string,
    rootId: string,
    context: CodeIndexWriteContext = {},
  ): Promise<number> {
    throwIfCodeIndexWriteAborted(
      context.abortSignal,
    );

    if (
      !workspace.trim() ||
      !rootId.trim()
    ) {
      throw new RangeError(
        "workspace and rootId cannot be empty.",
      );
    }

    try {
      return this.readRevision(
        workspace,
        rootId,
      );
    } catch (error) {
      throw this.normalizeError(
        error,
        "get_revision",
        "Unable to read the SQLite Code Index revision.",
      );
    }
  }

  private upsertFile(
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
        this.toMilliseconds(
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

  private requireFileId(
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

  private deleteFacts(
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

  private insertSymbols(
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

  private connectSymbolParents(
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

  private insertImports(
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

  private insertReferences(
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

  private bumpRevision(
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

  private readRevision(
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

  private toMilliseconds(
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

  private validateChangeMetadata(
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

  private validateRemoveMissingInput(
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

    this.validateChangeMetadata(
      input.workspaceSnapshotId,
      input.changedAt,
    );
  }

  private toLocator(
    file: CodeIndexFileLocator,
  ): CodeIndexFileLocator {
    return {
      workspace: file.workspace,
      rootId: file.rootId,
      relativePath:
        file.relativePath,
    };
  }

  private emptyCounts(): {
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

  private normalizeError(
    error: unknown,
    operation: CodeIndexWriteOperation,
    message: string,
  ): Error {
    if (
      error instanceof
        CodeIndexWriteError ||
      (error instanceof Error &&
        error.name === "AbortError")
    ) {
      return error;
    }

    return new CodeIndexWriteError(
      message,
      {
        operation,
        adapterId: this.id,
        cause: error,
      },
    );
  }
}
