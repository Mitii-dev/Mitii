import {
  TEXT_INDEX_SCHEMA_VERSION,
} from "./constants";

import {
  textIndexCoordinatorResultSchema,
} from "./schema";

import {
  TextIndexDocumentMapper,
} from "./TextIndexDocumentMapper";

import type {
  TextIndexCoordinatorInput,
  TextIndexCoordinatorResult,
} from "./types";

import {
  TextIndexUpdater,
} from "./TextIndexUpdater";

export class TextIndexCoordinator {
  constructor(
    private readonly updater:
      TextIndexUpdater,

    private readonly mapper =
      new TextIndexDocumentMapper(),
  ) {}

  public async index(
    input: TextIndexCoordinatorInput,
  ): Promise<TextIndexCoordinatorResult> {
    if (
      input.abortSignal
        ?.aborted ||
      input.chunking.status ===
        "cancelled"
    ) {
      return this.validate({
        schemaVersion:
          TEXT_INDEX_SCHEMA_VERSION,
        status: "cancelled",
        chunkingStatus:
          input.chunking.status,
      });
    }

    if (
      input.chunking.status ===
        "rejected" ||
      input.chunking.status ===
        "failed"
    ) {
      return this.validate({
        schemaVersion:
          TEXT_INDEX_SCHEMA_VERSION,
        status:
          "not_indexable",
        chunkingStatus:
          input.chunking.status,
      });
    }

    const document =
      this.mapper.map(input);

    const update =
      await this.updater.update({
        document,
        ...(input.abortSignal
          ? {
              abortSignal:
                input.abortSignal,
            }
          : {}),
      });

    const status =
      update.status ===
        "metadata_refreshed"
        ? "metadata_refreshed"
        : update.status ===
            "unchanged"
          ? "unchanged"
          : document
                .chunkingStatus ===
              "empty"
            ? "empty_indexed"
            : "indexed";

    return this.validate({
      schemaVersion:
        TEXT_INDEX_SCHEMA_VERSION,
      status,
      chunkingStatus:
        input.chunking.status,
      update,
    });
  }

  private validate(
    result:
      TextIndexCoordinatorResult,
  ): TextIndexCoordinatorResult {
    return textIndexCoordinatorResultSchema
      .parse(result) as
      TextIndexCoordinatorResult;
  }
}

