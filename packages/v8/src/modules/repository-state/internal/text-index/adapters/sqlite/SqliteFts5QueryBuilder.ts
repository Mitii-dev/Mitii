import {
  TEXT_INDEX_FTS,
} from "../../constants";

import type {
  NormalizedTextSearchRequest,
  SqliteTextIndexQuery,
} from "../../types";

export class SqliteFts5QueryBuilder {
  public build(
    request:
      NormalizedTextSearchRequest,
  ): SqliteTextIndexQuery {
    const conditions: string[] = [
      "text_index_fts MATCH ?",
      "f.workspace = ?",
    ];

    const parameters: unknown[] = [
      TEXT_INDEX_FTS
        .SNIPPET_OPEN,
      TEXT_INDEX_FTS
        .SNIPPET_CLOSE,
      TEXT_INDEX_FTS
        .SNIPPET_ELLIPSIS,
      request
        .snippetTokenCount,
      this.buildExpression(
        request,
      ),
      request.workspace,
    ];

    this.addListCondition(
      conditions,
      parameters,
      "f.root_id",
      request.rootIds,
    );

    this.addFileScopeCondition(
      conditions,
      parameters,
      request,
    );

    this.addListCondition(
      conditions,
      parameters,
      "f.kind",
      request.kinds,
    );

    parameters.push(
      request.maximumResults + 1,
    );

    const weights =
      TEXT_INDEX_FTS
        .BM25_WEIGHTS.join(", ");

    return {
      sql: `
        SELECT
          c.id AS chunkId,
          c.root_id AS rootId,
          c.relative_path AS relativePath,
          c.ordinal AS ordinal,
          c.kind AS kind,
          c.title AS title,
          c.symbol_local_id AS symbolLocalId,
          snippet(
            text_index_fts,
            ${TEXT_INDEX_FTS.CONTENT_COLUMN_INDEX},
            ?,
            ?,
            ?,
            ?
          ) AS snippet,
          bm25(
            text_index_fts,
            ${weights}
          ) AS rawRank,
          c.start_line AS startLine,
          c.end_line AS endLine,
          c.content_hash AS contentHash,
          c.token_estimate AS tokenEstimate
        FROM text_index_fts AS f
        JOIN text_index_chunks AS c
          ON c.rowid = f.rowid
        WHERE ${conditions.join("\nAND ")}
        ORDER BY
          rawRank ASC,
          c.relative_path ASC,
          c.ordinal ASC,
          c.id ASC
        LIMIT ?
      `,
      parameters,
    };
  }

  private buildExpression(
    request:
      NormalizedTextSearchRequest,
  ): string {
    if (
      request.mode === "phrase"
    ) {
      const phrase =
        request.terms.join(" ");

      return request
        .prefixMatching
        ? `"${phrase}"*`
        : `"${phrase}"`;
    }

    const operator =
      request.mode === "all"
        ? " AND "
        : " OR ";

    return request.terms
      .map(
        (term) =>
          request.prefixMatching
            ? `"${term}"*`
            : `"${term}"`,
      )
      .join(operator);
  }

  private addListCondition(
    conditions: string[],
    parameters: unknown[],
    column: string,
    values: readonly string[],
  ): void {
    if (values.length === 0) {
      return;
    }

    conditions.push(
      `${column} IN (${values.map(() => "?").join(", ")})`,
    );

    parameters.push(...values);
  }

  private addFileScopeCondition(
    conditions: string[],
    parameters: unknown[],
    request:
      NormalizedTextSearchRequest,
  ): void {
    const clauses: string[] = [];

    if (request.filePaths.length > 0) {
      clauses.push(
        `f.relative_path IN (${request.filePaths.map(() => "?").join(", ")})`,
      );
      parameters.push(...request.filePaths);
    }

    if (request.folderPrefix) {
      clauses.push(
        [
          "f.relative_path = ?",
          "OR",
          "f.relative_path LIKE ? ESCAPE '\\'",
        ].join(" "),
      );
      parameters.push(
        request.folderPrefix,
        `${this.escapeLike(request.folderPrefix)}/%`,
      );
    }

    if (clauses.length > 0) {
      conditions.push(`(${clauses.join(" OR ")})`);
    }
  }

  private escapeLike(
    value: string,
  ): string {
    return value.replace(
      /[\\%_]/g,
      (character) =>
        `\\${character}`,
    );
  }
}
