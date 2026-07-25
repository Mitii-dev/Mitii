import {
  CONTEXT_ASSEMBLY_DEFAULTS,
  CONTEXT_ASSEMBLY_IDS,
} from "./constants";

import type {
  ContextContentSource,
  ContextContentSourceContext,
  ContextContentSourceRequest,
  ContextContentSourceResult,
} from "./types";

export class SelectedPreviewContextSource
  implements ContextContentSource
{
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .SELECTED_PREVIEW_SOURCE;

  public readonly priority =
    CONTEXT_ASSEMBLY_DEFAULTS
      .BUILTIN_SOURCE_PRIORITY;

  public supports(
    request:
      ContextContentSourceRequest,
  ): boolean {
    return Boolean(
      request.item
        .retrievalCandidate
        ?.preview,
    ) &&
      request.representation !==
        "full_file" &&
      request.representation !==
        "exact_range";
  }

  public async load(
    request:
      ContextContentSourceRequest,
    context:
      ContextContentSourceContext,
  ): Promise<ContextContentSourceResult> {
    if (
      context.abortSignal
        ?.aborted
    ) {
      return {
        status:
          "unavailable",
        message:
          "Context loading was cancelled.",
      };
    }

    const candidate =
      request.item
        .retrievalCandidate;
    const preview =
      candidate?.preview
        ?.trim();
    const contentHash =
      candidate
        ?.contentHash;

    if (!preview) {
      return {
        status:
          "unavailable",
        message:
          "The retrieval candidate does not contain a preview.",
      };
    }

    const representation =
      request.representation ===
        "symbol_signature" &&
      request.item
        .entityKind ===
        "symbol"
        ? "symbol_signature"
        : "targeted_excerpt";

    return {
      status:
        "loaded",
      content:
        preview,
      representation,
      ...(request.item
        .startLine !==
      undefined
        ? {
            startLine:
              request.item
                .startLine,
          }
        : {}),
      ...(request.item
        .endLine !==
      undefined
        ? {
            endLine:
              request.item
                .endLine,
          }
        : {}),
      ...(contentHash
        ? {
            contentHash:
              contentHash,
          }
        : {}),
    };
  }
}
