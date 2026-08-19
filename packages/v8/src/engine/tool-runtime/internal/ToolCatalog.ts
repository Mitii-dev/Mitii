import { z } from "zod";

import {
  CHANGE_IMPACT_EDGE_TYPES,
  CHANGE_IMPACT_POLICY,
  CHANGE_IMPACT_STATUSES,
} from "../../../modules/change-impact";
import type { ToolCapabilityDescriptor, ToolEffect } from "../contracts";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TOOL_TIMEOUT_MS,
} from "../defaults";

export const listDirectoryInputSchema = z
  .object({
    path: z.string().min(1).default("."),
  })
  .strict();

export const listDirectoryOutputSchema = z
  .object({
    path: z.string(),
    entries: z.array(
      z.object({
        name: z.string(),
        kind: z.enum(["file", "directory", "symlink", "other"]),
      }),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const readFileInputSchema = z
  .object({
    path: z.string().min(1),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.startLine !== undefined &&
      value.endLine !== undefined &&
      value.endLine < value.startLine
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endLine must be >= startLine",
        path: ["endLine"],
      });
    }
  });

export const readFileOutputSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    truncated: z.boolean(),
  })
  .strict();

export const searchFilesInputSchema = z
  .object({
    query: z.string().min(1),
    path: z.string().min(1).default("."),
    maxMatches: z.number().int().positive().max(200).optional(),
    caseSensitive: z.boolean().optional(),
    mode: z.enum(["auto", "literal", "regex"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode !== "regex") {
      return;
    }
    try {
      new RegExp(value.query, value.caseSensitive ? "" : "i");
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          error instanceof Error
            ? error.message
            : "Invalid regular expression.",
        path: ["query"],
      });
    }
  });

export const searchFilesOutputSchema = z
  .object({
    query: z.string(),
    mode: z.enum(["literal", "regex"]),
    matches: z.array(
      z.object({
        path: z.string(),
        line: z.number().int().positive(),
        text: z.string(),
      }),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const readDiagnosticsInputSchema = z
  .object({
    paths: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const readDiagnosticsOutputSchema = z
  .object({
    diagnostics: z.array(
      z.object({
        path: z.string(),
        severity: z.enum(["error", "warning", "info", "hint"]),
        message: z.string(),
        startLine: z.number().int().positive().optional(),
        startColumn: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        endColumn: z.number().int().positive().optional(),
        source: z.string().optional(),
        code: z.string().optional(),
      }),
    ),
  })
  .strict();

export const gotoDefinitionInputSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
    symbolName: z.string().min(1).optional(),
  })
  .strict();

export const findReferencesInputSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
    symbolName: z.string().min(1).optional(),
    includeDeclaration: z.boolean().optional(),
  })
  .strict();

export const codeNavigationLocationOutputSchema = z
  .object({
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
    symbolName: z.string().optional(),
    symbolKind: z.string().optional(),
    preview: z.string().optional(),
  })
  .strict();

export const gotoDefinitionOutputSchema = z
  .object({
    path: z.string(),
    locations: z.array(codeNavigationLocationOutputSchema),
    provider: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export const findReferencesOutputSchema = gotoDefinitionOutputSchema;

export const analyzeChangeImpactInputSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    symbolName: z.string().min(1).optional(),
    maximumHops: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumHopsCap)
      .optional(),
    maximumAffectedNodes: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumAffectedNodesCap)
      .optional(),
    includePackages: z.boolean().optional(),
    edgeTypes: z
      .array(z.enum(CHANGE_IMPACT_EDGE_TYPES))
      .min(1)
      .max(CHANGE_IMPACT_EDGE_TYPES.length)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.column !== undefined && value.line === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "line is required when column is set",
        path: ["line"],
      });
    }
  });

export const analyzeChangeImpactOutputSchema = z
  .object({
    path: z.string(),
    provider: z.literal("repo_graph"),
    status: z.enum(CHANGE_IMPACT_STATUSES),
    resolvedSeeds: z.array(
      z
        .object({
          kind: z.enum(["file", "symbol", "project"]),
          path: z.string().optional(),
          symbolName: z.string().optional(),
          symbolKind: z.string().optional(),
        })
        .strict(),
    ),
    affected: z.array(
      z
        .object({
          path: z.string(),
          symbolName: z.string().optional(),
          symbolKind: z.string().optional(),
          hop: z.number().int().positive(),
          viaEdgeType: z.enum(CHANGE_IMPACT_EDGE_TYPES),
          score: z.number(),
          evidence: z.array(z.string()).optional(),
        })
        .strict(),
    ),
    affectedFiles: z.array(
      z
        .object({
          path: z.string(),
          hop: z.number().int().positive(),
          score: z.number(),
          affectedNodeCount: z.number().int().positive(),
          reason: z.string(),
        })
        .strict(),
    ),
    packagesAffected: z.array(
      z
        .object({
          name: z.string(),
          projectId: z.string(),
          hop: z.number().int().nonnegative(),
          viaEdgeType: z.enum(CHANGE_IMPACT_EDGE_TYPES).optional(),
        })
        .strict(),
    ),
    truncated: z.boolean(),
    warnings: z.array(
      z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .strict(),
    ),
    reasonCodes: z.array(z.string()).min(1),
    graphRevision: z.string().optional(),
    codeIndexChangeToken: z.string().optional(),
  })
  .strict();

export const readGitStatusInputSchema = z
  .object({
    includeDiff: z.boolean().optional(),
    paths: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const readGitStatusOutputSchema = z
  .object({
    branch: z.string().optional(),
    staged: z.array(z.string()),
    unstaged: z.array(z.string()),
    untracked: z.array(z.string()),
    diff: z.string().optional(),
    truncated: z.boolean(),
  })
  .strict();

export const runReadonlyCommandInputSchema = z
  .object({
    argv: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const runReadonlyCommandOutputSchema = z
  .object({
    argv: z.array(z.string()),
    exitCode: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export const fetchUrlInputSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

export const fetchUrlOutputSchema = z
  .object({
    url: z.string(),
    status: z.number().int(),
    body: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export const webSearchInputSchema = z
  .object({
    query: z.string().min(1).max(500),
    maxResults: z.number().int().positive().max(10).optional(),
  })
  .strict();

export const webSearchOutputSchema = z
  .object({
    query: z.string(),
    results: z.array(
      z
        .object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
          publishedAt: z.string().optional(),
          source: z.string().optional(),
        })
        .strict(),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const readPackageScriptsInputSchema = z
  .object({
    path: z.string().min(1).default("package.json"),
  })
  .strict();

export const readPackageScriptsOutputSchema = z
  .object({
    path: z.string(),
    scripts: z.record(z.string()),
    packageManager: z.string().optional(),
    truncated: z.boolean(),
  })
  .strict();

export const structuredPatchSchema = z
  .object({
    path: z.string().min(1, "path is required"),
    oldText: z.string({ required_error: "oldText is required" }),
    newText: z.string({ required_error: "newText is required" }),
    expectedHash: z.string().min(1).optional(),
    replaceAll: z.boolean().optional(),
  })
  .strict();

export const applyPatchInputSchema = z
  .object({
    patches: z.array(structuredPatchSchema).min(1).max(12),
  })
  .strict();

export const applyPatchOutputSchema = z
  .object({
    checkpointId: z.string().min(1),
    changedFiles: z.array(z.string().min(1)),
    applied: z.array(
      z
        .object({
          path: z.string(),
          created: z.boolean(),
          bytesWritten: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    /** Diagnostics newly introduced after the patch (host DiagnosticsPort). */
    newDiagnostics: z
      .array(
        z
          .object({
            path: z.string().min(1),
            severity: z.enum(["error", "warning", "info", "hint"]),
            message: z.string().min(1),
            startLine: z.number().int().positive().optional(),
            startColumn: z.number().int().positive().optional(),
            endLine: z.number().int().positive().optional(),
            endColumn: z.number().int().positive().optional(),
            source: z.string().min(1).optional(),
            code: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const deleteFileInputSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

export const deleteFileOutputSchema = z
  .object({
    checkpointId: z.string().min(1),
    changedFiles: z.array(z.string().min(1)),
    path: z.string().min(1),
  })
  .strict();

export const deleteDirectoryInputSchema = z
  .object({
    path: z.string().min(1),
    recursive: z.boolean().optional(),
  })
  .strict();

export const deleteDirectoryOutputSchema = z
  .object({
    checkpointId: z.string().min(1),
    changedFiles: z.array(z.string().min(1)),
    path: z.string().min(1),
    recursive: z.boolean(),
  })
  .strict();

export const moveFileInputSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

export const moveFileOutputSchema = z
  .object({
    checkpointId: z.string().min(1),
    changedFiles: z.array(z.string().min(1)),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

export const runCommandInputSchema = z
  .object({
    argv: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const runCommandOutputSchema = z
  .object({
    argv: z.array(z.string()),
    exitCode: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export const globFilesInputSchema = z
  .object({
    pattern: z.string().min(1).max(512),
    path: z.string().min(1).default("."),
    maxResults: z.number().int().positive().max(500).optional(),
  })
  .strict();

export const globFilesOutputSchema = z
  .object({
    pattern: z.string(),
    path: z.string(),
    matches: z.array(
      z.object({
        path: z.string(),
        kind: z.enum(["file", "directory", "symlink", "other"]),
      }),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const readManyFilesInputSchema = z
  .object({
    paths: z.array(z.string().min(1)).min(1).max(20),
    maxBytesPerFile: z.number().int().positive().max(128_000).optional(),
  })
  .strict();

export const readManyFilesOutputSchema = z
  .object({
    files: z.array(
      z
        .object({
          path: z.string(),
          content: z.string().optional(),
          truncated: z.boolean(),
          error: z.string().optional(),
        })
        .strict(),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const fileMetadataInputSchema = z
  .object({
    path: z.string().min(1),
    includeHash: z.boolean().optional(),
  })
  .strict();

export const fileMetadataOutputSchema = z
  .object({
    path: z.string(),
    kind: z.enum(["file", "directory", "symlink", "other"]),
    sizeBytes: z.number().int().nonnegative(),
    mtimeMs: z.number().optional(),
    isSymlink: z.boolean(),
    hash: z
      .object({
        algorithm: z.literal("sha256"),
        hex: z.string(),
        truncated: z.boolean(),
      })
      .optional(),
  })
  .strict();

export interface ToolDefinition {
  name: string;
  effects: readonly ToolEffect[];
  backend: ToolCapabilityDescriptor["backend"];
  status: ToolCapabilityDescriptor["status"];
  timeoutMs: number;
  maxOutputBytes: number;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  /**
   * JSON Schema exposed to models. Required for available tools that should
   * appear in prompts. Kept next to Zod so Agent Engine can generate
   * ModelToolDefinition from Tool Runtime without a second hand-written catalog.
   */
  modelInputSchema?: Readonly<Record<string, unknown>>;
  /** When true, tool is catalogued for negotiation but not implemented. */
  executeSupported: boolean;
}

/** Shared helper for building catalog definitions used at registration time. */
export function defineTool(
  def: Omit<ToolDefinition, "timeoutMs" | "maxOutputBytes" | "backend" | "status"> &
    Partial<
      Pick<ToolDefinition, "timeoutMs" | "maxOutputBytes" | "backend" | "status">
    >,
): ToolDefinition {
  return {
    backend: def.backend ?? "local",
    status: def.status ?? "available",
    timeoutMs: def.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
    maxOutputBytes: def.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    executeSupported: def.executeSupported,
    name: def.name,
    effects: def.effects,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    modelInputSchema: def.modelInputSchema,
  };
}
