import {
  EMBEDDING_DEFAULTS,
  EMBEDDING_IDS,
} from "./constants";

import {
  EmbeddingError,
} from "./EmbeddingError";

import type {
  EmbeddingProfile,
} from "./types";

export class EmbeddingVectorValidator {
  public readonly id =
    EMBEDDING_IDS
      .VECTOR_VALIDATOR;

  public validate(
    vector:
      readonly number[],
    profile:
      EmbeddingProfile,
    normalize: boolean,
  ): number[] {
    if (
      vector.length !==
      profile.dimensions
    ) {
      throw new EmbeddingError(
        `Embedding provider returned ${vector.length} dimensions; expected ${profile.dimensions}.`,
        {
          operation:
            "validate_vector",
          componentId:
            this.id,
        },
      );
    }

    let squaredNorm = 0;

    for (
      const value of vector
    ) {
      if (
        !Number.isFinite(value)
      ) {
        throw new EmbeddingError(
          "Embedding provider returned a non-finite vector value.",
          {
            operation:
              "validate_vector",
            componentId:
              this.id,
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
      EMBEDDING_DEFAULTS
        .ZERO_NORM_TOLERANCE
    ) {
      throw new EmbeddingError(
        "Embedding provider returned a zero-length vector.",
        {
          operation:
            "validate_vector",
          componentId:
            this.id,
        },
      );
    }

    if (normalize) {
      return vector.map(
        (value) =>
          value / norm,
      );
    }

    if (
      profile.normalized &&
      Math.abs(norm - 1) >
        EMBEDDING_DEFAULTS
          .UNIT_NORM_TOLERANCE
    ) {
      throw new EmbeddingError(
        "Embedding profile promises normalized vectors, but the provider returned a non-unit vector.",
        {
          operation:
            "validate_vector",
          componentId:
            this.id,
        },
      );
    }

    return [...vector];
  }
}
