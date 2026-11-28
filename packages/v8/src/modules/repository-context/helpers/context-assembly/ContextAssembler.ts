import {
  CONTEXT_ASSEMBLY_IDS,
  CONTEXT_ASSEMBLY_MESSAGES,
} from "./constants";

import {
  assembleContextItem,
  createContextAssemblyRunState,
} from "./assembleContextItem";

import type {
  ContextAssemblyRunState,
} from "./assembleContextItem";

import {
  cancelledWarning,
} from "./contextAssemblyDrops";

import {
  buildContextAssemblyResult,
  buildTerminalAssemblyResult,
  resolveAssemblyStatus,
  sumAllocatedTokens,
} from "./contextAssemblyResultBuilders";

import {
  ContextAssemblyOptionsResolver,
} from "./ContextAssemblyOptionsResolver";

import {
  ContextAssemblyWarningAggregator,
} from "./ContextAssemblyWarningAggregator";

import {
  ContextBlockBuilder,
} from "./ContextBlockBuilder";

import {
  ContextContentLoader,
} from "./ContextContentLoader";

import {
  ContextSecretRedactor,
} from "./ContextSecretRedactor";

import {
  ContextSensitivePathPolicy,
} from "./ContextSensitivePathPolicy";

import {
  ContextTextSanitizer,
} from "./ContextTextSanitizer";

import {
  ContextTextTruncator,
} from "./ContextTextTruncator";

import {
  contextAssemblyInputSchema,
} from "./schema";

import type {
  ContextAssemblerOptions,
  ContextAssemblyInput,
  ContextAssemblyResult,
  ContextAssemblyWarning,
  ResolvedContextAssemblerOptions,
} from "./types";

export class ContextAssembler {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .ASSEMBLER;

  private readonly options:
    ResolvedContextAssemblerOptions;

  public constructor(
    options:
      ContextAssemblerOptions,
    private readonly contentLoader:
      ContextContentLoader,
    private readonly textTruncator:
      ContextTextTruncator,
    private readonly sensitivePathPolicy =
      new ContextSensitivePathPolicy(),
    private readonly textSanitizer =
      new ContextTextSanitizer(),
    private readonly secretRedactor =
      new ContextSecretRedactor(),
    private readonly blockBuilder =
      new ContextBlockBuilder(),
    private readonly warningAggregator =
      new ContextAssemblyWarningAggregator(),
    optionsResolver =
      new ContextAssemblyOptionsResolver(),
  ) {
    this.options =
      optionsResolver.resolve(
        options,
      );
  }

  public async assemble(
    rawInput:
      ContextAssemblyInput,
  ): Promise<ContextAssemblyResult> {
    const input =
      contextAssemblyInputSchema
        .parse(
          rawInput,
        ) as ContextAssemblyInput;
    const allocatedTokens =
      sumAllocatedTokens(
        input,
      );

    if (
      input.abortSignal
        ?.aborted
    ) {
      return this.terminal(
        input,
        allocatedTokens,
        "cancelled",
        [cancelledWarning()],
      );
    }

    if (
      input.selection
        .status ===
        "cancelled"
    ) {
      return this.terminal(
        input,
        allocatedTokens,
        "cancelled",
        [
          {
            code:
              "selection_cancelled",
            message:
              CONTEXT_ASSEMBLY_MESSAGES
                .SELECTION_CANCELLED,
          },
        ],
      );
    }

    if (
      input.selection
        .status ===
        "failed"
    ) {
      return this.terminal(
        input,
        allocatedTokens,
        "failed",
        [
          {
            code:
              "selection_failed",
            message:
              CONTEXT_ASSEMBLY_MESSAGES
                .SELECTION_FAILED,
          },
        ],
      );
    }

    if (
      input.selection
        .items.length ===
        0
    ) {
      return this.terminal(
        input,
        allocatedTokens,
        "empty",
        [],
      );
    }

    const state =
      createContextAssemblyRunState();

    if (
      input.selection
        .status ===
        "partial"
    ) {
      state.warnings.push({
        code:
          "selection_partial",
        message:
          CONTEXT_ASSEMBLY_MESSAGES
            .SELECTION_PARTIAL,
      });
    }

    if (
      input.snapshot
        .status !==
        "complete"
    ) {
      state.warnings.push({
        code:
          "workspace_snapshot_partial",
        message:
          CONTEXT_ASSEMBLY_MESSAGES
            .SNAPSHOT_PARTIAL,
      });
    }

    const items =
      [
        ...input.selection
          .items,
      ].sort(
        (left, right) =>
          left.selectionOrder -
            right.selectionOrder ||
          left.key.localeCompare(
            right.key,
          ),
      );

    for (
      const item
      of items
    ) {
      if (
        input.abortSignal
          ?.aborted
      ) {
        return this.cancelledMidRun(
          input,
          allocatedTokens,
          state,
        );
      }

      state.attemptedItems +=
        1;

      const outcome =
        await assembleContextItem(
          {
            options:
              this.options,
            contentLoader:
              this.contentLoader,
            textTruncator:
              this.textTruncator,
            sensitivePathPolicy:
              this.sensitivePathPolicy,
            textSanitizer:
              this.textSanitizer,
            secretRedactor:
              this.secretRedactor,
            blockBuilder:
              this.blockBuilder,
          },
          input,
          item,
          state,
        );

      if (
        outcome ===
        "cancelled"
      ) {
        return this.cancelledMidRun(
          input,
          allocatedTokens,
          state,
        );
      }
    }

    if (
      state.requiredOmitted &&
      this.options
        .requiredLoadFailureMode ===
        "fail"
    ) {
      return buildContextAssemblyResult(
        this.warningAggregator,
        {
          input,
          status:
            "failed",
          blocks: [],
          dropped:
            state.dropped,
          warnings:
            state.warnings,
          allocatedTokens,
          attemptedItems:
            state.attemptedItems,
          inputCharacters:
            state.inputCharacters,
        },
      );
    }

    return buildContextAssemblyResult(
      this.warningAggregator,
      {
        input,
        status:
          resolveAssemblyStatus(
            input,
            state.blocks,
            state.dropped,
            state.warnings,
          ),
        blocks:
          state.blocks,
        dropped:
          state.dropped,
        warnings:
          state.warnings,
        allocatedTokens,
        attemptedItems:
          state.attemptedItems,
        inputCharacters:
          state.inputCharacters,
      },
    );
  }

  private terminal(
    input:
      ContextAssemblyInput,
    allocatedTokens:
      number,
    status:
      "empty" | "cancelled" | "failed",
    warnings:
      ContextAssemblyWarning[],
  ): ContextAssemblyResult {
    return buildTerminalAssemblyResult(
      this.warningAggregator,
      {
        input,
        status,
        allocatedTokens,
        warnings,
      },
    );
  }

  private cancelledMidRun(
    input:
      ContextAssemblyInput,
    allocatedTokens:
      number,
    state:
      ContextAssemblyRunState,
  ): ContextAssemblyResult {
    return buildTerminalAssemblyResult(
      this.warningAggregator,
      {
        input,
        status:
          "cancelled",
        allocatedTokens,
        warnings: [
          ...state.warnings,
          cancelledWarning(),
        ],
        dropped:
          state.dropped,
        attemptedItems:
          state.attemptedItems,
        inputCharacters:
          state.inputCharacters,
      },
    );
  }
}
