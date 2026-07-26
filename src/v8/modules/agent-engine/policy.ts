import type { ModelToolDefinition } from "../model-gateway";

/**
 * Phase 7 is read-only. Mutation routes suspend/fail closed rather than
 * inventing patch/approval behavior (Phase 8).
 */
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
