import {
  TEXT_INDEX_DEFAULTS,
  TEXT_INDEX_IDS,
  TEXT_INDEX_SQL,
} from "../../constants";

import {
  textIndexChangeQueryResultSchema,
  textIndexChunkQueryResultSchema,
  textIndexSearchPageSchema,
} from "../../schema";

import {
  TextIndexError,
  throwIfTextIndexAborted,
} from "../../TextIndexError";

import type {
  NormalizedTextSearchRequest,
  SqliteTextIndexAdapterOptions,
  SqliteTextIndexChangeRow,
  SqliteTextIndexChunkRow,
  SqliteTextIndexRevisionRow,
  SqliteTextSearchRow,
  TextIndexChangeQuery,
  TextIndexChangeQueryResult,
  TextIndexChunkQuery,
  TextIndexChunkQueryResult,
  TextIndexReadContext,
  TextIndexReadPort,
  TextIndexSearchPage,
  TextIndexSqliteReadDatabasePort,
  TextSearchMatch,
} from "../../types";

import {
  SqliteFts5QueryBuilder,
} from "./SqliteFts5QueryBuilder";

export class SqliteTextIndexReader
  implements TextIndexReadPort
{
  public readonly id: string;

  constructor(
    private readonly database:
      TextIndexSqliteReadDatabasePort,

    options:
      SqliteTextIndexAdapterOptions = {},

    private readonly queryBuilder =
      new SqliteFts5QueryBuilder(),
  ) {
    this.id =
      options.adapterId?.trim() ||
      TEXT_INDEX_IDS.SQLITE_READER;
  }

  public async search(
    request:
      NormalizedTextSearchRequest,
    context:
      TextIndexReadContext = {},
  ): Promise<TextIndexSearchPage> {
    throwIfTextIndexAborted(
      context.abortSignal,
      "search",
      this.id,
    );

    try {
      const query =
        this.queryBuilder.build(
          request,
        );

      const rows =
        this.database
          .prepare(query.sql)
          .all(
            ...query.parameters,
          ) as
          SqliteTextSearchRow[];

      const trigramQuery =
        this.queryBuilder.buildTrigram(
          request,
        );

      let trigramRows:
        SqliteTextSearchRow[] = [];

      if (trigramQuery) {
        try {
          trigramRows =
            this.database
              .prepare(
                trigramQuery.sql,
              )
              .all(
                ...trigramQuery
                  .parameters,
              ) as
              SqliteTextSearchRow[];
        } catch {
          trigramRows = [];
        }
      }

      const merged =
        this.mergeSearchRows(
          rows,
          trigramRows,
        );

      const truncated =
        merged.length >
        request.maximumResults;

      const selectedRows =
        merged.slice(
          0,
          request.maximumResults,
        );

      const matches =
        this.mapSearchRows(
          selectedRows,
        );

      return textIndexSearchPageSchema
        .parse({
          matches,
          truncated,
        }) as
        TextIndexSearchPage;
    } catch (error) {
      throw this.normalizeError(
        error,
        "search",
        "Unable to search the SQLite Text Index.",
      );
    }
  }

  public async getChunks(
    query: TextIndexChunkQuery,
    context:
      TextIndexReadContext = {},
  ): Promise<TextIndexChunkQueryResult> {
    throwIfTextIndexAborted(
      context.abortSignal,
      "get_chunks",
      this.id,
    );

    this.validatePositive(
      query.maximumChunks,
      "maximumChunks",
    );

    const uniqueIds = [
      ...new Set(
        query.chunkIds,
      ),
    ];

    const selectedIds =
      uniqueIds.slice(
        0,
        Math.min(
          query.maximumChunks,
          TEXT_INDEX_DEFAULTS
            .MAXIMUM_CHUNK_QUERY_SIZE,
        ),
      );

    if (
      selectedIds.length === 0
    ) {
      return {
        chunks: [],
        missingChunkIds: [],
        truncated:
          uniqueIds.length > 0,
      };
    }

    try {
      const rows:
        SqliteTextIndexChunkRow[] =
        [];

      for (
        let start = 0;
        start <
        selectedIds.length;
        start +=
          TEXT_INDEX_DEFAULTS
            .SQL_BATCH_SIZE
      ) {
        throwIfTextIndexAborted(
          context.abortSignal,
          "get_chunks",
          this.id,
        );

        const batch =
          selectedIds.slice(
            start,
            start +
              TEXT_INDEX_DEFAULTS
                .SQL_BATCH_SIZE,
          );

        const placeholders =
          batch
            .map(() => "?")
            .join(", ");

        rows.push(
          ...(
            this.database
              .prepare(`
                SELECT
                  id AS id,
                  source_id AS sourceId,
                  root_id AS rootId,
                  relative_path AS relativePath,
                  strategy_id AS strategyId,
                  ordinal AS ordinal,
                  kind AS kind,
                  content AS content,
                  source_content_hash AS sourceContentHash,
                  content_hash AS contentHash,
                  token_estimate AS tokenEstimate,
                  start_offset AS startOffset,
                  end_offset AS endOffset,
                  start_line AS startLine,
                  end_line AS endLine,
                  title AS title,
                  symbol_local_id AS symbolLocalId
                FROM text_index_chunks
                WHERE workspace = ?
                  AND id IN (${placeholders})
              `)
              .all(
                query.workspace,
                ...batch,
              ) as
              SqliteTextIndexChunkRow[]
          ),
        );
      }

      const byId =
        new Map(
          rows.map(
            (row) => [
              row.id,
              row,
            ],
          ),
        );

      const chunks =
        selectedIds.flatMap(
          (id) => {
            const row =
              byId.get(id);

            return row
              ? [
                  this.mapChunkRow(
                    row,
                  ),
                ]
              : [];
          },
        );

      const missingChunkIds =
        selectedIds.filter(
          (id) =>
            !byId.has(id),
        );

      return textIndexChunkQueryResultSchema
        .parse({
          chunks,
          missingChunkIds,
          truncated:
            uniqueIds.length >
            selectedIds.length,
        }) as
        TextIndexChunkQueryResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "get_chunks",
        "Unable to read SQLite Text Index chunks.",
      );
    }
  }

  public async getChanges(
    query: TextIndexChangeQuery,
    context:
      TextIndexReadContext = {},
  ): Promise<TextIndexChangeQueryResult> {
    throwIfTextIndexAborted(
      context.abortSignal,
      "get_changes",
      this.id,
    );

    this.validateNonNegative(
      query.afterRevision,
      "afterRevision",
    );

    this.validatePositive(
      query.maximumChanges,
      "maximumChanges",
    );

    try {
      const rows =
        this.database
          .prepare(
            TEXT_INDEX_SQL
              .GET_CHANGES,
          )
          .all(
            query.workspace,
            query.rootId,
            query.afterRevision,
            query.maximumChanges,
            query.workspace,
            query.rootId,
          ) as
          SqliteTextIndexChangeRow[];

      const latestRevision =
        await this.getRevision(
          query.workspace,
          query.rootId,
          context,
        );

      const lastReturnedRevision =
        rows.at(-1)?.revision ??
        query.afterRevision;

      const truncated =
        lastReturnedRevision <
        latestRevision;

      return textIndexChangeQueryResultSchema
        .parse({
          changes:
            rows.map((row) => ({
                revision:
                  row.revision,
                kind: row.kind,
                chunkId:
                  row.chunkId,
                rootId:
                  row.rootId,
                relativePath:
                  row.relativePath,
                changedAt:
                  row.changedAt,
              })),
          latestRevision,
          truncated,
        }) as
        TextIndexChangeQueryResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "get_changes",
        "Unable to read SQLite Text Index changes.",
      );
    }
  }

  public async getRevision(
    workspace: string,
    rootId: string,
    context:
      TextIndexReadContext = {},
  ): Promise<number> {
    throwIfTextIndexAborted(
      context.abortSignal,
      "get_revision",
      this.id,
    );

    try {
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
    } catch (error) {
      throw this.normalizeError(
        error,
        "get_revision",
        "Unable to read the SQLite Text Index revision.",
      );
    }
  }

  private mergeSearchRows(
    lexicalRows:
      readonly SqliteTextSearchRow[],
    trigramRows:
      readonly SqliteTextSearchRow[],
  ): SqliteTextSearchRow[] {
    const byChunkId =
      new Map<string, SqliteTextSearchRow>();

    for (const row of lexicalRows) {
      byChunkId.set(row.chunkId, row);
    }

    for (const row of trigramRows) {
      const existing =
        byChunkId.get(row.chunkId);

      if (!existing) {
        byChunkId.set(row.chunkId, row);
        continue;
      }

      if (
        Number(row.rawRank) <
        Number(existing.rawRank)
      ) {
        byChunkId.set(row.chunkId, {
          ...existing,
          rawRank: row.rawRank,
        });
      }
    }

    return [...byChunkId.values()].sort(
      (left, right) =>
        Number(left.rawRank) -
          Number(right.rawRank) ||
        left.relativePath.localeCompare(
          right.relativePath,
        ) ||
        left.ordinal - right.ordinal ||
        left.chunkId.localeCompare(
          right.chunkId,
        ),
    );
  }

  private mapSearchRows(
    rows:
      readonly SqliteTextSearchRow[],
  ): TextSearchMatch[] {
    if (rows.length === 0) {
      return [];
    }

    const ranks =
      rows.map(
        (row) =>
          Number(row.rawRank),
      );

    const best =
      Math.min(...ranks);

    const worst =
      Math.max(...ranks);

    return rows.map(
      (row) => ({
        chunkId: row.chunkId,
        rootId: row.rootId,
        relativePath:
          row.relativePath,
        ordinal: row.ordinal,
        kind: row.kind,
        ...(row.title
          ? {
              title: row.title,
            }
          : {}),
        ...(row.symbolLocalId
          ? {
              symbolLocalId:
                row.symbolLocalId,
            }
          : {}),
        snippet: row.snippet,
        score:
          this.normalizeScore(
            Number(row.rawRank),
            best,
            worst,
          ),
        rawRank:
          Number(row.rawRank),
        startLine:
          row.startLine,
        endLine:
          row.endLine,
        contentHash:
          row.contentHash,
        tokenEstimate:
          row.tokenEstimate,
      }),
    );
  }

  private mapChunkRow(
    row:
      SqliteTextIndexChunkRow,
  ) {
    return {
      id: row.id,
      sourceId:
        row.sourceId,
      rootId: row.rootId,
      relativePath:
        row.relativePath,
      strategyId:
        row.strategyId,
      ordinal: row.ordinal,
      kind: row.kind,
      content: row.content,
      sourceContentHash:
        row.sourceContentHash,
      contentHash:
        row.contentHash,
      tokenEstimate:
        row.tokenEstimate,
      startOffset:
        row.startOffset,
      endOffset:
        row.endOffset,
      startLine:
        row.startLine,
      endLine: row.endLine,
      ...(row.title
        ? {
            title: row.title,
          }
        : {}),
      ...(row.symbolLocalId
        ? {
            symbolLocalId:
              row.symbolLocalId,
          }
        : {}),
    };
  }

  private normalizeScore(
    rank: number,
    best: number,
    worst: number,
  ): number {
    if (
      !Number.isFinite(rank)
    ) {
      return 0;
    }

    if (best === worst) {
      return 1;
    }

    const distance =
      (rank - best) /
      (worst - best);

    const range =
      1 -
      TEXT_INDEX_DEFAULTS
        .MINIMUM_NORMALIZED_SCORE;

    return Math.max(
      TEXT_INDEX_DEFAULTS
        .MINIMUM_NORMALIZED_SCORE,
      Math.min(
        1,
        1 - distance * range,
      ),
    );
  }

  private validatePositive(
    value: number,
    name: string,
  ): void {
    if (
      !Number.isSafeInteger(
        value,
      ) ||
      value <= 0
    ) {
      throw new RangeError(
        `${name} must be a positive safe integer.`,
      );
    }
  }

  private validateNonNegative(
    value: number,
    name: string,
  ): void {
    if (
      !Number.isSafeInteger(
        value,
      ) ||
      value < 0
    ) {
      throw new RangeError(
        `${name} must be a non-negative safe integer.`,
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
