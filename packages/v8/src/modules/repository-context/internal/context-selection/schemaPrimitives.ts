import {
  z,
} from "zod";

import {
  agentModeSchema,
} from "../../../request-intake";

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

export const modeSchema =
  agentModeSchema;

export const breadthSchema =
  z.enum([
    "focused",
    "balanced",
    "broad",
  ]);

export const prioritySchema =
  z.enum([
    "required",
    "preferred",
    "supplementary",
  ]);

export const originSchema =
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
    "stale_file",
  ]);

export const representationSchema =
  z.enum([
    "full_file",
    "exact_range",
    "targeted_excerpt",
    "file_outline",
    "symbol_signature",
  ]);

export const scoreSignalTypeSchema =
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
    "stale_file",
    "required_priority",
    "diversity_penalty",
  ]);
