import {
  VECTOR_INDEX_IDS,
  VECTOR_INDEX_LANCEDB,
} from "../../constants";

import {
  vectorIndexSearchPageSchema,
} from "../../schema";

import {
  throwIfVectorIndexAborted,
} from "../../VectorIndexError";

import {
  LanceDbFilterBuilder,
} from "./LanceDbFilterBuilder";

import {
  LanceDbProfileGuard,
} from "./LanceDbProfileGuard";

import {
  LanceDbRowMapper,
} from "./LanceDbRowMapper";

import {
  LanceDbTableManager,
} from "./LanceDbTableManager";

import type {
  NormalizedVectorSearchRequest,
  VectorIndexReadContext,
  VectorIndexReadPort,
  VectorIndexSearchPage,
  VectorSearchMatch,
} from "../../types";

export class LanceDbVectorIndexReader
  implements VectorIndexReadPort
{
  public readonly id =
    VECTOR_INDEX_IDS
      .LANCEDB_READER;

  constructor(
    private readonly tableManager:
      LanceDbTableManager,
    private readonly filterBuilder =
      new LanceDbFilterBuilder(),
    private readonly rowMapper =
      new LanceDbRowMapper(),
    private readonly profileGuard =
      new LanceDbProfileGuard(),
  ) {}

  public async search(
    request:
      NormalizedVectorSearchRequest,
    context:
      VectorIndexReadContext = {},
  ): Promise<VectorIndexSearchPage> {
    throwIfVectorIndexAborted(
      context.abortSignal,
      "search",
      this.id,
    );

    const table =
      await this.tableManager
        .openExisting(
          request.profile.id,
        );

    if (!table) {
      return {
        matches: [],
        truncated:
          false,
      };
    }

    await this.profileGuard
      .assertProfile(
        table,
        request.profile,
      );

    const rows =
      await table
        .vectorSearch([
          ...request
            .queryVector,
        ])
        .column(
          VECTOR_INDEX_LANCEDB
            .VECTOR_COLUMN,
        )
        .distanceType(
          "cosine",
        )
        .nprobes(
          request.nprobes,
        )
        .refineFactor(
          request.refineFactor,
        )
        .where(
          this.filterBuilder
            .buildSearchFilter(
              request,
            ),
        )
        .select([
          ...VECTOR_INDEX_LANCEDB
            .SEARCH_COLUMNS,
        ])
        .limit(
          request.candidateLimit,
        )
        .toArray();

    const matches =
      rows.map(
        (row) =>
          this.rowMapper
            .toSearchMatch(row),
      )
        .filter(
          (match) =>
            match.score >=
            request.minimumScore,
        );

    this.sortMatches(
      matches,
    );

    const page:
      VectorIndexSearchPage = {
        matches:
          matches.slice(
            0,
            request.maximumResults,
          ),
        truncated:
          matches.length >
            request.maximumResults ||
          rows.length >=
            request.candidateLimit,
      };

    return vectorIndexSearchPageSchema
      .parse(page) as
      VectorIndexSearchPage;
  }

  private sortMatches(
    matches: VectorSearchMatch[],
  ): void {
    matches.sort(
      (left, right) =>
        right.score -
          left.score ||
        left.rootId
          .localeCompare(
            right.rootId,
          ) ||
        left.relativePath
          .localeCompare(
            right.relativePath,
          ) ||
        left.ordinal -
          right.ordinal ||
        left.chunkId
          .localeCompare(
            right.chunkId,
          ),
    );
  }
}
