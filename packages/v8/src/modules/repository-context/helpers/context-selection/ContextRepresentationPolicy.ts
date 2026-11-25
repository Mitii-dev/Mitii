import {
  CONTEXT_SELECTION_IDS,
  CONTEXT_SELECTION_REPRESENTATION_QUALITY,
  CONTEXT_SELECTION_REPRESENTATION_TOKENS,
} from "./constants";

import type {
  ContextCandidate,
  ContextRepresentation,
  ContextRepresentationOption,
  ContextRepresentationPlan,
  ContextSelectionMode,
} from "./types";

export class ContextRepresentationPolicy {
  public readonly id =
    CONTEXT_SELECTION_IDS
      .REPRESENTATION_POLICY;

  public plan(
    candidate:
      ContextCandidate,
    mode:
      ContextSelectionMode,
  ): ContextRepresentationPlan {
    const representations =
      this.representations(
        candidate,
        mode,
      );
    const retrievedEstimate =
      candidate
        .retrievalCandidate
        ?.tokenEstimate;

    return {
      options:
        representations.map(
          (
            representation,
          ): ContextRepresentationOption => {
            const configured =
              CONTEXT_SELECTION_REPRESENTATION_TOKENS[
                representation
              ];
            const estimatedTokens =
              retrievedEstimate !==
                undefined &&
              (
                representation ===
                  "full_file" ||
                representation ===
                  "exact_range" ||
                representation ===
                  "targeted_excerpt"
              )
                ? Math.max(
                    1,
                    Math.min(
                      retrievedEstimate,
                      configured,
                    ),
                  )
                : configured;

            return {
              representation,
              estimatedTokens,
              quality:
                CONTEXT_SELECTION_REPRESENTATION_QUALITY[
                  representation
                ],
            };
          },
        ),
      usedDefaultEstimate:
        retrievedEstimate ===
        undefined,
    };
  }

  private representations(
    candidate:
      ContextCandidate,
    mode:
      ContextSelectionMode,
  ): ContextRepresentation[] {
    if (
      candidate.origins
        .includes(
          "current_selection",
        )
    ) {
      return [
        "exact_range",
        "targeted_excerpt",
      ];
    }

    if (
      candidate.entityKind ===
      "symbol"
    ) {
      return [
        "symbol_signature",
        "targeted_excerpt",
      ];
    }

    if (
      candidate.entityKind ===
      "chunk"
    ) {
      return [
        "targeted_excerpt",
      ];
    }

    if (
      candidate.origins
        .includes(
          "explicit_file",
        ) ||
      candidate.origins
        .includes(
          "pinned_file",
        )
    ) {
      return [
        "full_file",
        "file_outline",
        "targeted_excerpt",
      ];
    }

    if (
      candidate.origins
        .includes(
          "current_file",
        ) &&
      mode !==
        "plan"
    ) {
      return [
        "full_file",
        "file_outline",
        "targeted_excerpt",
      ];
    }

    return [
      "file_outline",
      "targeted_excerpt",
    ];
  }
}
