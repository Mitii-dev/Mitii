import {
  CODE_INDEXING_DEFAULTS,
} from "../../internal/code-indexing/constants";

import {
  TEXT_INDEX_DEFAULTS,
} from "../../internal/text-index/constants";

import type {
  WorkspaceIndexingFailureMode,
} from "./types";

export const WORKSPACE_INDEXING_PIPELINE_SCHEMA_VERSION =
  1 as const;

export const WORKSPACE_INDEXING_PIPELINE_IDS = {
  PIPELINE:
    "workspace-indexing-pipeline",
  FILE_SELECTOR:
    "workspace-indexing-file-selector",
  FILE_PROCESSOR:
    "workspace-indexing-file-processor",
  ROOT_FINALIZER:
    "workspace-indexing-root-finalizer",
} as const;

export const WORKSPACE_INDEXING_PIPELINE_DEFAULTS = {
  MAXIMUM_FILES:
    50_000,
  CONCURRENCY:
    2,
  MAXIMUM_REPORTED_FILE_RESULTS:
    2_000,
  FAILURE_MODE:
    "best_effort" as
      WorkspaceIndexingFailureMode,
  CLEANUP_MISSING:
    true,
  SYNCHRONIZE_EMBEDDINGS:
    true,
  ANALYSIS_VERSION:
    CODE_INDEXING_DEFAULTS
      .ANALYSIS_VERSION,
  TEXT_PIPELINE_VERSION:
    TEXT_INDEX_DEFAULTS
      .PIPELINE_VERSION,
} as const;

export const WORKSPACE_INDEXING_PIPELINE_LIMITS = {
  MAXIMUM_WORKSPACE_CHARACTERS:
    4_096,
  MAXIMUM_FILTER_VALUES:
    25_000,
  MAXIMUM_FILES:
    100_000,
  MAXIMUM_CONCURRENCY:
    32,
  MAXIMUM_REPORTED_FILE_RESULTS:
    10_000,
  MAXIMUM_WARNINGS:
    10_000,
  MAXIMUM_VERSION_CHARACTERS:
    256,
} as const;

export const WORKSPACE_INDEXING_PIPELINE_MESSAGES = {
  CLEANUP_PARTIAL_SNAPSHOT:
    "Missing-file cleanup is disabled because the WorkspaceSnapshot is not complete.",
  CLEANUP_FILTERED_RUN:
    "Missing-file cleanup is disabled for a file-filtered indexing run.",
  CLEANUP_TRUNCATED_RUN:
    "Missing-file cleanup is disabled because not every selected file was processed.",
  CLEANUP_POLICY_FAILURE:
    "Missing-file cleanup is disabled because the file policy failed for one or more files.",
  FILE_LIMIT_REACHED:
    "The workspace file limit was reached.",
  FILE_RESULTS_TRUNCATED:
    "The returned per-file result list was truncated; aggregate statistics remain complete.",
} as const;

export const WORKSPACE_INDEXING_FILE_RESULT_SEVERITY = {
  failed:
    0,
  cancelled:
    1,
  partial:
    2,
  complete:
    3,
} as const;
