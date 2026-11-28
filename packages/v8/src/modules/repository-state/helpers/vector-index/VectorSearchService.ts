import {
  VECTOR_INDEX_SCHEMA_VERSION,
} from "./constants";

import {
  vectorSearchResultSchema,
} from "./schema";

import {
  VectorSearchRequestNormalizer,
} from "./VectorSearchRequestNormalizer";

import type {
  VectorIndexReadPort,
  VectorSearchInput,
  VectorSearchResult,
} from "./types";

export class VectorSearchService {
  constructor(
    private readonly reader:
      VectorIndexReadPort,
    private readonly normalizer =
      new VectorSearchRequestNormalizer(),
  ) {}

  public async search(
    input: VectorSearchInput,
  ): Promise<VectorSearchResult> {
    if (
      input.abortSignal
        ?.aborted
    ) {
      return this.validate({
        schemaVersion:
          VECTOR_INDEX_SCHEMA_VERSION,
        status:
          "cancelled",
        profile:
          input.profile,
        matches: [],
        truncated:
          false,
      });
    }

    const request =
      this.normalizer
        .normalize(input);

    const page =
      await this.reader.search(
        request,
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
          VECTOR_INDEX_SCHEMA_VERSION,
        status:
          "cancelled",
        profile:
          input.profile,
        matches: [],
        truncated:
          false,
      });
    }

    return this.validate({
      schemaVersion:
        VECTOR_INDEX_SCHEMA_VERSION,
      status:
        page.matches.length > 0
          ? "complete"
          : "empty",
      profile:
        request.profile,
      matches:
        page.matches,
      truncated:
        page.truncated,
    });
  }

  private validate(
    result: VectorSearchResult,
  ): VectorSearchResult {
    return vectorSearchResultSchema
      .parse(result) as
      VectorSearchResult;
  }
}
