import {
  TEXT_INDEX_DEFAULTS,
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
    return this.buildForTable(
      request,
      "text_index_fts",
      this.buildExpression(request),
    );
  }

  public buildTrigram(
    request:
      NormalizedTextSearchRequest,
  ): SqliteTextIndexQuery | null {
    const expression =
      this.buildTrigramExpression(
        request,
      );

    if (!expression) {
      return null;
    }

    return this.buildForTable(
      request,
      "text_index_fts_trigram",
      expression,
    );
  }

  private buildForTable(
    request:
      NormalizedTextSearchRequest,
    tableName: string,
    matchExpression: string,
  ): SqliteTextIndexQuery {
    const alias = "f";
    const conditions: string[] = [
      `${tableName} MATCH ?`,
      `${alias}.workspace = ?`,
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
      matchExpression,
      request.workspace,
    ];

    this.addListCondition(
      conditions,
      parameters,
      `${alias}.root_id`,
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
      `${alias}.kind`,
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
            ${tableName},
            ${TEXT_INDEX_FTS.CONTENT_COLUMN_INDEX},
            ?,
            ?,
            ?,
            ?
          ) AS snippet,
          bm25(
            ${tableName},
            ${weights}
          ) AS rawRank,
          c.start_line AS startLine,
          c.end_line AS endLine,
          c.content_hash AS contentHash,
          c.token_estimate AS tokenEstimate
        FROM ${tableName} AS ${alias}
        JOIN text_index_chunks AS c
          ON c.rowid = ${alias}.rowid
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

  private buildTrigramExpression(
    request:
      NormalizedTextSearchRequest,
  ): string | null {
    const terms = request.terms.filter(
      (term) =>
        term.length >=
        TEXT_INDEX_DEFAULTS
          .MINIMUM_TERM_CHARACTERS,
    );

    if (terms.length === 0) {
      return null;
    }

    if (request.mode === "phrase") {
      const phrase = terms.join(" ");
      return phrase.length >=
        TEXT_INDEX_DEFAULTS
          .MINIMUM_TERM_CHARACTERS
        ? `"${phrase}"`
        : null;
    }

    const operator =
      request.mode === "all"
        ? " AND "
        : " OR ";

    return terms
      .map((term) => `"${term}"`)
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
