import {
  TEXT_INDEX_DEFAULTS,
} from "../../constants";

import type {
  SqliteTextIndexChunkRow,
  SqliteTextSearchRow,
  TextSearchMatch,
} from "../../types";

export function mergeSearchRows(
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

export function mapSearchRows(
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
        normalizeScore(
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

export function mapChunkRow(
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

function normalizeScore(
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
