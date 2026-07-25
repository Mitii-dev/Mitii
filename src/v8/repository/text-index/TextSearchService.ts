import {
  TEXT_INDEX_SCHEMA_VERSION,
} from "./constants";

import {
  textSearchResultSchema,
} from "./schema";

import {
  TextQueryNormalizer,
} from "./TextQueryNormalizer";

import type {
  TextIndexReadPort,
  TextSearchInput,
  TextSearchResult,
} from "./types";

export class TextSearchService {
  constructor(
    private readonly reader:
      TextIndexReadPort,

    private readonly normalizer =
      new TextQueryNormalizer(),
  ) {}

  public async search(
    input: TextSearchInput,
  ): Promise<TextSearchResult> {
    if (
      input.abortSignal
        ?.aborted
    ) {
      return this.validate({
        schemaVersion:
          TEXT_INDEX_SCHEMA_VERSION,
        query: input.query,
        normalizedTerms: [],
        status: "cancelled",
        matches: [],
        truncated: false,
        warnings: [],
      });
    }

    const normalization =
      this.normalizer
        .normalize(input);

    if (
      !normalization.request
    ) {
      return this.validate({
        schemaVersion:
          TEXT_INDEX_SCHEMA_VERSION,
        query: input.query,
        normalizedTerms: [],
        status: "empty",
        matches: [],
        truncated: false,
        warnings:
          normalization
            .warnings,
      });
    }

    const page =
      await this.reader.search(
        normalization.request,
        {
          ...(input.abortSignal
            ? {
                abortSignal:
                  input.abortSignal,
              }
            : {}),
        },
      );

    if (
      input.abortSignal
        ?.aborted
    ) {
      return this.validate({
        schemaVersion:
          TEXT_INDEX_SCHEMA_VERSION,
        query: input.query,
        normalizedTerms:
          normalization
            .request.terms,
        status: "cancelled",
        matches: [],
        truncated: false,
        warnings:
          normalization
            .warnings,
      });
    }

    return this.validate({
      schemaVersion:
        TEXT_INDEX_SCHEMA_VERSION,
      query: input.query,
      normalizedTerms:
        normalization
          .request.terms,
      status: "complete",
      matches: page.matches,
      truncated:
        page.truncated,
      warnings:
        normalization.warnings,
    });
  }

  private validate(
    result: TextSearchResult,
  ): TextSearchResult {
    return textSearchResultSchema
      .parse(result) as
      TextSearchResult;
  }
}

