import {
  VECTOR_INDEX_IDS,
  VECTOR_INDEX_LANCEDB,
  VECTOR_INDEX_MESSAGES,
} from "../../constants";

import {
  VectorIndexError,
} from "../../VectorIndexError";

import type {
  EmbeddingIndexState,
  EmbeddingIndexWriteBatch,
  EmbeddingProfile,
  EmbeddingVectorRecord,
} from "../../../embedding/types";

import type {
  LanceDbVectorRowBase,
  LanceDbVectorRow,
  VectorSearchMatch,
} from "../../types";

export class LanceDbRowMapper {
  public readonly id =
    VECTOR_INDEX_IDS
      .LANCEDB_ROW_MAPPER;

  public toWriteRows(
    batch: EmbeddingIndexWriteBatch,
  ): LanceDbVectorRow[] {
    return [
      this.toStateRow(batch),
      ...batch.upserts.map(
        (record) =>
          this.toVectorRow(
            batch,
            record,
          ),
      ),
      ...batch.deleteChunkIds.map(
        (chunkId) =>
          this.toTombstoneRow(
            batch,
            chunkId,
          ),
      ),
    ];
  }

  public toIndexState(
    value: unknown,
  ): EmbeddingIndexState {
    const row =
      this.requireRecord(value);

    return {
      workspace:
        this.requireString(
          row,
          "workspace",
        ),
      rootId:
        this.requireString(
          row,
          "root_id",
        ),
      profileId:
        this.requireString(
          row,
          "profile_id",
        ),
      providerId:
        this.requireString(
          row,
          "provider_id",
        ),
      modelId:
        this.requireString(
          row,
          "model_id",
        ),
      dimensions:
        this.requireInteger(
          row,
          "dimensions",
          1,
        ),
      normalized:
        this.requireBoolean(
          row,
          "normalized",
        ),
      textRevision:
        this.requireInteger(
          row,
          "text_revision",
          0,
        ),
      updatedAt:
        this.requireInteger(
          row,
          "updated_at",
          0,
        ),
    };
  }

  public toSearchMatch(
    value: unknown,
  ): VectorSearchMatch {
    const row =
      this.requireRecord(value);

    const rawDistance =
      this.requireFiniteNumber(
        row,
        "_distance",
      );

    const distance =
      this.clamp(
        rawDistance,
        0,
        2,
      );

    const title =
      this.optionalStoredString(
        row,
        "title",
      );

    const symbolLocalId =
      this.optionalStoredString(
        row,
        "symbol_local_id",
      );

    return {
      chunkId:
        this.requireString(
          row,
          "chunk_id",
        ),
      rootId:
        this.requireString(
          row,
          "root_id",
        ),
      relativePath:
        this.requireString(
          row,
          "relative_path",
        ),
      kind:
        this.requireChunkKind(
          row,
          "kind",
        ),
      ordinal:
        this.requireInteger(
          row,
          "ordinal",
          0,
        ),
      contentHash:
        this.requireString(
          row,
          "content_hash",
        ),
      tokenEstimate:
        this.requireInteger(
          row,
          "token_estimate",
          1,
        ),
      startLine:
        this.requireInteger(
          row,
          "start_line",
          1,
        ),
      endLine:
        this.requireInteger(
          row,
          "end_line",
          1,
        ),
      ...(title
        ? {
            title,
          }
        : {}),
      ...(symbolLocalId
        ? {
            symbolLocalId,
          }
        : {}),
      profileId:
        this.requireString(
          row,
          "profile_id",
        ),
      score:
        this.clamp(
          1 - distance,
          0,
          1,
        ),
      distance,
    };
  }

  public readStoredProfile(
    value: unknown,
  ): {
    profileId: string;
    dimensions: number;
  } {
    const row =
      this.requireRecord(value);

    return {
      profileId:
        this.requireString(
          row,
          "profile_id",
        ),
      dimensions:
        this.requireInteger(
          row,
          "dimensions",
          1,
        ),
    };
  }

  private toStateRow(
    batch: EmbeddingIndexWriteBatch,
  ): LanceDbVectorRow {
    return {
      ...this.baseRow(
        batch,
      ),
      record_key:
        this.recordKey(
          VECTOR_INDEX_LANCEDB
            .STATE_ROW_TYPE,
          batch.workspace,
          batch.rootId,
        ),
      row_type:
        VECTOR_INDEX_LANCEDB
          .STATE_ROW_TYPE,
      chunk_id:
        "",
      relative_path:
        "",
      kind:
        VECTOR_INDEX_LANCEDB
          .STATE_KIND,
      ordinal:
        0,
      content_hash:
        "",
      token_estimate:
        0,
      start_line:
        0,
      end_line:
        0,
      title:
        "",
      symbol_local_id:
        "",
      active:
        false,
      vector:
        this.zeroVector(
          batch.profile,
        ),
    };
  }

  private toVectorRow(
    batch: EmbeddingIndexWriteBatch,
    record: EmbeddingVectorRecord,
  ): LanceDbVectorRow {
    return {
      ...this.baseRow(
        batch,
      ),
      record_key:
        this.recordKey(
          VECTOR_INDEX_LANCEDB
            .VECTOR_ROW_TYPE,
          batch.workspace,
          batch.rootId,
          record.chunkId,
        ),
      row_type:
        VECTOR_INDEX_LANCEDB
          .VECTOR_ROW_TYPE,
      chunk_id:
        record.chunkId,
      relative_path:
        record.relativePath,
      kind:
        record.kind,
      ordinal:
        record.ordinal,
      content_hash:
        record.contentHash,
      token_estimate:
        record.tokenEstimate,
      start_line:
        record.startLine,
      end_line:
        record.endLine,
      title:
        record.title ?? "",
      symbol_local_id:
        record.symbolLocalId ?? "",
      active:
        true,
      vector:
        [...record.vector],
    };
  }

  private toTombstoneRow(
    batch: EmbeddingIndexWriteBatch,
    chunkId: string,
  ): LanceDbVectorRow {
    return {
      ...this.baseRow(
        batch,
      ),
      record_key:
        this.recordKey(
          VECTOR_INDEX_LANCEDB
            .VECTOR_ROW_TYPE,
          batch.workspace,
          batch.rootId,
          chunkId,
        ),
      row_type:
        VECTOR_INDEX_LANCEDB
          .VECTOR_ROW_TYPE,
      chunk_id:
        chunkId,
      relative_path:
        "",
      kind:
        "text",
      ordinal:
        0,
      content_hash:
        "",
      token_estimate:
        0,
      start_line:
        0,
      end_line:
        0,
      title:
        "",
      symbol_local_id:
        "",
      active:
        false,
      vector:
        this.zeroVector(
          batch.profile,
        ),
    };
  }

  private baseRow(
    batch: EmbeddingIndexWriteBatch,
  ): Pick<
    LanceDbVectorRowBase,
    | "workspace"
    | "root_id"
    | "profile_id"
    | "provider_id"
    | "model_id"
    | "dimensions"
    | "normalized"
    | "text_revision"
    | "updated_at"
  > {
    return {
      workspace:
        batch.workspace,
      root_id:
        batch.rootId,
      profile_id:
        batch.profile.id,
      provider_id:
        batch.profile
          .providerId,
      model_id:
        batch.profile.modelId,
      dimensions:
        batch.profile
          .dimensions,
      normalized:
        batch.profile
          .normalized,
      text_revision:
        batch.nextTextRevision,
      updated_at:
        batch.updatedAt,
    };
  }

  private recordKey(
    ...parts: readonly string[]
  ): string {
    return parts
      .map(
        (part) =>
          `${part.length}:${part}`,
      )
      .join(
        VECTOR_INDEX_LANCEDB
          .RECORD_KEY_SEPARATOR,
      );
  }

  private zeroVector(
    profile: EmbeddingProfile,
  ): number[] {
    return new Array(
      profile.dimensions,
    ).fill(0);
  }

  private requireRecord(
    value: unknown,
  ): Record<string, unknown> {
    if (
      typeof value !==
        "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      this.invalidRow();
    }

    return value as
      Record<string, unknown>;
  }

  private requireString(
    row: Record<string, unknown>,
    key: string,
  ): string {
    const value =
      row[key];

    if (
      typeof value !==
        "string" ||
      value.length === 0
    ) {
      this.invalidRow();
    }

    return value as string;
  }

  private optionalStoredString(
    row: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value =
      row[key];

    if (
      value === "" ||
      value === null ||
      value === undefined
    ) {
      return undefined;
    }

    if (
      typeof value !==
      "string"
    ) {
      this.invalidRow();
    }

    return value as string;
  }

  private requireInteger(
    row: Record<string, unknown>,
    key: string,
    minimum: number,
  ): number {
    const value =
      row[key];

    if (
      typeof value !==
        "number" ||
      !Number.isSafeInteger(value) ||
      value < minimum
    ) {
      this.invalidRow();
    }

    return value as number;
  }

  private requireFiniteNumber(
    row: Record<string, unknown>,
    key: string,
  ): number {
    const value =
      row[key];

    if (
      typeof value !==
        "number" ||
      !Number.isFinite(value)
    ) {
      this.invalidRow();
    }

    return value as number;
  }

  private requireBoolean(
    row: Record<string, unknown>,
    key: string,
  ): boolean {
    const value =
      row[key];

    if (
      typeof value !==
      "boolean"
    ) {
      this.invalidRow();
    }

    return value as boolean;
  }

  private requireChunkKind(
    row: Record<string, unknown>,
    key: string,
  ): VectorSearchMatch["kind"] {
    const value =
      this.requireString(
        row,
        key,
      );

    if (
      value !==
        "code_symbol" &&
      value !==
        "code_region" &&
      value !==
        "markdown_section" &&
      value !==
        "text"
    ) {
      this.invalidRow();
    }

    return value as
      VectorSearchMatch["kind"];
  }

  private clamp(
    value: number,
    minimum: number,
    maximum: number,
  ): number {
    return Math.max(
      minimum,
      Math.min(
        maximum,
        value,
      ),
    );
  }

  private invalidRow(): never {
    throw new VectorIndexError(
      VECTOR_INDEX_MESSAGES
        .INVALID_LANCEDB_ROW,
      {
        operation:
          "map_row",
        componentId:
          this.id,
      },
    );
  }
}
