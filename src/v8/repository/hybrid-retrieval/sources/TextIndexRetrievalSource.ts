import {
  TextSearchService,
} from "../../text-index/TextSearchService";

import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_IDS,
} from "../constants";

import {
  retrievalSourceResultSchema,
} from "../schema";

import type {
  TextIndexReadPort,
} from "../../text-index/types";

import type {
  NormalizedHybridRetrievalRequest,
  RetrievalSource,
  RetrievalSourceContext,
  RetrievalSourceResult,
} from "../types";

export class TextIndexRetrievalSource
  implements RetrievalSource
{
  public readonly id =
    HYBRID_RETRIEVAL_IDS
      .TEXT_SOURCE;

  private readonly searchService:
    TextSearchService;

  constructor(
    textIndex:
      TextIndexReadPort,
  ) {
    this.searchService =
      new TextSearchService(
        textIndex,
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
      return this.validate({
        status:
          "cancelled",
        candidates: [],
        truncated:
          false,
        warnings: [],
      });
    }

    const result =
      await this.searchService
        .search({
          workspace:
            request.workspace,
          query:
            request.query,
          mode:
            HYBRID_RETRIEVAL_DEFAULTS
              .TEXT_SEARCH_MODE,
          prefixMatching:
            HYBRID_RETRIEVAL_DEFAULTS
              .TEXT_PREFIX_MATCHING,
          maximumResults:
            request
              .maximumCandidatesPerSource,
          snippetTokenCount:
            HYBRID_RETRIEVAL_DEFAULTS
              .TEXT_SNIPPET_TOKEN_COUNT,
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
      return this.validate({
        status:
          "cancelled",
        candidates: [],
        truncated:
          false,
        warnings: [],
      });
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
          preview:
            match.snippet,
          contentHash:
            match.contentHash,
          tokenEstimate:
            match.tokenEstimate,
          sourceScore:
            match.score,
          reasons: [
            {
              type:
                "lexical_match" as const,
              evidence:
                `Lexical match in ${match.relativePath}:${match.startLine}-${match.endLine}.`,
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
      warnings:
        result.warnings.map(
          (warning) => ({
            code:
              "upstream_warning" as const,
            message:
              warning.message,
          }),
        ),
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
