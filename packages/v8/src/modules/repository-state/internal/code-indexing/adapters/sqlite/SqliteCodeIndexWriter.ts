import {
  CODE_INDEXING_IDS,
  CODE_INDEXING_SQL,
} from "../../constants";

import {
  SqliteCodeIndexStatements,
} from "./SqliteCodeIndexStatements";

import {
  emptyCounts,
  toLocator,
  toMilliseconds,
  validateChangeMetadata,
  validateRemoveMissingInput,
} from "./SqliteCodeIndexValidation";

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
  SqliteCodeIndexFileStateRow,
  SqliteCodeIndexWriterOptions,
} from "../../types";

export class SqliteCodeIndexWriter
  implements CodeIndexWritePort
{
  public readonly id: string;

  private readonly statements:
    SqliteCodeIndexStatements;

  constructor(
    private readonly database:
      SqliteCodeIndexDatabasePort,
    options:
      SqliteCodeIndexWriterOptions = {},
  ) {
    this.id =
      options.adapterId?.trim() ||
      CODE_INDEXING_IDS.SQLITE_WRITER;

    this.statements =
      new SqliteCodeIndexStatements(
        database,
      );
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
        toLocator(file),
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

          this.statements.upsertFile(validated);

          const fileId =
            this.statements.requireFileId(
              validated.file,
            );

          this.statements.deleteFacts(fileId);

          const symbolDatabaseIdByLocalId =
            this.statements.insertSymbols(
              fileId,
              validated,
            );

          this.statements.connectSymbolParents(
            validated,
            symbolDatabaseIdByLocalId,
          );

          this.statements.insertImports(
            fileId,
            validated,
          );

          this.statements.insertReferences(
            fileId,
            validated,
          );

          const revision =
            this.statements.bumpRevision(
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
              toLocator(
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

    validateChangeMetadata(
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
              toMilliseconds(
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
                toLocator(
                  validated,
                ),
              revision:
                this.statements.readRevision(
                  validated.workspace,
                  validated.rootId,
                ),
              counts:
                emptyCounts(),
            };
          }

          return {
            action:
              "metadata_refreshed",
            file:
              toLocator(
                validated,
              ),
            revision:
              this.statements.bumpRevision(
                validated.workspace,
                validated.rootId,
                workspaceSnapshotId,
                changedAt,
              ),
            counts:
              emptyCounts(),
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
        toLocator(file),
      ) as CodeIndexFileLocator;

    validateChangeMetadata(
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
                this.statements.readRevision(
                  locator.workspace,
                  locator.rootId,
                ),
              counts:
                emptyCounts(),
            };
          }

          return {
            action: "removed",
            file: locator,
            revision:
              this.statements.bumpRevision(
                locator.workspace,
                locator.rootId,
                workspaceSnapshotId,
                changedAt,
              ),
            counts:
              emptyCounts(),
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

    validateRemoveMissingInput(
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
              ? this.statements.bumpRevision(
                  input.workspace,
                  input.rootId,
                  input.workspaceSnapshotId,
                  input.changedAt,
                )
              : this.statements.readRevision(
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
      return this.statements.readRevision(
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
