import {
  HYBRID_RETRIEVAL_IDS,
  HYBRID_RETRIEVAL_MESSAGES,
} from "./constants";

import {
  HybridRetrievalError,
} from "./HybridRetrievalError";

import {
  HybridRetriever,
} from "./HybridRetriever";

import {
  RepoGraphRetrievalSource,
  RepoMapRetrievalSource,
  TextIndexRetrievalSource,
  VectorIndexRetrievalSource,
} from "./sources";

import type {
  HybridRetrievalFactoryDependencies,
  HybridRetrievalModule,
  HybridRetrieverOptions,
  RetrievalSourceRegistration,
} from "./types";

export class HybridRetrievalFactory {
  public readonly id =
    HYBRID_RETRIEVAL_IDS
      .FACTORY;

  public create(
    dependencies:
      HybridRetrievalFactoryDependencies,
    options:
      HybridRetrieverOptions = {},
  ): HybridRetrievalModule {
    if (
      Boolean(
        dependencies
          .vectorIndex,
      ) !==
      Boolean(
        dependencies
          .embeddingProvider,
      )
    ) {
      throw new HybridRetrievalError(
        HYBRID_RETRIEVAL_MESSAGES
          .VECTOR_DEPENDENCY_MISMATCH,
        {
          operation:
            "register_source",
          componentId:
            this.id,
        },
      );
    }

    const registrations:
      RetrievalSourceRegistration[] =
      [];

    if (
      dependencies.textIndex
    ) {
      registrations.push({
        source:
          new TextIndexRetrievalSource(
            dependencies
              .textIndex,
          ),
      });
    }

    if (
      dependencies.vectorIndex &&
      dependencies
        .embeddingProvider
    ) {
      registrations.push({
        source:
          new VectorIndexRetrievalSource(
            dependencies
              .vectorIndex,
            dependencies
              .embeddingProvider,
          ),
      });
    }

    registrations.push(
      {
        source:
          new RepoMapRetrievalSource(),
      },
      {
        source:
          new RepoGraphRetrievalSource(),
      },
      ...(
        dependencies
          .additionalSources ??
        []
      ),
    );

    const retriever =
      new HybridRetriever(
        registrations,
        options,
        dependencies.reranker,
      );

    return {
      retrieve:
        (input) =>
          retriever.retrieve(
            input,
          ),
    };
  }
}
