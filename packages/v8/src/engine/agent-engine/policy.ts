import type { ModelToolDefinition } from "../../modules/model-gateway";

/**
 * Tunable Agent Engine thresholds for token / truncation recovery.
 */
export const AGENT_ENGINE_THRESHOLDS = {
  /** Max automatic recoveries after finishReason=length with incomplete tools. */
  maxTruncationRecoveries: 3,
  /** Fallback preferred batch size when grant omits mutationBudget. */
  defaultPreferredBatchSize: 3,
  /** Fallback hard patch cap when grant omits mutationBudget. */
  defaultMaxPatchesPerCall: 8,
} as const;

/**
 * Routes supported by the single-agent Engine after Phase 8.
 * Phase 9 optionally attaches Skills/Memory before prompt construction.
 */
export const PHASE8_SUPPORTED_ROUTES = [
  "direct_answer",
  "repository_answer",
  "clarify",
  "diagnose",
  "plan",
  "execute",
] as const;

/** @deprecated Use PHASE8_SUPPORTED_ROUTES. Kept for existing Phase 7 tests. */
export const PHASE7_SUPPORTED_ROUTES = [
  "direct_answer",
  "repository_answer",
  "clarify",
  "diagnose",
] as const;

/**
 * Default JSON tool schemas for grant-filtered prompt attachment.
 * Tool Runtime still validates with its Zod schemas at execute time.
 */
export const DEFAULT_READ_ONLY_TOOL_DEFINITIONS: readonly ModelToolDefinition[] =
  [
    {
      name: "list_directory",
      description:
        "List entries in a workspace directory. Prefer this (or search_files) before opening many files with read_file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path." },
        },
      },
    },
    {
      name: "read_file",
      description:
        "Read a workspace file or line range. Use after search_files/list_directory narrows candidates; avoid reading large numbers of files one-by-one.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
        },
        required: ["path"],
      },
    },
    {
      name: "search_files",
      description:
        "Search workspace text (preferred for discovery). Use this to find symbols, tests, or patterns before read_file.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          path: { type: "string" },
          maxMatches: { type: "integer", minimum: 1, maximum: 200 },
          caseSensitive: { type: "boolean" },
        },
        required: ["query"],
      },
    },
    {
      name: "read_diagnostics",
      description: "Read workspace diagnostics.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
      },
    },
    {
      name: "read_git_status",
      description: "Read Git status and optional diff summary.",
      inputSchema: {
        type: "object",
        properties: {
          includeDiff: { type: "boolean" },
        },
      },
    },
    {
      name: "run_readonly_command",
      description: "Run an explicitly authorized read-only command.",
      inputSchema: {
        type: "object",
        properties: {
          argv: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          cwd: { type: "string" },
        },
        required: ["argv"],
      },
    },
  ];

export const DEFAULT_MUTATION_TOOL_DEFINITIONS: readonly ModelToolDefinition[] =
  [
    {
      name: "apply_patch",
      description:
        "Apply structured oldText/newText patches inside a recoverable transaction. Batch small: prefer ≤3 files per call (hard max from grant mutationBudget, catalog max 12). Use minimal hunks — never rewrite many whole files in one response; continue across turns for large refactors.",
      inputSchema: {
        type: "object",
        properties: {
          patches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                oldText: { type: "string" },
                newText: { type: "string" },
                expectedHash: { type: "string" },
              },
              required: ["path", "oldText", "newText"],
            },
            minItems: 1,
            maxItems: 12,
          },
        },
        required: ["patches"],
      },
    },
  ];

export const DEFAULT_TOOL_DEFINITIONS: readonly ModelToolDefinition[] = [
  ...DEFAULT_READ_ONLY_TOOL_DEFINITIONS,
  ...DEFAULT_MUTATION_TOOL_DEFINITIONS,
];
