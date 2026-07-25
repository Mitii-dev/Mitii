import {
  VECTOR_INDEX_IDS,
  VECTOR_INDEX_LANCEDB,
  VECTOR_INDEX_MESSAGES,
} from "../../constants";

import {
  VectorIndexError,
  VectorIndexProfileMismatchError,
} from "../../VectorIndexError";

import {
  LanceDbFilterBuilder,
} from "./LanceDbFilterBuilder";

import {
  LanceDbRowMapper,
} from "./LanceDbRowMapper";

import type {
  EmbeddingProfile,
} from "../../../embedding/types";

import type {
  LanceDbTablePort,
} from "../../types";

export class LanceDbProfileGuard {
  constructor(
    private readonly filterBuilder =
      new LanceDbFilterBuilder(),
    private readonly rowMapper =
      new LanceDbRowMapper(),
  ) {}

  public async assertProfile(
    table: LanceDbTablePort,
    profile: EmbeddingProfile,
  ): Promise<void> {
    const rows =
      await table.query()
        .where(
          this.filterBuilder
            .buildAnyStateFilter(),
        )
        .select([
          ...VECTOR_INDEX_LANCEDB
            .PROFILE_COLUMNS,
        ])
        .limit(1)
        .toArray();

    const row = rows[0];

    if (!row) {
      throw new VectorIndexError(
        VECTOR_INDEX_MESSAGES
          .INVALID_LANCEDB_ROW,
        {
          operation:
            "open_table",
          componentId:
            VECTOR_INDEX_IDS
              .LANCEDB_TABLE_MANAGER,
        },
      );
    }

    const stored =
      this.rowMapper
        .readStoredProfile(row);

    if (
      stored.profileId !==
      profile.id
    ) {
      throw new VectorIndexProfileMismatchError(
        {
          expectedProfileId:
            profile.id,
          actualProfileId:
            stored.profileId,
        },
        {
          operation:
            "open_table",
          componentId:
            VECTOR_INDEX_IDS
              .LANCEDB_TABLE_MANAGER,
        },
      );
    }

    if (
      stored.dimensions !==
      profile.dimensions
    ) {
      throw new VectorIndexError(
        VECTOR_INDEX_MESSAGES
          .TABLE_DIMENSION_MISMATCH,
        {
          operation:
            "open_table",
          componentId:
            VECTOR_INDEX_IDS
              .LANCEDB_TABLE_MANAGER,
        },
      );
    }
  }
}
