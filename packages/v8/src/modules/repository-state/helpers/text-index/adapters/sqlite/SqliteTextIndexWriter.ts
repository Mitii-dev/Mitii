import {
  TEXT_INDEX_IDS,
  TEXT_INDEX_SQL,
} from "../../constants";

import {
  textIndexDocumentLocatorSchema,
  textIndexDocumentSchema,
} from "../../schema";

import {
  SqliteTextIndexStatements,
} from "./SqliteTextIndexStatements";

import {
  locatorOf,
  validateChangeMetadata,
  validateWrite,
} from "./SqliteTextIndexValidation";

import {
  TextIndexError,
  throwIfTextIndexAborted,
} from "../../TextIndexError";

import type {
  SqliteTextIndexAdapterOptions,
  SqliteTextIndexDocumentStateRow,
  TextIndexDocument,
  TextIndexDocumentLocator,
  TextIndexDocumentState,
  TextIndexRemoveMissingInput,
  TextIndexRemoveMissingResult,
  TextIndexSqliteDatabasePort,
  TextIndexWriteContext,
  TextIndexWritePort,
  TextIndexWriteResult,
} from "../../types";

interface RelativePathRow {
  relativePath: string;
}

export class SqliteTextIndexWriter
  implements TextIndexWritePort
{
  public readonly id: string;

  private readonly statements:
    SqliteTextIndexStatements;

  constructor(
    private readonly database:
      TextIndexSqliteDatabasePort,
    options:
      SqliteTextIndexAdapterOptions = {},
  ) {
    this.id =
      options.adapterId?.trim() ||
      TEXT_INDEX_IDS.SQLITE_WRITER;

    this.statements =
      new SqliteTextIndexStatements(
        database,
      );
  }

  public async getDocumentState(
    locator: TextIndexDocumentLocator,
    context: TextIndexWriteContext = {},
  ): Promise<TextIndexDocumentState | null> {
    throwIfTextIndexAborted(
      context.abortSignal,
      "get_document_state",
      this.id,
    );

    const validated =
      textIndexDocumentLocatorSchema
        .parse(
          locatorOf(
            locator,
          ),
        ) as
      TextIndexDocumentLocator;

    try {
      const row =
        this.database
          .prepare(
            TEXT_INDEX_SQL
              .GET_DOCUMENT_STATE,
          )
          .get(
            validated.workspace,
            validated.rootId,
            validated.relativePath,
          ) as
          | SqliteTextIndexDocumentStateRow
          | undefined;

      return row
        ? { ...row }
        : null;
    } catch (error) {
      throw this.normalizeError(
        error,
        "get_document_state",
        "Unable to read Text Index document state.",
      );
    }
  }

  public async replaceDocument(
    document: TextIndexDocument,
    context: TextIndexWriteContext = {},
  ): Promise<TextIndexWriteResult> {
    throwIfTextIndexAborted(
      context.abortSignal,
      "replace_document",
      this.id,
    );

    const validated =
      textIndexDocumentSchema
        .parse(document) as
      TextIndexDocument;

    const current =
      await this.getDocumentState(
        validated,
        context,
      );

    try {
      const transaction = this.database
        .transaction(() => {
          throwIfTextIndexAborted(
            context.abortSignal,
            "replace_document",
            this.id,
          );

          const previousChunks =
            this.statements.getDocumentChunkIds(
              validated,
            );

          this.statements.upsertDocument(
            validated,
          );

          this.statements.deleteDocumentFts(
            validated,
          );

          this.statements.deleteDocumentChunks(
            validated,
          );

          for (
            const chunk of
              validated.chunks
          ) {
            this.statements.insertChunk(
              validated.workspace,
              chunk,
            );
          }

          const revision =
            this.statements.bumpRevision(
              validated.workspace,
              validated.rootId,
              validated
                .workspaceSnapshotId,
              validated.indexedAt,
            );

          const nextIds =
            new Set(
              validated.chunks.map(
                (chunk) =>
                  chunk.id,
              ),
            );

          for (
            const previous of
              previousChunks
          ) {
            if (
              !nextIds.has(
                previous.id,
              )
            ) {
              this.statements.insertChange(
                validated.workspace,
                validated.rootId,
                revision,
                "delete",
                previous.id,
                previous
                  .relativePath,
                validated
                  .indexedAt,
              );
            }
          }

          for (
            const chunk of
              validated.chunks
          ) {
            this.statements.insertChange(
              validated.workspace,
              validated.rootId,
              revision,
              "upsert",
              chunk.id,
              chunk.relativePath,
              validated.indexedAt,
            );
          }

          return validateWrite({
            action: current
              ? "replaced"
              : "inserted",
            document:
              locatorOf(
                validated,
              ),
            revision,
            chunksWritten:
              validated.chunks
                .length,
            chunksRemoved:
              previousChunks.length,
          });
        }) as unknown;

      return typeof transaction === "function"
        ? transaction() as TextIndexWriteResult
        : transaction as TextIndexWriteResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "replace_document",
        "Unable to replace the SQLite Text Index document.",
      );
    }
  }

  public async refreshDocumentMetadata(
    document: TextIndexDocument,
    context: TextIndexWriteContext = {},
  ): Promise<TextIndexWriteResult> {
    throwIfTextIndexAborted(
      context.abortSignal,
      "refresh_metadata",
      this.id,
    );

    const validated =
      textIndexDocumentSchema
        .parse(document) as
      TextIndexDocument;

    try {
      const result =
        this.database
          .prepare(
            TEXT_INDEX_SQL
              .UPDATE_DOCUMENT_METADATA,
          )
          .run(
            validated
              .workspaceSnapshotId,
            validated.indexedAt,
            validated.workspace,
            validated.rootId,
            validated.relativePath,
          );

      const revision =
        this.statements.getRevisionValue(
          validated.workspace,
          validated.rootId,
        );

      return validateWrite({
        action:
          result.changes > 0
            ? "metadata_refreshed"
            : "not_found",
        document:
          locatorOf(
            validated,
          ),
        revision,
        chunksWritten: 0,
        chunksRemoved: 0,
      });
    } catch (error) {
      throw this.normalizeError(
        error,
        "refresh_metadata",
        "Unable to refresh Text Index document metadata.",
      );
    }
  }

  public async removeDocument(
    locator: TextIndexDocumentLocator,
    workspaceSnapshotId: string,
    changedAt: number,
    context: TextIndexWriteContext = {},
  ): Promise<TextIndexWriteResult> {
    throwIfTextIndexAborted(
      context.abortSignal,
      "remove_document",
      this.id,
    );

    const validated =
      textIndexDocumentLocatorSchema
        .parse(locator) as
      TextIndexDocumentLocator;

    validateChangeMetadata(
      workspaceSnapshotId,
      changedAt,
    );

    try {
      const transaction = this.database
        .transaction(() => {
          const chunks =
            this.statements.getDocumentChunkIds(
              validated,
            );

          this.statements.deleteDocumentFts(
            validated,
          );

          const result =
            this.database
              .prepare(
                TEXT_INDEX_SQL
                  .DELETE_DOCUMENT,
              )
              .run(
                validated.workspace,
                validated.rootId,
                validated
                  .relativePath,
              );

          if (
            result.changes === 0
          ) {
            return validateWrite({
              action:
                "not_found",
              document:
                validated,
              revision:
                this.statements.getRevisionValue(
                  validated
                    .workspace,
                  validated.rootId,
                ),
              chunksWritten: 0,
              chunksRemoved: 0,
            });
          }

          const revision =
            this.statements.bumpRevision(
              validated.workspace,
              validated.rootId,
              workspaceSnapshotId,
              changedAt,
            );

          for (
            const chunk of chunks
          ) {
            this.statements.insertChange(
              validated.workspace,
              validated.rootId,
              revision,
              "delete",
              chunk.id,
              chunk.relativePath,
              changedAt,
            );
          }

          return validateWrite({
            action: "removed",
            document: validated,
            revision,
            chunksWritten: 0,
            chunksRemoved:
              chunks.length,
          });
        }) as unknown;

      return typeof transaction === "function"
        ? transaction() as TextIndexWriteResult
        : transaction as TextIndexWriteResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "remove_document",
        "Unable to remove the SQLite Text Index document.",
      );
    }
  }

  public async removeMissingDocuments(
    input: TextIndexRemoveMissingInput,
    context: TextIndexWriteContext = {},
  ): Promise<TextIndexRemoveMissingResult> {
    throwIfTextIndexAborted(
      context.abortSignal,
      "remove_missing_documents",
      this.id,
    );

    validateChangeMetadata(
      input.workspaceSnapshotId,
      input.changedAt,
    );

    const retained =
      new Set(
        input
          .retainedRelativePaths,
      );

    try {
      const transaction = this.database
        .transaction(() => {
          const rows =
            this.database
              .prepare(
                TEXT_INDEX_SQL
                  .GET_ROOT_DOCUMENT_PATHS,
              )
              .all(
                input.workspace,
                input.rootId,
              ) as
              RelativePathRow[];

          const removedPaths =
            rows
              .map(
                (row) =>
                  row.relativePath,
              )
              .filter(
                (relativePath) =>
                  !retained.has(
                    relativePath,
                  ),
              );

          if (
            removedPaths.length ===
            0
          ) {
            return {
              removedRelativePaths:
                [],
              removedChunks: 0,
              revision:
                this.statements.getRevisionValue(
                  input.workspace,
                  input.rootId,
                ),
            };
          }

          const chunks =
            removedPaths.flatMap(
              (relativePath) =>
                this.statements.getDocumentChunkIds({
                  workspace:
                    input.workspace,
                  rootId:
                    input.rootId,
                  relativePath,
                }),
            );

          for (
            const relativePath of
              removedPaths
          ) {
            this.statements.deleteDocumentFts({
              workspace:
                input.workspace,
              rootId:
                input.rootId,
              relativePath,
            });

            this.database
              .prepare(
                TEXT_INDEX_SQL
                  .DELETE_DOCUMENT,
              )
              .run(
                input.workspace,
                input.rootId,
                relativePath,
              );
          }

          const revision =
            this.statements.bumpRevision(
              input.workspace,
              input.rootId,
              input
                .workspaceSnapshotId,
              input.changedAt,
            );

          for (
            const chunk of chunks
          ) {
            this.statements.insertChange(
              input.workspace,
              input.rootId,
              revision,
              "delete",
              chunk.id,
              chunk.relativePath,
              input.changedAt,
            );
          }

          return {
            removedRelativePaths:
              removedPaths.sort(),
            removedChunks:
              chunks.length,
            revision,
          };
        }) as unknown;

      return typeof transaction === "function"
        ? transaction() as TextIndexRemoveMissingResult
        : transaction as TextIndexRemoveMissingResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "remove_missing_documents",
        "Unable to remove missing SQLite Text Index documents.",
      );
    }
  }

  private normalizeError(
    error: unknown,
    operation:
      ConstructorParameters<
        typeof TextIndexError
      >[1]["operation"],
    message: string,
  ): TextIndexError {
    if (
      error instanceof
      TextIndexError
    ) {
      return error;
    }

    return new TextIndexError(
      message,
      {
        operation,
        adapterId: this.id,
        cause: error,
      },
    );
  }
}
