import {
  z,
} from "zod";

import {
  agentModeSchema,
} from "../../request-intake";

import {
  repositoryStateReferenceSchema,
} from "../../repository-state/index";

import {
  contextAssemblyResultSchema,
} from "../internal/context-assembly/schema";

import {
  contextSelectionResultSchema,
} from "../internal/context-selection/schema";

import {
  hybridRetrievalResultSchema,
} from "../internal/hybrid-retrieval/schema";

import {
  REPOSITORY_CONTEXT_PIPELINE_LIMITS,
  REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION,
} from "../pipeline/context-pipeline/constants";

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

const fileReferenceSchema =
  z.object({
    rootId:
      z.string()
        .min(1)
        .optional(),
    relativePath:
      canonicalRelativePathSchema,
  }).strict();

const referencesSchema =
  z.object({
    explicitFiles:
      z.array(
        fileReferenceSchema,
      )
        .optional(),
    pinnedFiles:
      z.array(
        fileReferenceSchema
          .extend({
            priority:
              z.enum([
                "required",
                "preferred",
                "supplementary",
              ])
                .optional(),
          }),
      )
        .optional(),
    currentFile:
      fileReferenceSchema
        .optional(),
    currentSelection:
      fileReferenceSchema
        .extend({
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
        })
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
        )
        .optional(),
    openFiles:
      z.array(
        fileReferenceSchema,
      )
        .optional(),
    gitDiffFiles:
      z.array(
        fileReferenceSchema,
      )
        .optional(),
    diagnosticFiles:
      z.array(
        fileReferenceSchema,
      )
        .optional(),
    recentEditFiles:
      z.array(
        fileReferenceSchema,
      )
        .optional(),
  }).strict()
    .optional();

const selectionBudgetSchema =
  z.object({
    maximumTokens:
      z.number()
        .int()
        .positive()
        .optional(),
    maximumItems:
      z.number()
        .int()
        .positive()
        .optional(),
    maximumFiles:
      z.number()
        .int()
        .positive()
        .optional(),
    maximumItemsPerFile:
      z.number()
        .int()
        .positive()
        .optional(),
    minimumItems:
      z.number()
        .int()
        .nonnegative()
        .optional(),
    minimumScore:
      z.number()
        .min(0)
        .max(1)
        .optional(),
  }).strict()
    .optional();

export const repositoryContextPipelineInputSchema =
  z.object({
    state:
      repositoryStateReferenceSchema,
    query:
      z.string()
        .trim()
        .min(1)
        .max(
          REPOSITORY_CONTEXT_PIPELINE_LIMITS
            .MAXIMUM_QUERY_CHARACTERS,
        ),
    mode:
      agentModeSchema,
    rootIds:
      z.array(
        z.string()
          .min(1),
      )
        .max(
          REPOSITORY_CONTEXT_PIPELINE_LIMITS
            .MAXIMUM_ROOT_IDS,
        )
        .optional(),
    folderPrefix:
      z.string()
        .optional(),
    filePaths:
      z.array(
        canonicalRelativePathSchema,
      )
        .max(
          REPOSITORY_CONTEXT_PIPELINE_LIMITS
            .MAXIMUM_FILE_PATHS,
        )
        .optional(),
    kinds:
      z.array(
        z.enum([
          "code_symbol",
          "code_region",
          "markdown_section",
          "text",
        ]),
      )
        .optional(),
    maximumResults:
      z.number()
        .int()
        .positive()
        .optional(),
    maximumCandidatesPerSource:
      z.number()
        .int()
        .positive()
        .optional(),
    breadth:
      z.enum([
        "focused",
        "balanced",
        "broad",
      ])
        .optional(),
    references:
      referencesSchema,
    selectionBudget:
      selectionBudgetSchema,
    abortSignal:
      z.custom<AbortSignal>(
        (value) =>
          typeof value ===
            "object" &&
          value !== null &&
          "aborted" in value,
      )
        .optional(),
  }).strict();

const pipelineWarningSchema =
  z.object({
    stage:
      z.enum([
        "state_resolution",
        "retrieval",
        "selection",
        "assembly",
      ]),
    code:
      z.string()
        .min(1),
    message:
      z.string()
        .min(1),
  }).strict();

export const repositoryContextPipelineResultSchema =
  z.object({
    schemaVersion:
      z.literal(
        REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION,
      ),
    stateToken:
      z.string()
        .min(1),
    workspaceSnapshotId:
      z.string()
        .min(1),
    query:
      z.string()
        .min(1),
    mode:
      agentModeSchema,
    status:
      z.enum([
        "complete",
        "partial",
        "empty",
        "cancelled",
        "failed",
      ]),
    retrieval:
      hybridRetrievalResultSchema,
    selection:
      contextSelectionResultSchema,
    assembly:
      contextAssemblyResultSchema,
    warnings:
      z.array(
        pipelineWarningSchema,
      )
        .max(
          REPOSITORY_CONTEXT_PIPELINE_LIMITS
            .MAXIMUM_WARNINGS,
        ),
    statistics:
      z.object({
        retrievedCandidates:
          z.number()
            .int()
            .nonnegative(),
        selectedItems:
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
        usedTokens:
          z.number()
            .int()
            .nonnegative(),
      }).strict(),
  }).strict()
    .superRefine(
      (
        result,
        context,
      ) => {
        if (
          result
            .workspaceSnapshotId !==
          result.assembly
            .workspaceSnapshotId
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "assembly",
              "workspaceSnapshotId",
            ],
            message:
              "Assembly snapshot does not match the pipeline snapshot.",
          });
        }
      },
    );
