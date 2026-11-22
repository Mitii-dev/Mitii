import {
  z,
} from "zod";

import type {
  RepoGraph,
} from "../../../../repository-state/index";

import type {
  RepoMap,
} from "../../../../repository-state/index";

import {
  HYBRID_RETRIEVAL_LIMITS,
} from "../constants";

export const canonicalRelativePathSchema =
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

export const chunkKindSchema =
  z.enum([
    "code_symbol",
    "code_region",
    "markdown_section",
    "text",
  ]);

export const retrievalEntityKindSchema =
  z.enum([
    "chunk",
    "file",
    "symbol",
  ]);

const retrievalReasonTypeSchema =
  z.enum([
    "lexical_match",
    "semantic_match",
    "repo_map_rank",
    "repo_map_importance_boost",
    "graph_path_match",
    "graph_file_anchor",
    "graph_symbol_match",
    "graph_call_neighbor",
    "graph_import_neighbor",
    "graph_reference_neighbor",
    "session_current_file",
    "session_open_file",
    "session_git_diff",
    "session_diagnostic",
    "session_recent_edit",
    "session_stale_file",
    "reranked",
  ]);

export const retrievalReasonSchema =
  z.object({
    type:
      retrievalReasonTypeSchema,
    evidence:
      z.string().min(1),
  }).strict();

export const repoMapReferenceSchema =
  z.custom<RepoMap>(
    (value) =>
      typeof value ===
        "object" &&
      value !== null &&
      "schemaVersion" in value &&
      value.schemaVersion === 1 &&
      "entries" in value &&
      Array.isArray(
        value.entries,
      ),
    {
      message:
        "Expected a validated RepoMap.",
    },
  );

export const repoGraphReferenceSchema =
  z.custom<RepoGraph>(
    (value) =>
      typeof value ===
        "object" &&
      value !== null &&
      "schemaVersion" in value &&
      value.schemaVersion === 1 &&
      "nodes" in value &&
      Array.isArray(
        value.nodes,
      ) &&
      "edges" in value &&
      Array.isArray(
        value.edges,
      ),
    {
      message:
        "Expected a validated RepoGraph.",
    },
  );

export const uniqueStringsSchema = (
  valueSchema: z.ZodType<string>,
) =>
  z.array(valueSchema)
    .max(
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_FILTER_VALUES,
    )
    .refine(
      (values) =>
        new Set(values).size ===
        values.length,
      {
        message:
          "Values must be unique.",
      },
    );

export const rankingContextSchema =
  z.object({
    currentFile:
      canonicalRelativePathSchema
        .optional(),
    openFiles:
      z.array(
        canonicalRelativePathSchema,
      ).optional(),
    gitDiffFiles:
      z.array(
        canonicalRelativePathSchema,
      ).optional(),
    diagnosticFiles:
      z.array(
        canonicalRelativePathSchema,
      ).optional(),
    recentEditFiles:
      z.array(
        canonicalRelativePathSchema,
      ).optional(),
    staleFiles:
      z.array(
        canonicalRelativePathSchema,
      ).optional(),
    priorityPaths:
      z.array(
        canonicalRelativePathSchema,
      ).optional(),
  }).strict();
