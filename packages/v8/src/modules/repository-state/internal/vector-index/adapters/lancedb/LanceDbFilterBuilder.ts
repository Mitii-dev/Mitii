import {
  VECTOR_INDEX_COLUMNS,
  VECTOR_INDEX_IDS,
  VECTOR_INDEX_LANCEDB,
} from "../../constants";

import type {
  NormalizedVectorSearchRequest,
} from "../../types";

export class LanceDbFilterBuilder {
  public readonly id =
    VECTOR_INDEX_IDS
      .LANCEDB_FILTER_BUILDER;

  public buildSearchFilter(
    request:
      NormalizedVectorSearchRequest,
  ): string {
    const filters = [
      this.equals(
        VECTOR_INDEX_COLUMNS
          .ROW_TYPE,
        VECTOR_INDEX_LANCEDB
          .VECTOR_ROW_TYPE,
      ),
      `${VECTOR_INDEX_COLUMNS.ACTIVE} = true`,
      this.equals(
        VECTOR_INDEX_COLUMNS
          .WORKSPACE,
        request.workspace,
      ),
      this.equals(
        VECTOR_INDEX_COLUMNS
          .PROFILE_ID,
        request.profile.id,
      ),
    ];

    this.addInFilter(
      filters,
      VECTOR_INDEX_COLUMNS
        .ROOT_ID,
      request.rootIds,
    );

    this.addFileScopeFilter(
      filters,
      request,
    );

    this.addInFilter(
      filters,
      VECTOR_INDEX_COLUMNS
        .KIND,
      request.kinds,
    );

    return filters.join(
      " AND ",
    );
  }

  public buildStateFilter(
    workspace: string,
    rootId: string,
    profileId: string,
  ): string {
    return [
      this.equals(
        VECTOR_INDEX_COLUMNS
          .ROW_TYPE,
        VECTOR_INDEX_LANCEDB
          .STATE_ROW_TYPE,
      ),
      this.equals(
        VECTOR_INDEX_COLUMNS
          .WORKSPACE,
        workspace,
      ),
      this.equals(
        VECTOR_INDEX_COLUMNS
          .ROOT_ID,
        rootId,
      ),
      this.equals(
        VECTOR_INDEX_COLUMNS
          .PROFILE_ID,
        profileId,
      ),
    ].join(" AND ");
  }

  public buildAnyStateFilter(): string {
    return this.equals(
      VECTOR_INDEX_COLUMNS
        .ROW_TYPE,
      VECTOR_INDEX_LANCEDB
        .STATE_ROW_TYPE,
    );
  }

  private addInFilter(
    filters: string[],
    column: string,
    values: readonly string[],
  ): void {
    if (values.length === 0) {
      return;
    }

    filters.push(
      `${column} IN (` +
        values
          .map(
            (value) =>
              this.quote(value),
          )
          .join(", ") +
        ")",
    );
  }

  private addFileScopeFilter(
    filters: string[],
    request:
      NormalizedVectorSearchRequest,
  ): void {
    const clauses: string[] = [];

    if (request.filePaths.length > 0) {
      clauses.push(
        `${VECTOR_INDEX_COLUMNS.RELATIVE_PATH} IN (` +
          request.filePaths
            .map((value) =>
              this.quote(value),
            )
            .join(", ") +
          ")",
      );
    }

    if (request.folderPrefix) {
      const folder =
        this.quote(
          request.folderPrefix,
        );
      const descendantPrefix =
        this.quote(
          `${request.folderPrefix}/`,
        );

      clauses.push(
        `${VECTOR_INDEX_COLUMNS.RELATIVE_PATH} = ${folder} OR ` +
          `starts_with(${VECTOR_INDEX_COLUMNS.RELATIVE_PATH}, ${descendantPrefix})`,
      );
    }

    if (clauses.length > 0) {
      filters.push(`(${clauses.join(" OR ")})`);
    }
  }

  private equals(
    column: string,
    value: string,
  ): string {
    return `${column} = ${this.quote(value)}`;
  }

  private quote(
    value: string,
  ): string {
    return (
      "'" +
      value.replace(
        /'/g,
        "''",
      ) +
      "'"
    );
  }
}
