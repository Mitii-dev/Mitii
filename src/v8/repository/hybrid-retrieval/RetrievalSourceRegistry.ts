import {
  HYBRID_RETRIEVAL_IDS,
  HYBRID_RETRIEVAL_LIMITS,
  HYBRID_RETRIEVAL_MESSAGES,
  HYBRID_RETRIEVAL_SOURCE_WEIGHTS,
} from "./constants";

import {
  HybridRetrievalError,
} from "./HybridRetrievalError";

import type {
  ResolvedRetrievalSourceRegistration,
  RetrievalSourceRegistration,
} from "./types";

export class RetrievalSourceRegistry {
  private readonly registrations =
    new Map<
      string,
      ResolvedRetrievalSourceRegistration
    >();

  public constructor(
    registrations:
      readonly RetrievalSourceRegistration[] = [],
  ) {
    for (
      const registration of
        registrations
    ) {
      this.register(
        registration,
      );
    }
  }

  public register(
    registration:
      RetrievalSourceRegistration,
  ): void {
    const sourceId =
      registration.source.id;

    if (
      this.registrations.has(
        sourceId,
      )
    ) {
      throw new HybridRetrievalError(
        HYBRID_RETRIEVAL_MESSAGES
          .DUPLICATE_SOURCE_ID,
        {
          operation:
            "register_source",
          componentId:
            HYBRID_RETRIEVAL_IDS
              .SOURCE_REGISTRY,
        },
      );
    }

    const weight =
      registration.weight ??
      HYBRID_RETRIEVAL_SOURCE_WEIGHTS[
        sourceId
      ] ??
      1;

    if (
      !Number.isFinite(weight) ||
      weight <= 0 ||
      weight >
        HYBRID_RETRIEVAL_LIMITS
          .MAXIMUM_SOURCE_WEIGHT
    ) {
      throw new HybridRetrievalError(
        HYBRID_RETRIEVAL_MESSAGES
          .INVALID_SOURCE_WEIGHT,
        {
          operation:
            "register_source",
          componentId:
            HYBRID_RETRIEVAL_IDS
              .SOURCE_REGISTRY,
        },
      );
    }

    this.registrations.set(
      sourceId,
      {
        source:
          registration.source,
        weight,
        required:
          registration.required ??
          false,
      },
    );
  }

  public list():
    readonly ResolvedRetrievalSourceRegistration[] {
    return [
      ...this.registrations
        .values(),
    ].sort(
      (left, right) =>
        left.source.id
          .localeCompare(
            right.source.id,
          ),
    );
  }
}
