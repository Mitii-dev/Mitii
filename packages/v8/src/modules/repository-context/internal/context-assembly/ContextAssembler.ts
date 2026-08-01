import {
  CONTEXT_ASSEMBLY_IDS,
  CONTEXT_ASSEMBLY_MESSAGES,
  CONTEXT_ASSEMBLY_SCHEMA_VERSION,
} from "./constants";

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
  contextAssemblyResultSchema,
} from "./schema";

import type {
  ContextAssemblyDropCause,
  ContextAssemblerOptions,
  ContextAssemblyInput,
  ContextAssemblyResult,
  ContextAssemblyStatistics,
  ContextAssemblyStatus,
  ContextAssemblyWarning,
  ContextBlock,
  ContextContentLoadResult,
  DroppedContextBlock,
  ResolvedContextAssemblerOptions,
} from "./types";

import type {
  SelectedContextItem,
} from "../context-selection/types";

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
      this.allocatedTokens(
        input,
      );

    if (
      input.abortSignal
        ?.aborted
    ) {
      return this.terminal({
        input,
        status:
          "cancelled",
        allocatedTokens,
        warnings: [
          {
            code:
              "cancelled",
            message:
              CONTEXT_ASSEMBLY_MESSAGES
                .CANCELLED,
          },
        ],
      });
    }

    if (
      input.selection
        .status ===
        "cancelled"
    ) {
      return this.terminal({
        input,
        status:
          "cancelled",
        allocatedTokens,
        warnings: [
          {
            code:
              "selection_cancelled",
            message:
              CONTEXT_ASSEMBLY_MESSAGES
                .SELECTION_CANCELLED,
          },
        ],
      });
    }

    if (
      input.selection
        .status ===
        "failed"
    ) {
      return this.terminal({
        input,
        status:
          "failed",
        allocatedTokens,
        warnings: [
          {
            code:
              "selection_failed",
            message:
              CONTEXT_ASSEMBLY_MESSAGES
                .SELECTION_FAILED,
          },
        ],
      });
    }

    if (
      input.selection
        .items.length ===
        0
    ) {
      return this.terminal({
        input,
        status:
          "empty",
        allocatedTokens,
        warnings: [],
      });
    }

    const warnings:
      ContextAssemblyWarning[] = [];
    const dropped:
      DroppedContextBlock[] = [];
    const blocks:
      ContextBlock[] = [];
    const seenBlockIds =
      new Set<string>();
    let attemptedItems =
      0;
    let inputCharacters =
      0;
    let requiredOmitted =
      false;

    if (
      input.selection
        .status ===
        "partial"
    ) {
      warnings.push({
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
      warnings.push({
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
        return this.terminal({
          input,
          status:
            "cancelled",
          allocatedTokens,
          warnings: [
            ...warnings,
            {
              code:
                "cancelled",
              message:
                CONTEXT_ASSEMBLY_MESSAGES
                  .CANCELLED,
            },
          ],
          dropped,
          attemptedItems,
          inputCharacters,
        });
      }

      attemptedItems +=
        1;

      const sensitive =
        this.sensitivePathPolicy
          .evaluate(
            item.relativePath,
          );

      if (
        sensitive.sensitive &&
        this.options
          .sensitivePathMode ===
          "block"
      ) {
        dropped.push(
          this.drop(
            item,
            "sensitive_path",
            `${CONTEXT_ASSEMBLY_MESSAGES.SENSITIVE_PATH_BLOCKED} Rule: ${sensitive.matchedRule ?? "sensitive-path"}.`,
          ),
        );
        warnings.push({
          code:
            "sensitive_path_blocked",
          message:
            CONTEXT_ASSEMBLY_MESSAGES
              .SENSITIVE_PATH_BLOCKED,
          selectionKey:
            item.key,
          relativePath:
            item.relativePath,
        });
        requiredOmitted =
          this.markRequiredOmitted(
            item,
            warnings,
          ) ||
          requiredOmitted;
        continue;
      }

      const loadResult =
        await this.contentLoader
          .load({
            item,
            snapshot:
              input.snapshot,
            maximumBytes:
              this.options
                .maximumBytesPerItem,
            allowRepresentationFallback:
              this.options
                .allowRepresentationFallback,
            ...(input
              .abortSignal
              ? {
                  abortSignal:
                    input
                      .abortSignal,
                }
              : {}),
          });

      if (
        loadResult.status ===
          "cancelled"
      ) {
        return this.terminal({
          input,
          status:
            "cancelled",
          allocatedTokens,
          warnings: [
            ...warnings,
            {
              code:
                "cancelled",
              message:
                CONTEXT_ASSEMBLY_MESSAGES
                  .CANCELLED,
            },
          ],
          dropped,
          attemptedItems,
          inputCharacters,
        });
      }

      if (
        loadResult.status !==
          "loaded" ||
        !loadResult.loaded
      ) {
        const failure =
          this.loadFailure(
            item,
            loadResult,
          );
        dropped.push(
          failure.drop,
        );
        warnings.push(
          ...failure.warnings,
        );
        requiredOmitted =
          this.markRequiredOmitted(
            item,
            warnings,
          ) ||
          requiredOmitted;
        continue;
      }

      const loaded =
        loadResult.loaded;
      inputCharacters +=
        loaded.content.length;

      for (
        const failedAttempt
        of loadResult.attempts
          .filter(
            (attempt) =>
              attempt.status ===
              "failed",
          )
      ) {
        warnings.push({
          code:
            "content_source_failed",
          message:
            `${CONTEXT_ASSEMBLY_MESSAGES.CONTENT_SOURCE_FAILED} ${failedAttempt.message}`,
          selectionKey:
            item.key,
          relativePath:
            item.relativePath,
          sourceId:
            failedAttempt
              .sourceId,
        });
      }

      if (
        loaded.fallbackUsed
      ) {
        warnings.push({
          code:
            "representation_fallback",
          message:
            CONTEXT_ASSEMBLY_MESSAGES
              .REPRESENTATION_FALLBACK,
          selectionKey:
            item.key,
          relativePath:
            item.relativePath,
          sourceId:
            loaded.sourceId,
        });
      }

      const sanitized =
        this.textSanitizer
          .sanitize(
            loaded.content,
          );

      if (
        sanitized
          .removedControlCharacters >
          0
      ) {
        warnings.push({
          code:
            "content_sanitized",
          message:
            CONTEXT_ASSEMBLY_MESSAGES
              .CONTENT_SANITIZED,
          count:
            sanitized
              .removedControlCharacters,
          selectionKey:
            item.key,
          relativePath:
            item.relativePath,
          sourceId:
            loaded.sourceId,
        });
      }

      const redaction =
        this.options
          .redactSecrets
          ? this.secretRedactor
              .redact(
                sanitized
                  .content,
              )
          : {
              content:
                sanitized
                  .content,
              redactions: [],
            };

      if (
        redaction.redactions
          .length >
        0
      ) {
        warnings.push({
          code:
            "secrets_redacted",
          message:
            CONTEXT_ASSEMBLY_MESSAGES
              .SECRETS_REDACTED,
          count:
            redaction.redactions
              .reduce(
                (
                  sum,
                  current,
                ) =>
                  sum +
                  current.count,
                0,
              ),
          selectionKey:
            item.key,
          relativePath:
            item.relativePath,
          sourceId:
            loaded.sourceId,
        });
      }

      if (
        !redaction.content
          .trim()
      ) {
        dropped.push(
          this.drop(
            item,
            "empty_content",
            CONTEXT_ASSEMBLY_MESSAGES
              .EMPTY_CONTENT,
          ),
        );
        warnings.push({
          code:
            "empty_content",
          message:
            CONTEXT_ASSEMBLY_MESSAGES
              .EMPTY_CONTENT,
          selectionKey:
            item.key,
          relativePath:
            item.relativePath,
          sourceId:
            loaded.sourceId,
        });
        requiredOmitted =
          this.markRequiredOmitted(
            item,
            warnings,
          ) ||
          requiredOmitted;
        continue;
      }

      const truncated =
        this.textTruncator
          .truncate({
            content:
              redaction.content,
            maximumTokens:
              item.allocatedTokens,
            representation:
              loaded
                .representation,
            ...(loaded
              .startLine !==
            undefined
              ? {
                  startLine:
                    loaded
                      .startLine,
                }
              : {}),
            ...(loaded
              .endLine !==
            undefined
              ? {
                  endLine:
                    loaded
                      .endLine,
                }
              : {}),
          });

      if (
        truncated.truncated
      ) {
        warnings.push({
          code:
            "content_truncated",
          message:
            CONTEXT_ASSEMBLY_MESSAGES
              .CONTENT_TRUNCATED,
          selectionKey:
            item.key,
          relativePath:
            item.relativePath,
          sourceId:
            loaded.sourceId,
        });
      }

      const block =
        this.blockBuilder
          .build({
            item,
            loaded,
            content:
              truncated.content,
            tokenEstimate:
              truncated
                .tokenEstimate,
            lineRanges:
              truncated
                .lineRanges,
            truncated:
              truncated.truncated,
            omittedCharacters:
              truncated
                .omittedCharacters,
            redactions:
              redaction.redactions,
          });

      if (
        seenBlockIds.has(
          block.id,
        )
      ) {
        dropped.push(
          this.drop(
            item,
            "duplicate_block",
            CONTEXT_ASSEMBLY_MESSAGES
              .DUPLICATE_BLOCK_REMOVED,
          ),
        );
        warnings.push({
          code:
            "duplicate_block_removed",
          message:
            CONTEXT_ASSEMBLY_MESSAGES
              .DUPLICATE_BLOCK_REMOVED,
          selectionKey:
            item.key,
          relativePath:
            item.relativePath,
          sourceId:
            loaded.sourceId,
        });
        continue;
      }

      seenBlockIds.add(
        block.id,
      );
      blocks.push(
        block,
      );
    }

    if (
      requiredOmitted &&
      this.options
        .requiredLoadFailureMode ===
        "fail"
    ) {
      return this.buildResult({
        input,
        status:
          "failed",
        blocks: [],
        dropped,
        warnings,
        allocatedTokens,
        attemptedItems,
        inputCharacters,
      });
    }

    return this.buildResult({
      input,
      status:
        this.resolveStatus(
          input,
          blocks,
          dropped,
          warnings,
        ),
      blocks,
      dropped,
      warnings,
      allocatedTokens,
      attemptedItems,
      inputCharacters,
    });
  }

  private loadFailure(
    item:
      SelectedContextItem,
    result:
      ContextContentLoadResult,
  ): {
    drop:
      DroppedContextBlock;
    warnings:
      ContextAssemblyWarning[];
  } {
    const failedAttempts =
      result.attempts
        .filter(
          (attempt) =>
            attempt.status ===
            "failed",
        );

    if (
      result.status ===
        "failed"
    ) {
      return {
        drop:
          this.drop(
            item,
            "content_source_failed",
            CONTEXT_ASSEMBLY_MESSAGES
              .CONTENT_SOURCE_FAILED,
          ),
        warnings:
          failedAttempts.length >
            0
            ? failedAttempts.map(
                (attempt) => ({
                  code:
                    "content_source_failed",
                  message:
                    `${CONTEXT_ASSEMBLY_MESSAGES.CONTENT_SOURCE_FAILED} ${attempt.message}`,
                  selectionKey:
                    item.key,
                  relativePath:
                    item
                      .relativePath,
                  sourceId:
                    attempt
                      .sourceId,
                }),
              )
            : [
                {
                  code:
                    "content_source_failed",
                  message:
                    CONTEXT_ASSEMBLY_MESSAGES
                      .CONTENT_SOURCE_FAILED,
                  selectionKey:
                    item.key,
                  relativePath:
                    item
                      .relativePath,
                },
              ],
      };
    }

    const allNotFound =
      result.attempts.length >
        0 &&
      result.attempts.every(
        (attempt) =>
          attempt.status ===
          "not_found",
      );
    const cause:
      ContextAssemblyDropCause =
        allNotFound
          ? "content_not_found"
          : "content_unavailable";
    const code =
      allNotFound
        ? "content_not_found" as const
        : "content_unavailable" as const;
    const message =
      allNotFound
        ? CONTEXT_ASSEMBLY_MESSAGES
            .CONTENT_NOT_FOUND
        : CONTEXT_ASSEMBLY_MESSAGES
            .CONTENT_UNAVAILABLE;

    return {
      drop:
        this.drop(
          item,
          cause,
          message,
        ),
      warnings: [
        {
          code,
          message,
          selectionKey:
            item.key,
          relativePath:
            item.relativePath,
        },
      ],
    };
  }

  private markRequiredOmitted(
    item:
      SelectedContextItem,
    warnings:
      ContextAssemblyWarning[],
  ): boolean {
    if (
      item.priority !==
      "required"
    ) {
      return false;
    }

    warnings.push({
      code:
        "required_content_omitted",
      message:
        CONTEXT_ASSEMBLY_MESSAGES
          .REQUIRED_CONTENT_OMITTED,
      selectionKey:
        item.key,
      relativePath:
        item.relativePath,
    });

    return true;
  }

  private resolveStatus(
    input:
      ContextAssemblyInput,
    blocks:
      readonly ContextBlock[],
    dropped:
      readonly DroppedContextBlock[],
    warnings:
      readonly ContextAssemblyWarning[],
  ): ContextAssemblyStatus {
    if (
      blocks.length ===
        0
    ) {
      return dropped.length >
        0
        ? "partial"
        : "empty";
    }

    const degraded =
      input.selection
        .status ===
        "partial" ||
      input.snapshot
        .status !==
        "complete" ||
      dropped.length >
        0 ||
      warnings.some(
        (warning) =>
          warning.code ===
            "representation_fallback" ||
          warning.code ===
            "content_source_failed" ||
          warning.code ===
            "required_content_omitted",
      );

    return degraded
      ? "partial"
      : "complete";
  }

  private drop(
    item:
      SelectedContextItem,
    cause:
      ContextAssemblyDropCause,
    evidence: string,
  ): DroppedContextBlock {
    return {
      selectionKey:
        item.key,
      relativePath:
        item.relativePath,
      priority:
        item.priority,
      cause,
      evidence,
    };
  }

  private terminal(
    input: {
      input:
        ContextAssemblyInput;
      status:
        Extract<
          ContextAssemblyStatus,
          | "empty"
          | "cancelled"
          | "failed"
        >;
      allocatedTokens:
        number;
      warnings:
        ContextAssemblyWarning[];
      dropped?:
        DroppedContextBlock[];
      attemptedItems?:
        number;
      inputCharacters?:
        number;
    },
  ): ContextAssemblyResult {
    return this.buildResult({
      input:
        input.input,
      status:
        input.status,
      blocks: [],
      dropped:
        input.dropped ??
        [],
      warnings:
        input.warnings,
      allocatedTokens:
        input
          .allocatedTokens,
      attemptedItems:
        input
          .attemptedItems ??
        0,
      inputCharacters:
        input
          .inputCharacters ??
        0,
    });
  }

  private buildResult(
    input: {
      input:
        ContextAssemblyInput;
      status:
        ContextAssemblyStatus;
      blocks:
        ContextBlock[];
      dropped:
        DroppedContextBlock[];
      warnings:
        ContextAssemblyWarning[];
      allocatedTokens:
        number;
      attemptedItems:
        number;
      inputCharacters:
        number;
    },
  ): ContextAssemblyResult {
    const usedTokens =
      input.blocks.reduce(
        (sum, block) =>
          sum +
          block.tokenEstimate,
        0,
      );
    const result:
      ContextAssemblyResult = {
        schemaVersion:
          CONTEXT_ASSEMBLY_SCHEMA_VERSION,
        workspaceSnapshotId:
          input.input
            .snapshot
            .snapshotId,
        selectionStatus:
          input.input
            .selection
            .status,
        status:
          input.status,
        blocks:
          input.blocks,
        dropped:
          input.dropped,
        warnings:
          this.warningAggregator
            .aggregate(
              input.warnings,
            ),
        budget: {
          allocatedTokens:
            input
              .allocatedTokens,
          usedTokens,
          remainingTokens:
            Math.max(
              0,
              input
                .allocatedTokens -
                usedTokens,
            ),
        },
        statistics:
          this.statistics(
            input,
          ),
      };

    return contextAssemblyResultSchema
      .parse(result) as
      ContextAssemblyResult;
  }

  private statistics(
    input: {
      input:
        ContextAssemblyInput;
      blocks:
        readonly ContextBlock[];
      dropped:
        readonly DroppedContextBlock[];
      attemptedItems:
        number;
      inputCharacters:
        number;
    },
  ): ContextAssemblyStatistics {
    const fileKeys =
      new Set(
        input.blocks.map(
          (block) =>
            `${block.rootId ?? ""}\u0000${block.relativePath}`,
        ),
      );
    const roots =
      new Set(
        input.blocks.flatMap(
          (block) =>
            block.rootId
              ? [
                  block.rootId,
                ]
              : [],
        ),
      );

    return {
      selectedItems:
        input.input
          .selection
          .items.length,
      attemptedItems:
        input
          .attemptedItems,
      assembledBlocks:
        input.blocks.length,
      droppedBlocks:
        input.dropped.length,
      loadedFiles:
        fileKeys.size,
      loadedRoots:
        roots.size,
      truncatedBlocks:
        input.blocks.filter(
          (block) =>
            block.truncated,
        ).length,
      fallbackBlocks:
        input.blocks.filter(
          (block) =>
            block
              .requestedRepresentation !==
            block.representation,
        ).length,
      redactedBlocks:
        input.blocks.filter(
          (block) =>
            block.redactions
              .length >
            0,
        ).length,
      redactionCount:
        input.blocks.reduce(
          (
            sum,
            block,
          ) =>
            sum +
            block.redactions
              .reduce(
                (
                  redactionSum,
                  redaction,
                ) =>
                  redactionSum +
                  redaction.count,
                0,
              ),
          0,
        ),
      inputCharacters:
        input
          .inputCharacters,
      outputCharacters:
        input.blocks.reduce(
          (sum, block) =>
            sum +
            block.content.length,
          0,
        ),
    };
  }

  private allocatedTokens(
    input:
      ContextAssemblyInput,
  ): number {
    return input.selection
      .items
      .reduce(
        (sum, item) =>
          sum +
          item.allocatedTokens,
        0,
      );
  }
}
