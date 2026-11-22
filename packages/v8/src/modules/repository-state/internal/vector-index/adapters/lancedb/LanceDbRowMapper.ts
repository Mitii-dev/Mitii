import {
  VECTOR_INDEX_IDS,
  VECTOR_INDEX_MESSAGES,
} from "../../constants";

import {
  VectorIndexError,
} from "../../VectorIndexError";

import type {
  EmbeddingIndexState,
  EmbeddingIndexWriteBatch,
} from "../../../embedding/types";

import {
  buildLanceDbWriteRows,
} from "./LanceDbWriteRowBuilder";

import type {
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
    return buildLanceDbWriteRows(batch);
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
