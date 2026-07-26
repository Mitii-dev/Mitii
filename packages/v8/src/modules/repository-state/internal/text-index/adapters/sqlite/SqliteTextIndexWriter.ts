import {
  TEXT_INDEX_IDS,
  TEXT_INDEX_SCHEMA_VERSION,
  TEXT_INDEX_SQL,
} from "../../constants";

import {
  textIndexDocumentLocatorSchema,
  textIndexDocumentSchema,
  textIndexWriteResultSchema,
} from "../../schema";

import {
  TextIndexError,
  throwIfTextIndexAborted,
} from "../../TextIndexError";

import type {
  SqliteTextIndexAdapterOptions,
  SqliteTextIndexChunkIdRow,
  SqliteTextIndexDocumentStateRow,
  SqliteTextIndexRevisionRow,
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

  constructor(
    private readonly database:
      TextIndexSqliteDatabasePort,
    options:
      SqliteTextIndexAdapterOptions = {},
  ) {
    this.id =
      options.adapterId?.trim() ||
      TEXT_INDEX_IDS.SQLITE_WRITER;
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
          this.locatorOf(
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
      return this.database
        .transaction(() => {
          throwIfTextIndexAborted(
            context.abortSignal,
            "replace_document",
            this.id,
          );

          const previousChunks =
            this.getDocumentChunkIds(
              validated,
            );

          this.upsertDocument(
            validated,
          );

          this.deleteDocumentChunks(
            validated,
          );

          for (
            const chunk of
              validated.chunks
          ) {
            this.insertChunk(
              validated.workspace,
              chunk,
            );
          }

          const revision =
            this.bumpRevision(
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
              this.insertChange(
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
            this.insertChange(
              validated.workspace,
              validated.rootId,
              revision,
              "upsert",
              chunk.id,
              chunk.relativePath,
              validated.indexedAt,
            );
          }

          return this.validateWrite({
            action: current
              ? "replaced"
              : "inserted",
            document:
              this.locatorOf(
                validated,
              ),
            revision,
            chunksWritten:
              validated.chunks
                .length,
            chunksRemoved:
              previousChunks.length,
          });
        });
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
        this.getRevisionValue(
          validated.workspace,
          validated.rootId,
        );

      return this.validateWrite({
        action:
          result.changes > 0
            ? "metadata_refreshed"
            : "not_found",
        document:
          this.locatorOf(
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

    this.validateChangeMetadata(
      workspaceSnapshotId,
      changedAt,
    );

    try {
      return this.database
        .transaction(() => {
          const chunks =
            this.getDocumentChunkIds(
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
            return this.validateWrite({
              action:
                "not_found",
              document:
                validated,
              revision:
                this.getRevisionValue(
                  validated
                    .workspace,
                  validated.rootId,
                ),
              chunksWritten: 0,
              chunksRemoved: 0,
            });
          }

          const revision =
            this.bumpRevision(
              validated.workspace,
              validated.rootId,
              workspaceSnapshotId,
              changedAt,
            );

          for (
            const chunk of chunks
          ) {
            this.insertChange(
              validated.workspace,
              validated.rootId,
              revision,
              "delete",
              chunk.id,
              chunk.relativePath,
              changedAt,
            );
          }

          return this.validateWrite({
            action: "removed",
            document: validated,
            revision,
            chunksWritten: 0,
            chunksRemoved:
              chunks.length,
          });
        });
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

    this.validateChangeMetadata(
      input.workspaceSnapshotId,
      input.changedAt,
    );

    const retained =
      new Set(
        input
          .retainedRelativePaths,
      );

    try {
      return this.database
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
                this.getRevisionValue(
                  input.workspace,
                  input.rootId,
                ),
            };
          }

          const chunks =
            removedPaths.flatMap(
              (relativePath) =>
                this.getDocumentChunkIds({
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
            this.bumpRevision(
              input.workspace,
              input.rootId,
              input
                .workspaceSnapshotId,
              input.changedAt,
            );

          for (
            const chunk of chunks
          ) {
            this.insertChange(
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
        });
    } catch (error) {
      throw this.normalizeError(
        error,
        "remove_missing_documents",
        "Unable to remove missing SQLite Text Index documents.",
      );
    }
  }

  private upsertDocument(
    document: TextIndexDocument,
  ): void {
    this.database
      .prepare(
        TEXT_INDEX_SQL
          .UPSERT_DOCUMENT,
      )
      .run(
        document.workspace,
        document.rootId,
        document.relativePath,
        document.sourceId,
        document
          .sourceContentHash,
        document.language ?? null,
        document
          .chunkingSchemaVersion,
        document.pipelineVersion,
        document.chunkingStatus,
        document.strategyId ??
          null,
        document.chunks.length,
        document
          .workspaceSnapshotId,
        document.indexedAt,
      );
  }

  private insertChunk(
    workspace: string,
    chunk: TextIndexDocument["chunks"][number],
  ): void {
    this.database
      .prepare(
        TEXT_INDEX_SQL
          .INSERT_CHUNK,
      )
      .run(
        chunk.id,
        workspace,
        chunk.rootId,
        chunk.relativePath,
        chunk.sourceId,
        chunk.strategyId,
        chunk.ordinal,
        chunk.kind,
        chunk.title ?? null,
        chunk.symbolLocalId ??
          null,
        chunk.content,
        chunk
          .sourceContentHash,
        chunk.contentHash,
        chunk.tokenEstimate,
        chunk.startOffset,
        chunk.endOffset,
        chunk.startLine,
        chunk.endLine,
      );
  }

  private deleteDocumentChunks(
    locator: TextIndexDocumentLocator,
  ): void {
    this.database
      .prepare(
        TEXT_INDEX_SQL
          .DELETE_DOCUMENT_CHUNKS,
      )
      .run(
        locator.workspace,
        locator.rootId,
        locator.relativePath,
      );
  }

  private getDocumentChunkIds(
    locator: TextIndexDocumentLocator,
  ): SqliteTextIndexChunkIdRow[] {
    return this.database
      .prepare(
        TEXT_INDEX_SQL
          .GET_DOCUMENT_CHUNK_IDS,
      )
      .all(
        locator.workspace,
        locator.rootId,
        locator.relativePath,
      ) as
      SqliteTextIndexChunkIdRow[];
  }

  private bumpRevision(
    workspace: string,
    rootId: string,
    snapshotId: string,
    changedAt: number,
  ): number {
    this.database
      .prepare(
        TEXT_INDEX_SQL
          .ENSURE_METADATA,
      )
      .run(
        workspace,
        rootId,
        TEXT_INDEX_SCHEMA_VERSION,
        snapshotId,
        changedAt,
      );

    this.database
      .prepare(
        TEXT_INDEX_SQL
          .BUMP_REVISION,
      )
      .run(
        TEXT_INDEX_SCHEMA_VERSION,
        snapshotId,
        changedAt,
        workspace,
        rootId,
      );

    return this.getRevisionValue(
      workspace,
      rootId,
    );
  }

  private getRevisionValue(
    workspace: string,
    rootId: string,
  ): number {
    const row =
      this.database
        .prepare(
          TEXT_INDEX_SQL
            .GET_REVISION,
        )
        .get(
          workspace,
          rootId,
        ) as
        | SqliteTextIndexRevisionRow
        | undefined;

    return row?.revision ?? 0;
  }

  private insertChange(
    workspace: string,
    rootId: string,
    revision: number,
    operation:
      "upsert" | "delete",
    chunkId: string,
    relativePath: string,
    changedAt: number,
  ): void {
    this.database
      .prepare(
        TEXT_INDEX_SQL
          .INSERT_CHANGE,
      )
      .run(
        workspace,
        rootId,
        revision,
        operation,
        chunkId,
        relativePath,
        changedAt,
      );
  }

  private locatorOf(
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

  private validateChangeMetadata(
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

  private validateWrite(
    result: TextIndexWriteResult,
  ): TextIndexWriteResult {
    return textIndexWriteResultSchema
      .parse(result) as
      TextIndexWriteResult;
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
