import {
  EmbeddingVectorValidator,
} from "../../../../repository-state/index";

import {
  VectorSearchService,
} from "../../../../repository-state/index";

import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_IDS,
} from "../constants";

import {
  retrievalSourceResultSchema,
} from "../schema";

import type {
  EmbeddingProvider,
} from "../../../../repository-state/index";

import type {
  VectorIndexReadPort,
} from "../../../../repository-state/index";

import type {
  NormalizedHybridRetrievalRequest,
  RetrievalSource,
  RetrievalSourceContext,
  RetrievalSourceResult,
} from "../types";

export class VectorIndexRetrievalSource
  implements RetrievalSource
{
  public readonly id =
    HYBRID_RETRIEVAL_IDS
      .VECTOR_SOURCE;

  private readonly searchService:
    VectorSearchService;

  constructor(
    vectorIndex:
      VectorIndexReadPort,
    private readonly provider:
      EmbeddingProvider,
    private readonly vectorValidator =
      new EmbeddingVectorValidator(),
  ) {
    this.searchService =
      new VectorSearchService(
        vectorIndex,
      );
  }

  public canRetrieve(
    _request:
      NormalizedHybridRetrievalRequest,
  ): boolean {
    return true;
  }

  public async retrieve(
    request:
      NormalizedHybridRetrievalRequest,
    context:
      RetrievalSourceContext = {},
  ): Promise<RetrievalSourceResult> {
    if (
      context.abortSignal
        ?.aborted
    ) {
      return this.cancelled();
    }

    const vectors =
      await this.provider.embed(
        [request.query],
        {
          ...(context.abortSignal
            ? {
                abortSignal:
                  context.abortSignal,
              }
            : {}),
        },
      );

    if (
      context.abortSignal
        ?.aborted
    ) {
      return this.cancelled();
    }

    const rawVector =
      vectors[0];

    if (!rawVector) {
      throw new Error(
        "Embedding provider did not return a query vector.",
      );
    }

    const queryVector =
      this.vectorValidator
        .validate(
          rawVector,
          this.provider.profile,
          this.provider
            .profile
            .normalized,
        );

    const result =
      await this.searchService
        .search({
          workspace:
            request.workspace,
          profile:
            this.provider.profile,
          queryVector,
          rootIds:
            request.rootIds,
          ...(request.folderPrefix
            ? {
                folderPrefix:
                  request
                    .folderPrefix,
              }
            : {}),
          filePaths:
            request.filePaths,
          kinds:
            request.kinds,
          maximumResults:
            request
              .maximumCandidatesPerSource,
          minimumScore:
            HYBRID_RETRIEVAL_DEFAULTS
              .VECTOR_MINIMUM_SCORE,
          candidateMultiplier:
            HYBRID_RETRIEVAL_DEFAULTS
              .VECTOR_CANDIDATE_MULTIPLIER,
          ...(context.abortSignal
            ? {
                abortSignal:
                  context.abortSignal,
              }
            : {}),
        });

    if (
      result.status ===
      "cancelled"
    ) {
      return this.cancelled();
    }

    const candidates =
      result.matches.map(
        (match) => ({
          entityKind:
            "chunk" as const,
          rootId:
            match.rootId,
          relativePath:
            match.relativePath,
          chunkId:
            match.chunkId,
          startLine:
            match.startLine,
          endLine:
            match.endLine,
          ...(match.title
            ? {
                title:
                  match.title,
              }
            : {}),
          contentHash:
            match.contentHash,
          tokenEstimate:
            match.tokenEstimate,
          sourceScore:
            match.score,
          reasons: [
            {
              type:
                "semantic_match" as const,
              evidence:
                `Semantic match in ${match.relativePath}:${match.startLine}-${match.endLine}.`,
            },
          ],
        }),
      );

    return this.validate({
      status:
        candidates.length > 0
          ? "complete"
          : "empty",
      candidates,
      truncated:
        result.truncated,
      warnings: [],
    });
  }

  private cancelled():
    RetrievalSourceResult {
    return this.validate({
      status:
        "cancelled",
      candidates: [],
      truncated:
        false,
      warnings: [],
    });
  }

  private validate(
    result:
      RetrievalSourceResult,
  ): RetrievalSourceResult {
    return retrievalSourceResultSchema
      .parse(result) as
      RetrievalSourceResult;
  }
}
