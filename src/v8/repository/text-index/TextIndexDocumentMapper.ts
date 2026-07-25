import {
  TEXT_INDEX_DEFAULTS,
  TEXT_INDEX_ERRORS,
  TEXT_INDEX_SCHEMA_VERSION,
} from "./constants";

import {
  textIndexDocumentSchema,
} from "./schema";

import type {
  TextIndexDocument,
  TextIndexDocumentMapperInput,
} from "./types";

export class TextIndexDocumentMapper {
  public map(
    input: TextIndexDocumentMapperInput,
  ): TextIndexDocument {
    this.validateInput(input);

    const chunking =
      input.chunking;

    if (
      chunking.status !==
        "complete" &&
      chunking.status !==
        "partial" &&
      chunking.status !==
        "empty"
    ) {
      throw new TypeError(
        TEXT_INDEX_ERRORS
          .DOCUMENT_NOT_INDEXABLE,
      );
    }

    const document:
      TextIndexDocument = {
      schemaVersion:
        TEXT_INDEX_SCHEMA_VERSION,

      workspace:
        input.workspace,

      rootId:
        chunking.rootId,

      relativePath:
        chunking.relativePath,

      sourceId:
        chunking.sourceId,

      sourceContentHash:
        chunking
          .sourceContentHash,

      ...(chunking.language
        ? {
            language:
              chunking.language,
          }
        : {}),

      chunkingSchemaVersion:
        chunking.schemaVersion,

      pipelineVersion:
        input.pipelineVersion ??
        TEXT_INDEX_DEFAULTS
          .PIPELINE_VERSION,

      chunkingStatus:
        chunking.status,

      ...(chunking.strategyId
        ? {
            strategyId:
              chunking
                .strategyId,
          }
        : {}),

      chunks:
        [...chunking.chunks],

      workspaceSnapshotId:
        input
          .workspaceSnapshotId,

      indexedAt:
        input.indexedAt,
    };

    return textIndexDocumentSchema
      .parse(document) as
      TextIndexDocument;
  }

  private validateInput(
    input: TextIndexDocumentMapperInput,
  ): void {
    if (!input.workspace.trim()) {
      throw new TypeError(
        TEXT_INDEX_ERRORS
          .WORKSPACE_REQUIRED,
      );
    }

    if (
      !input.workspaceSnapshotId
        .trim()
    ) {
      throw new TypeError(
        TEXT_INDEX_ERRORS
          .SNAPSHOT_REQUIRED,
      );
    }

    if (
      !Number.isSafeInteger(
        input.indexedAt,
      ) ||
      input.indexedAt < 0
    ) {
      throw new RangeError(
        TEXT_INDEX_ERRORS
          .INVALID_TIMESTAMP,
      );
    }
  }
}

