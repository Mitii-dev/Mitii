import {
  VECTOR_INDEX_DEFAULTS,
  VECTOR_INDEX_IDS,
  VECTOR_INDEX_LANCEDB,
} from "../../constants";

import {
  VectorIndexError,
} from "../../VectorIndexError";

import {
  VectorIndexTableNameBuilder,
} from "../../VectorIndexTableNameBuilder";

import type {
  EmbeddingProfile,
} from "../../../embedding/types";

import type {
  LanceDbConnectionPort,
  LanceDbRow,
  LanceDbTablePort,
  LanceDbVectorIndexAdapterOptions,
  ResolvedLanceDbVectorIndexAdapterOptions,
} from "../../types";

export class LanceDbTableManager {
  public readonly id =
    VECTOR_INDEX_IDS
      .LANCEDB_TABLE_MANAGER;

  private readonly options:
    ResolvedLanceDbVectorIndexAdapterOptions;

  constructor(
    private readonly connection:
      LanceDbConnectionPort,
    options:
      LanceDbVectorIndexAdapterOptions = {},
    private readonly nameBuilder =
      new VectorIndexTableNameBuilder(),
  ) {
    const tableNamePrefix =
      options.tableNamePrefix ??
      VECTOR_INDEX_DEFAULTS
        .TABLE_NAME_PREFIX;

    this.nameBuilder
      .validatePrefix(
        tableNamePrefix,
      );

    this.options = {
      tableNamePrefix,
    };
  }

  public tableName(
    profileId: string,
  ): string {
    return this.nameBuilder
      .build(
        this.options
          .tableNamePrefix,
        profileId,
      );
  }

  public async openExisting(
    profileId: string,
  ): Promise<
    LanceDbTablePort | null
  > {
    const tableName =
      this.tableName(profileId);

    try {
      const tableNames =
        await this.connection
          .tableNames();

      if (
        !tableNames.includes(
          tableName,
        )
      ) {
        return null;
      }

      return await this.connection
        .openTable(tableName);
    } catch (cause) {
      throw new VectorIndexError(
        `Unable to open LanceDB table "${tableName}".`,
        {
          operation:
            "open_table",
          componentId:
            this.id,
          cause,
        },
      );
    }
  }

  public async create(
    profile: EmbeddingProfile,
    rows: LanceDbRow[],
  ): Promise<LanceDbTablePort> {
    const tableName =
      this.tableName(profile.id);

    try {
      return await this.connection
        .createTable(
          tableName,
          rows,
          {
            mode:
              VECTOR_INDEX_LANCEDB
                .CREATE_MODE,
            existOk:
              false,
          },
        );
    } catch (cause) {
      throw new VectorIndexError(
        `Unable to create LanceDB table "${tableName}".`,
        {
          operation:
            "open_table",
          componentId:
            this.id,
          cause,
        },
      );
    }
  }
}
