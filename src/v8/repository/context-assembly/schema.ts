import {
  z,
} from "zod";

import {
  contextSelectionResultSchema,
} from "../context-selection/schema";

import {
  workspaceSnapshotSchema,
} from "../workspace/schema";

import {
  CONTEXT_ASSEMBLY_LIMITS,
  CONTEXT_ASSEMBLY_SCHEMA_VERSION,
} from "./constants";

const representationSchema =
  z.enum([
    "full_file",
    "exact_range",
    "targeted_excerpt",
    "file_outline",
    "symbol_signature",
  ]);

const originSchema =
  z.enum([
    "retrieval",
    "explicit_file",
    "pinned_file",
    "current_file",
    "current_selection",
    "open_file",
    "git_diff",
    "diagnostic",
    "recent_edit",
  ]);

const prioritySchema =
  z.enum([
    "required",
    "preferred",
    "supplementary",
  ]);

const canonicalRelativePathSchema =
  z.string()
    .min(1)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.endsWith("/") &&
        !value.includes("\\") &&
        !value
          .split("/")
          .some(
            (segment) =>
              !segment ||
              segment === "." ||
              segment === "..",
          ),
      {
        message:
          "Expected a canonical workspace-relative path.",
      },
    );

const scoreSignalSchema =
  z.object({
    type:
      z.enum([
        "retrieval_score",
        "multi_source_agreement",
        "query_path_match",
        "explicit_file",
        "pinned_file",
        "current_file",
        "current_selection",
        "open_file",
        "git_diff",
        "diagnostic",
        "recent_edit",
        "required_priority",
        "diversity_penalty",
      ]),
    score:
      z.number()
        .min(-1)
        .max(1),
    evidence:
      z.string().min(1),
  }).strict();

const lineRangeSchema =
  z.object({
    startLine:
      z.number()
        .int()
        .positive(),
    endLine:
      z.number()
        .int()
        .positive(),
  }).strict()
    .refine(
      (range) =>
        range.endLine >=
        range.startLine,
      {
        path: [
          "endLine",
        ],
        message:
          "endLine must be greater than or equal to startLine.",
      },
    );

const redactionSchema =
  z.object({
    patternId:
      z.string().min(1),
    count:
      z.number()
        .int()
        .positive(),
  }).strict();

const provenanceSchema =
  z.object({
    selectionKey:
      z.string().min(1),
    selectionOrder:
      z.number()
        .int()
        .nonnegative(),
    origins:
      z.array(originSchema)
        .min(1),
    priority:
      prioritySchema,
    score:
      z.number()
        .min(0)
        .max(1),
    signals:
      z.array(
        scoreSignalSchema,
      ),
    retrievalSourceIds:
      z.array(
        z.string().min(1),
      ).refine(
        (values) =>
          new Set(values).size ===
          values.length,
        {
          message:
            "Retrieval source IDs must be unique.",
        },
      ),
  }).strict();

const contextBlockSchema =
  z.object({
    id:
      z.string().min(1),
    trust:
      z.literal(
        "untrusted_repository_content",
      ),
    sourceId:
      z.string().min(1),
    rootId:
      z.string()
        .min(1)
        .optional(),
    relativePath:
      canonicalRelativePathSchema,
    chunkId:
      z.string()
        .min(1)
        .optional(),
    symbolId:
      z.string()
        .min(1)
        .optional(),
    requestedRepresentation:
      representationSchema,
    representation:
      representationSchema,
    content:
      z.string()
        .min(1)
        .max(
          CONTEXT_ASSEMBLY_LIMITS
            .MAXIMUM_CONTENT_CHARACTERS_PER_BLOCK,
        ),
    contentHash:
      z.string()
        .min(1)
        .optional(),
    lineRanges:
      z.array(
        lineRangeSchema,
      ),
    allocatedTokens:
      z.number()
        .int()
        .positive(),
    tokenEstimate:
      z.number()
        .int()
        .positive(),
    truncated:
      z.boolean(),
    omittedCharacters:
      z.number()
        .int()
        .nonnegative(),
    redactions:
      z.array(
        redactionSchema,
      ),
    provenance:
      provenanceSchema,
  }).strict()
    .refine(
      (block) =>
        block.tokenEstimate <=
        block.allocatedTokens,
      {
        path: [
          "tokenEstimate",
        ],
        message:
          "A context block cannot exceed its allocated token allowance.",
      },
    );

const droppedBlockSchema =
  z.object({
    selectionKey:
      z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
    priority:
      prioritySchema,
    cause:
      z.enum([
        "sensitive_path",
        "content_not_found",
        "content_unavailable",
        "content_source_failed",
        "empty_content",
        "duplicate_block",
        "required_content_omitted",
      ]),
    evidence:
      z.string().min(1),
  }).strict();

const warningSchema =
  z.object({
    code:
      z.enum([
        "selection_partial",
        "selection_failed",
        "selection_cancelled",
        "workspace_snapshot_partial",
        "sensitive_path_blocked",
        "content_not_found",
        "content_unavailable",
        "content_source_failed",
        "representation_fallback",
        "content_sanitized",
        "secrets_redacted",
        "content_truncated",
        "empty_content",
        "duplicate_block_removed",
        "required_content_omitted",
        "cancelled",
      ]),
    message:
      z.string().min(1),
    count:
      z.number()
        .int()
        .positive()
        .optional(),
    selectionKey:
      z.string()
        .min(1)
        .optional(),
    relativePath:
      canonicalRelativePathSchema
        .optional(),
    sourceId:
      z.string()
        .min(1)
        .optional(),
  }).strict();

export const contextAssemblyInputSchema =
  z.object({
    selection:
      contextSelectionResultSchema,
    snapshot:
      workspaceSnapshotSchema,
    abortSignal:
      z.custom<AbortSignal>(
        (value) =>
          typeof value ===
            "object" &&
          value !== null &&
          "aborted" in value,
      ).optional(),
  }).strict();

export const contextAssemblerOptionsSchema =
  z.object({
    maximumBytesPerItem:
      z.number()
        .int()
        .positive()
        .max(
          CONTEXT_ASSEMBLY_LIMITS
            .MAXIMUM_BYTES_PER_ITEM,
        )
        .optional(),
    requiredLoadFailureMode:
      z.enum([
        "partial",
        "fail",
      ]).optional(),
    sensitivePathMode:
      z.enum([
        "block",
        "redact",
      ]).optional(),
    redactSecrets:
      z.boolean()
        .optional(),
    allowRepresentationFallback:
      z.boolean()
        .optional(),
  }).strict()
    .superRefine(
      (options, context) => {
        if (
          options.sensitivePathMode ===
            "redact" &&
          options.redactSecrets ===
            false
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "redactSecrets",
            ],
            message:
              "redactSecrets cannot be false when sensitivePathMode is redact.",
          });
        }
      },
    );

export const contextAssemblyResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        CONTEXT_ASSEMBLY_SCHEMA_VERSION,
      ),
    workspaceSnapshotId:
      z.string().min(1),
    selectionStatus:
      z.enum([
        "complete",
        "partial",
        "empty",
        "cancelled",
        "failed",
      ]),
    status:
      z.enum([
        "complete",
        "partial",
        "empty",
        "cancelled",
        "failed",
      ]),
    blocks:
      z.array(
        contextBlockSchema,
      ).max(
        CONTEXT_ASSEMBLY_LIMITS
          .MAXIMUM_BLOCK_COUNT,
      ),
    dropped:
      z.array(
        droppedBlockSchema,
      ),
    warnings:
      z.array(
        warningSchema,
      ).max(
        CONTEXT_ASSEMBLY_LIMITS
          .MAXIMUM_WARNING_COUNT,
      ),
    budget:
      z.object({
        allocatedTokens:
          z.number()
            .int()
            .nonnegative(),
        usedTokens:
          z.number()
            .int()
            .nonnegative(),
        remainingTokens:
          z.number()
            .int()
            .nonnegative(),
      }).strict(),
    statistics:
      z.object({
        selectedItems:
          z.number()
            .int()
            .nonnegative(),
        attemptedItems:
          z.number()
            .int()
            .nonnegative(),
        assembledBlocks:
          z.number()
            .int()
            .nonnegative(),
        droppedBlocks:
          z.number()
            .int()
            .nonnegative(),
        loadedFiles:
          z.number()
            .int()
            .nonnegative(),
        loadedRoots:
          z.number()
            .int()
            .nonnegative(),
        truncatedBlocks:
          z.number()
            .int()
            .nonnegative(),
        fallbackBlocks:
          z.number()
            .int()
            .nonnegative(),
        redactedBlocks:
          z.number()
            .int()
            .nonnegative(),
        redactionCount:
          z.number()
            .int()
            .nonnegative(),
        inputCharacters:
          z.number()
            .int()
            .nonnegative(),
        outputCharacters:
          z.number()
            .int()
            .nonnegative(),
      }).strict(),
  }).strict()
    .superRefine(
      (result, context) => {
        const usedTokens =
          result.blocks.reduce(
            (sum, block) =>
              sum +
              block.tokenEstimate,
            0,
          );

        if (
          usedTokens !==
          result.budget.usedTokens
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "budget",
              "usedTokens",
            ],
            message:
              "usedTokens must equal the sum of assembled block estimates.",
          });
        }

        if (
          result.budget
            .allocatedTokens !==
          result.budget
              .usedTokens +
            result.budget
              .remainingTokens
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "budget",
              "remainingTokens",
            ],
            message:
              "remainingTokens must reconcile with allocatedTokens and usedTokens.",
          });
        }

        if (
          (
            result.status ===
              "failed" ||
            result.status ===
              "cancelled" ||
            result.status ===
              "empty"
          ) &&
          result.blocks.length > 0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "blocks",
            ],
            message:
              `${result.status} assembly results cannot contain context blocks.`,
          });
        }
      },
    );
