import {
  VECTOR_INDEX_LANCEDB,
} from "../../constants";

import type {
  EmbeddingIndexWriteBatch,
  EmbeddingProfile,
  EmbeddingVectorRecord,
} from "../../../embedding/types";

import type {
  LanceDbVectorRowBase,
  LanceDbVectorRow,
} from "../../types";

export function buildLanceDbWriteRows(
  batch: EmbeddingIndexWriteBatch,
): LanceDbVectorRow[] {
  return [
    toStateRow(batch),
    ...batch.upserts.map(
      (record) =>
        toVectorRow(
          batch,
          record,
        ),
    ),
    ...batch.deleteChunkIds.map(
      (chunkId) =>
        toTombstoneRow(
          batch,
          chunkId,
        ),
    ),
  ];
}

function toStateRow(
  batch: EmbeddingIndexWriteBatch,
): LanceDbVectorRow {
  return {
    ...baseRow(
      batch,
    ),
    record_key:
      recordKey(
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
      zeroVector(
        batch.profile,
      ),
  };
}

function toVectorRow(
  batch: EmbeddingIndexWriteBatch,
  record: EmbeddingVectorRecord,
): LanceDbVectorRow {
  return {
    ...baseRow(
      batch,
    ),
    record_key:
      recordKey(
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

function toTombstoneRow(
  batch: EmbeddingIndexWriteBatch,
  chunkId: string,
): LanceDbVectorRow {
  return {
    ...baseRow(
      batch,
    ),
    record_key:
      recordKey(
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
      zeroVector(
        batch.profile,
      ),
  };
}

function baseRow(
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

function recordKey(
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

function zeroVector(
  profile: EmbeddingProfile,
): number[] {
  return new Array(
    profile.dimensions,
  ).fill(0);
}
