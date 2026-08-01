import {
  VECTOR_INDEX_DEFAULTS,
  VECTOR_INDEX_IDS,
  VECTOR_INDEX_LIMITS,
  VECTOR_INDEX_MESSAGES,
} from "./constants";

import {
  normalizedVectorSearchRequestSchema,
  vectorSearchInputSchema,
} from "./schema";

import {
  VectorIndexError,
} from "./VectorIndexError";

import type {
  NormalizedVectorSearchRequest,
  VectorSearchInput,
} from "./types";

export class VectorSearchRequestNormalizer {
  public normalize(
    input: VectorSearchInput,
  ): NormalizedVectorSearchRequest {
    const parsed =
      vectorSearchInputSchema
        .parse(input) as
        VectorSearchInput;

    if (
      parsed.queryVector.length !==
      parsed.profile.dimensions
    ) {
      throw new VectorIndexError(
        VECTOR_INDEX_MESSAGES
          .QUERY_DIMENSION_MISMATCH,
        {
          operation:
            "normalize_search",
          componentId:
            VECTOR_INDEX_IDS
              .SEARCH_NORMALIZER,
        },
      );
    }

    const queryVector =
      [...parsed.queryVector];

    this.validateVector(
      queryVector,
      parsed.profile.normalized,
    );

    const maximumResults =
      parsed.maximumResults ??
      VECTOR_INDEX_DEFAULTS
        .MAXIMUM_RESULTS;

    const candidateMultiplier =
      parsed.candidateMultiplier ??
      VECTOR_INDEX_DEFAULTS
        .CANDIDATE_MULTIPLIER;

    const request:
      NormalizedVectorSearchRequest = {
        workspace:
          parsed.workspace.trim(),
        profile:
          parsed.profile,
        queryVector,

        rootIds:
          this.uniqueSorted(
            parsed.rootIds ?? [],
          ),
        ...(parsed.folderPrefix
          ? {
              folderPrefix:
                parsed.folderPrefix,
            }
          : {}),
        filePaths:
          this.uniqueSorted(
            parsed.filePaths ?? [],
          ),
        kinds:
          this.uniqueSorted(
            parsed.kinds ?? [],
          ),

        maximumResults,
        minimumScore:
          parsed.minimumScore ??
          VECTOR_INDEX_DEFAULTS
            .MINIMUM_SCORE,
        candidateLimit:
          maximumResults *
            candidateMultiplier +
          1,

        nprobes:
          parsed.nprobes ??
          VECTOR_INDEX_DEFAULTS
            .NPROBES,
        refineFactor:
          parsed.refineFactor ??
          VECTOR_INDEX_DEFAULTS
            .REFINE_FACTOR,
      };

    return normalizedVectorSearchRequestSchema
      .parse(request) as
      NormalizedVectorSearchRequest;
  }

  private validateVector(
    vector: readonly number[],
    normalized: boolean,
  ): void {
    let squaredNorm = 0;

    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new VectorIndexError(
          VECTOR_INDEX_MESSAGES
            .QUERY_VECTOR_NOT_FINITE,
          {
            operation:
              "normalize_search",
            componentId:
              VECTOR_INDEX_IDS
                .SEARCH_NORMALIZER,
          },
        );
      }

      squaredNorm +=
        value * value;
    }

    const norm =
      Math.sqrt(squaredNorm);

    if (
      norm <=
      VECTOR_INDEX_LIMITS
        .ZERO_NORM_TOLERANCE
    ) {
      throw new VectorIndexError(
        VECTOR_INDEX_MESSAGES
          .QUERY_VECTOR_ZERO_NORM,
        {
          operation:
            "normalize_search",
          componentId:
            VECTOR_INDEX_IDS
              .SEARCH_NORMALIZER,
        },
      );
    }

    if (
      normalized &&
      Math.abs(norm - 1) >
        VECTOR_INDEX_LIMITS
          .UNIT_NORM_TOLERANCE
    ) {
      throw new VectorIndexError(
        VECTOR_INDEX_MESSAGES
          .QUERY_VECTOR_NOT_NORMALIZED,
        {
          operation:
            "normalize_search",
          componentId:
            VECTOR_INDEX_IDS
              .SEARCH_NORMALIZER,
        },
      );
    }
  }

  private uniqueSorted<T extends string>(
    values: readonly T[],
  ): T[] {
    return [
      ...new Set(values),
    ].sort(
      (left, right) =>
        left.localeCompare(right),
    );
  }
}
