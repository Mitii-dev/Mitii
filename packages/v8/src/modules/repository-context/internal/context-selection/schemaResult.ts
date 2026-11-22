import {
  z,
} from "zod";

import {
  hybridRetrievalCandidateSchema,
} from "../hybrid-retrieval/schema";

import {
  CONTEXT_SELECTION_SCHEMA_VERSION,
} from "./constants";
import {
  breadthSchema,
  canonicalRelativePathSchema,
  modeSchema,
  originSchema,
  prioritySchema,
  representationSchema,
  scoreSignalTypeSchema,
} from "./schemaPrimitives";

const contextSelectionWarningSchema =
  z.object({
    code: z.enum([
      "empty_query",
      "query_truncated",
      "duplicate_reference_removed",
      "upstream_retrieval_partial",
      "upstream_retrieval_failed",
      "excluded_path_removed",
      "token_budget_reached",
      "item_limit_reached",
      "file_limit_reached",
      "per_file_limit_reached",
      "required_reference_omitted",
      "representation_downgraded",
      "unknown_token_estimate",
    ]),
    message:
      z.string().min(1),
    count:
      z.number()
        .int()
        .positive()
        .optional(),
    key:
      z.string()
        .min(1)
        .optional(),
    relativePath:
      canonicalRelativePathSchema
        .optional(),
  }).strict();

const scoreSignalSchema =
  z.object({
    type:
      scoreSignalTypeSchema,
    score:
      z.number()
        .min(-1)
        .max(1),
    evidence:
      z.string().min(1),
  }).strict();

const selectedItemSchema =
  z.object({
    key:
      z.string().min(1),
    origin:
      z.array(originSchema)
        .min(1)
        .refine(
          (origins) =>
            new Set(origins).size ===
            origins.length,
          {
            message:
              "Context item origins must be unique.",
          },
        ),
    priority:
      prioritySchema,
    entityKind:
      z.enum([
        "chunk",
        "file",
        "symbol",
      ]),
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
    startLine:
      z.number()
        .int()
        .positive()
        .optional(),
    endLine:
      z.number()
        .int()
        .positive()
        .optional(),
    retrievalCandidate:
      hybridRetrievalCandidateSchema
        .optional(),
    representation:
      representationSchema,
    allocatedTokens:
      z.number()
        .int()
        .positive(),
    estimatedTokens:
      z.number()
        .int()
        .positive(),
    score:
      z.number()
        .min(0)
        .max(1),
    selectionOrder:
      z.number()
        .int()
        .positive(),
    signals:
      z.array(
        scoreSignalSchema,
      ).min(1),
  }).strict()
    .superRefine(
      (item, context) => {
        if (
          item.entityKind ===
            "chunk" &&
          !item.chunkId
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "chunkId",
            ],
            message:
              "Chunk context items require chunkId.",
          });
        }

        if (
          item.entityKind ===
            "symbol" &&
          !item.symbolId
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "symbolId",
            ],
            message:
              "Symbol context items require symbolId.",
          });
        }

        if (
          item.startLine !==
            undefined &&
          item.endLine !==
            undefined &&
          item.endLine <
            item.startLine
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "endLine",
            ],
            message:
              "endLine must be greater than or equal to startLine.",
          });
        }
      },
    );

const droppedItemSchema =
  z.object({
    key:
      z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
    cause: z.enum([
      "excluded_path",
      "duplicate",
      "low_score",
      "covered_by_full_file",
      "token_budget",
      "item_limit",
      "file_limit",
      "per_file_limit",
      "required_reference_omitted",
    ]),
    priority:
      prioritySchema,
    score:
      z.number()
        .min(0)
        .max(1),
    estimatedTokens:
      z.number()
        .int()
        .nonnegative(),
    evidence:
      z.string().min(1),
  }).strict();

export const contextSelectionResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        CONTEXT_SELECTION_SCHEMA_VERSION,
      ),
    query:
      z.string(),
    mode:
      modeSchema,
    breadth:
      breadthSchema,
    status: z.enum([
      "complete",
      "partial",
      "empty",
      "cancelled",
      "failed",
    ]),
    items:
      z.array(
        selectedItemSchema,
      ),
    dropped:
      z.array(
        droppedItemSchema,
      ),
    warnings:
      z.array(
        contextSelectionWarningSchema,
      ),
    budget:
      z.object({
        maximumTokens:
          z.number()
            .int()
            .positive(),
        usedTokens:
          z.number()
            .int()
            .nonnegative(),
        remainingTokens:
          z.number()
            .int()
            .nonnegative(),
        maximumItems:
          z.number()
            .int()
            .positive(),
        maximumFiles:
          z.number()
            .int()
            .positive(),
        maximumItemsPerFile:
          z.number()
            .int()
            .positive(),
      }).strict(),
    statistics:
      z.object({
        retrievedCandidates:
          z.number()
            .int()
            .nonnegative(),
        synthesizedReferences:
          z.number()
            .int()
            .nonnegative(),
        consideredCandidates:
          z.number()
            .int()
            .nonnegative(),
        selectedItems:
          z.number()
            .int()
            .nonnegative(),
        droppedItems:
          z.number()
            .int()
            .nonnegative(),
        selectedFiles:
          z.number()
            .int()
            .nonnegative(),
        selectedRoots:
          z.number()
            .int()
            .nonnegative(),
        requiredItems:
          z.number()
            .int()
            .nonnegative(),
        preferredItems:
          z.number()
            .int()
            .nonnegative(),
        supplementaryItems:
          z.number()
            .int()
            .nonnegative(),
        fullFileItems:
          z.number()
            .int()
            .nonnegative(),
        exactRangeItems:
          z.number()
            .int()
            .nonnegative(),
        targetedExcerptItems:
          z.number()
            .int()
            .nonnegative(),
        fileOutlineItems:
          z.number()
            .int()
            .nonnegative(),
        symbolSignatureItems:
          z.number()
            .int()
            .nonnegative(),
      }).strict(),
  }).strict()
    .superRefine(
      (result, context) => {
        const usedTokens =
          result.items.reduce(
            (sum, item) =>
              sum +
              item.allocatedTokens,
            0,
          );

        if (
          usedTokens !==
          result.budget.usedTokens
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "budget",
              "usedTokens",
            ],
            message:
              "usedTokens must equal the sum of selected item allocations.",
          });
        }

        if (
          result.budget
            .remainingTokens !==
          result.budget
            .maximumTokens -
            result.budget
              .usedTokens
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "budget",
              "remainingTokens",
            ],
            message:
              "remainingTokens must equal maximumTokens minus usedTokens.",
          });
        }

        if (
          result.statistics
            .selectedItems !==
          result.items.length
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "statistics",
              "selectedItems",
            ],
            message:
              "selectedItems must equal items.length.",
          });
        }

        if (
          result.statistics
            .droppedItems !==
          result.dropped.length
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "statistics",
              "droppedItems",
            ],
            message:
              "droppedItems must equal dropped.length.",
          });
        }

        const keys =
          new Set<string>();

        for (
          let index = 0;
          index <
          result.items.length;
          index += 1
        ) {
          const item =
            result.items[index];

          if (!item) {
            continue;
          }

          if (
            item.selectionOrder !==
            index + 1
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "items",
                index,
                "selectionOrder",
              ],
              message:
                "selectionOrder must be sequential.",
            });
          }

          if (
            keys.has(
              item.key,
            )
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              path: [
                "items",
                index,
                "key",
              ],
              message:
                "Selected context item keys must be unique.",
            });
          }

          keys.add(
            item.key,
          );
        }

        if (
          (
            result.status ===
              "empty" ||
            result.status ===
              "cancelled" ||
            result.status ===
              "failed"
          ) &&
          result.items.length >
            0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              "items",
            ],
            message:
              "Empty, cancelled, and failed selections cannot contain items.",
          });
        }
      },
    );
