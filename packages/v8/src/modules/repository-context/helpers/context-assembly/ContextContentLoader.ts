import {
  CONTEXT_ASSEMBLY_IDS,
  CONTEXT_ASSEMBLY_REPRESENTATION_FALLBACKS,
} from "./constants";

import type {
  ContextContentLoadAttempt,
  ContextContentLoaderInput,
  ContextContentLoadResult,
  ContextContentSourceRegistryPort,
} from "./types";

import type {
  ContextRepresentation,
} from "../context-selection/types";

export class ContextContentLoader {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .CONTENT_LOADER;

  public constructor(
    private readonly registry:
      ContextContentSourceRegistryPort,
  ) {}

  public async load(
    input:
      ContextContentLoaderInput,
  ): Promise<ContextContentLoadResult> {
    const attempts:
      ContextContentLoadAttempt[] = [];
    const representations =
      this.representations(
        input.item
          .representation,
        input
          .allowRepresentationFallback,
      );
    let hadFailure =
      false;

    for (
      const representation
      of representations
    ) {
      if (
        input.abortSignal
          ?.aborted
      ) {
        return {
          status:
            "cancelled",
          attempts,
        };
      }

      const request = {
        item:
          input.item,
        representation,
        maximumBytes:
          input.maximumBytes,
      };
      const sources =
        this.registry.resolve(
          request,
        );

      for (
        const source
        of sources
      ) {
        if (
          input.abortSignal
            ?.aborted
        ) {
          return {
            status:
              "cancelled",
            attempts,
          };
        }

        try {
          const result =
            await source.load(
              request,
              {
                snapshot:
                  input.snapshot,
                ...(input
                  .abortSignal
                  ? {
                      abortSignal:
                        input
                          .abortSignal,
                    }
                  : {}),
              },
            );

          if (
            result.status ===
              "loaded" &&
            result.content !==
              undefined
          ) {
            const actualRepresentation =
              result
                .representation ??
              representation;

            return {
              status:
                "loaded",
              loaded: {
                sourceId:
                  source.id,
                requestedRepresentation:
                  input.item
                    .representation,
                representation:
                  actualRepresentation,
                content:
                  result.content,
                fallbackUsed:
                  representation !==
                    input.item
                      .representation ||
                  actualRepresentation !==
                    input.item
                      .representation,
                ...(result
                  .startLine !==
                undefined
                  ? {
                      startLine:
                        result
                          .startLine,
                    }
                  : {}),
                ...(result
                  .endLine !==
                undefined
                  ? {
                      endLine:
                        result
                          .endLine,
                    }
                  : {}),
                ...(result
                  .contentHash
                  ? {
                      contentHash:
                        result
                          .contentHash,
                    }
                  : {}),
              },
              attempts,
            };
          }

          attempts.push({
            sourceId:
              source.id,
            representation,
            status:
              result.status ===
                "loaded"
                ? "unavailable"
                : result.status,
            message:
              result.message ??
              `Source "${source.id}" did not return content.`,
          });
        } catch (error) {
          hadFailure =
            true;

          attempts.push({
            sourceId:
              source.id,
            representation,
            status:
              "failed",
            message:
              this.errorMessage(
                error,
              ),
          });
        }
      }
    }

    return {
      status:
        hadFailure
          ? "failed"
          : "unavailable",
      attempts,
    };
  }

  private representations(
    requested:
      ContextRepresentation,
    allowFallback: boolean,
  ): ContextRepresentation[] {
    if (!allowFallback) {
      return [
        requested,
      ];
    }

    return [
      requested,
      ...CONTEXT_ASSEMBLY_REPRESENTATION_FALLBACKS[
        requested
      ],
    ];
  }

  private errorMessage(
    error: unknown,
  ): string {
    return error instanceof
      Error
      ? error.message
      : String(error);
  }
}
