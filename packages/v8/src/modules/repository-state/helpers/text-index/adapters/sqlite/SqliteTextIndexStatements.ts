import {
  TEXT_INDEX_SCHEMA_VERSION,
  TEXT_INDEX_SQL,
} from "../../constants";
import {
  expandFtsText,
} from "../../../codeIdentifiers";

import type {
  SqliteTextIndexChunkIdRow,
  SqliteTextIndexRevisionRow,
  TextIndexDocument,
  TextIndexDocumentLocator,
  TextIndexSqliteDatabasePort,
} from "../../types";

/** Prepared-statement operations used by the SQLite Text Index writer. */
export class SqliteTextIndexStatements {
  private trigramTableAvailable:
    boolean | undefined;

  constructor(
    private readonly database:
      TextIndexSqliteDatabasePort,
  ) {}

  public upsertDocument(
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

  public insertChunk(
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

    this.database
      .prepare(
        TEXT_INDEX_SQL
          .INSERT_CHUNK_FTS,
      )
      .run(
        expandFtsText(
          chunk.title ?? "",
        ),
        expandFtsText(
          [
            chunk.relativePath,
            chunk.title ?? "",
            chunk.content,
          ].join(" "),
        ),
        workspace,
        chunk.id,
      );

    this.insertChunkTrigram(
      workspace,
      chunk,
    );
  }

  public insertChunkTrigram(
    workspace: string,
    chunk: TextIndexDocument["chunks"][number],
  ): void {
    if (!this.hasTrigramTable()) {
      return;
    }

    this.database
      .prepare(
        TEXT_INDEX_SQL
          .INSERT_CHUNK_FTS_TRIGRAM,
      )
      .run(
        chunk.title ?? "",
        [
          chunk.relativePath,
          chunk.title ?? "",
          chunk.content,
        ].join(" "),
        workspace,
        chunk.id,
      );
  }

  public deleteDocumentFts(
    locator: TextIndexDocumentLocator,
  ): void {
    this.database
      .prepare(
        TEXT_INDEX_SQL
          .DELETE_DOCUMENT_FTS,
      )
      .run(
        locator.workspace,
        locator.rootId,
        locator.relativePath,
      );

    if (!this.hasTrigramTable()) {
      return;
    }

    this.database
      .prepare(
        TEXT_INDEX_SQL
          .DELETE_DOCUMENT_FTS_TRIGRAM,
      )
      .run(
        locator.workspace,
        locator.rootId,
        locator.relativePath,
      );
  }

  public hasTrigramTable(): boolean {
    if (
      this.trigramTableAvailable !==
      undefined
    ) {
      return this.trigramTableAvailable;
    }

    const row =
      this.database
        .prepare(
          `
            SELECT COUNT(*) AS value
            FROM sqlite_schema
            WHERE type = 'table'
              AND name = 'text_index_fts_trigram'
          `,
        )
        .get() as { value: number };

    this.trigramTableAvailable =
      row.value > 0;

    return this.trigramTableAvailable;
  }

  public deleteDocumentChunks(
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

  public getDocumentChunkIds(
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

  public bumpRevision(
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

  public getRevisionValue(
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

  public insertChange(
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
}
