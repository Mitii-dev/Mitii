import {
  EMBEDDING_DEFAULTS,
  EMBEDDING_IDS,
  EMBEDDING_TEXT_FORMAT,
} from "./constants";

import type {
  PreparedEmbeddingText,
  ResolvedEmbeddingGeneratorOptions,
} from "./types";

import type {
  Chunk,
} from "../chunking/types";

export class EmbeddingTextPreparer {
  public readonly id =
    EMBEDDING_IDS.TEXT_PREPARER;

  public prepare(
    chunk: Chunk,
    options:
      ResolvedEmbeddingGeneratorOptions,
  ): PreparedEmbeddingText {
    const title =
      options.includeTitle &&
      chunk.title
        ? [
            EMBEDDING_TEXT_FORMAT
              .TITLE_PREFIX,
            chunk.title.trim(),
            EMBEDDING_TEXT_FORMAT
              .TITLE_SEPARATOR,
          ].join("")
        : "";

    const combined =
      `${title}${chunk.content}`;

    const truncated =
      combined.length >
      options
        .maximumInputCharacters;

    return {
      chunk,
      text:
        truncated
          ? combined.slice(
              0,
              options
                .maximumInputCharacters,
            )
          : combined,
      truncated,
    };
  }

  public resolveOptions(
    options: {
      batchSize?: number;
      maximumInputCharacters?:
        number;
      includeTitle?: boolean;
      normalizeVectors?: boolean;
    } = {},
  ): ResolvedEmbeddingGeneratorOptions {
    const resolved = {
      batchSize:
        options.batchSize ??
        EMBEDDING_DEFAULTS
          .BATCH_SIZE,
      maximumInputCharacters:
        options
          .maximumInputCharacters ??
        EMBEDDING_DEFAULTS
          .MAXIMUM_INPUT_CHARACTERS,
      includeTitle:
        options.includeTitle ??
        EMBEDDING_DEFAULTS
          .INCLUDE_TITLE,
      normalizeVectors:
        options.normalizeVectors ??
        EMBEDDING_DEFAULTS
          .NORMALIZE_VECTORS,
    };

    this.validateInteger(
      resolved.batchSize,
      "batchSize",
      EMBEDDING_DEFAULTS
        .MAXIMUM_BATCH_SIZE,
    );

    this.validateInteger(
      resolved
        .maximumInputCharacters,
      "maximumInputCharacters",
      EMBEDDING_DEFAULTS
        .MAXIMUM_ALLOWED_INPUT_CHARACTERS,
    );

    return resolved;
  }

  private validateInteger(
    value: number,
    name: string,
    maximum: number,
  ): void {
    if (
      !Number.isSafeInteger(
        value,
      ) ||
      value <= 0 ||
      value > maximum
    ) {
      throw new RangeError(
        `${name} must be a positive safe integer no greater than ${maximum}.`,
      );
    }
  }
}
