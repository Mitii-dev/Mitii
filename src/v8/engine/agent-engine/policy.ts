import type { ModelToolDefinition } from "../../modules/model-gateway";

/**
 * Routes supported by the single-agent Engine after Phase 8.
 * Skills/memory/subagents remain deferred.
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
      description: "List entries in a workspace directory.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path." },
        },
      },
    },
    {
      name: "read_file",
      description: "Read a workspace file or line range.",
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
      description: "Search workspace text.",
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
        "Apply structured oldText/newText patches inside a recoverable transaction.",
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
