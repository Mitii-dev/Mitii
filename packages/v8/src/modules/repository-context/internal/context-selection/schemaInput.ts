import {
  z,
} from "zod";

import {
  hybridRetrievalResultSchema,
} from "../hybrid-retrieval/schema";

import {
  CONTEXT_SELECTION_LIMITS,
} from "./constants";
import {
  breadthSchema,
  modeSchema,
  prioritySchema,
} from "./schemaPrimitives";

const fileReferenceSchema =
  z.object({
    rootId:
      z.string()
        .min(1)
        .optional(),
    relativePath:
      z.string().min(1),
  }).strict();

const pinnedReferenceSchema =
  fileReferenceSchema.extend({
    priority:
      prioritySchema.optional(),
  }).strict();

const editorSelectionSchema =
  fileReferenceSchema.extend({
    startLine:
      z.number()
        .int()
        .positive(),
    endLine:
      z.number()
        .int()
        .positive(),
    explicitlyReferenced:
      z.boolean()
        .optional(),
  }).strict()
    .refine(
      (selection) =>
        selection.endLine >=
        selection.startLine,
      {
        path: [
          "endLine",
        ],
        message:
          "endLine must be greater than or equal to startLine.",
      },
    );

const referenceArraySchema = <
  T extends z.ZodTypeAny,
>(
  schema: T,
) =>
  z.array(schema)
    .max(
      CONTEXT_SELECTION_LIMITS
        .MAXIMUM_REFERENCES_PER_GROUP,
    );

const budgetSchema =
  z.object({
    maximumTokens:
      z.number()
        .int()
        .positive()
        .max(
          CONTEXT_SELECTION_LIMITS
            .MAXIMUM_TOKENS,
        )
        .optional(),
    maximumItems:
      z.number()
        .int()
        .positive()
        .max(
          CONTEXT_SELECTION_LIMITS
            .MAXIMUM_ITEMS,
        )
        .optional(),
    maximumFiles:
      z.number()
        .int()
        .positive()
        .max(
          CONTEXT_SELECTION_LIMITS
            .MAXIMUM_FILES,
        )
        .optional(),
    maximumItemsPerFile:
      z.number()
        .int()
        .positive()
        .max(
          CONTEXT_SELECTION_LIMITS
            .MAXIMUM_ITEMS_PER_FILE,
        )
        .optional(),
    minimumItems:
      z.number()
        .int()
        .nonnegative()
        .max(
          CONTEXT_SELECTION_LIMITS
            .MAXIMUM_MINIMUM_ITEMS,
        )
        .optional(),
    minimumScore:
      z.number()
        .min(0)
        .max(1)
        .optional(),
  }).strict();

export const contextSelectionInputSchema =
  z.object({
    query:
      z.string()
        .max(
          CONTEXT_SELECTION_LIMITS
            .MAXIMUM_QUERY_CHARACTERS,
        ),
    retrieval:
      hybridRetrievalResultSchema,
    mode:
      modeSchema.optional(),
    breadth:
      breadthSchema.optional(),
    references:
      z.object({
        explicitFiles:
          referenceArraySchema(
            fileReferenceSchema,
          ).optional(),
        pinnedFiles:
          referenceArraySchema(
            pinnedReferenceSchema,
          ).optional(),
        currentFile:
          fileReferenceSchema
            .optional(),
        currentSelection:
          editorSelectionSchema
            .optional(),
        openFiles:
          referenceArraySchema(
            fileReferenceSchema,
          ).optional(),
        gitDiffFiles:
          referenceArraySchema(
            fileReferenceSchema,
          ).optional(),
        diagnosticFiles:
          referenceArraySchema(
            fileReferenceSchema,
          ).optional(),
        recentEditFiles:
          referenceArraySchema(
            fileReferenceSchema,
          ).optional(),
        staleFiles:
          referenceArraySchema(
            fileReferenceSchema,
          ).optional(),
      }).strict()
        .optional(),
    budget:
      budgetSchema.optional(),
    abortSignal:
      z.custom<AbortSignal>(
        (value) =>
          typeof value ===
            "object" &&
          value !== null &&
          "aborted" in value,
      ).optional(),
  }).strict();
