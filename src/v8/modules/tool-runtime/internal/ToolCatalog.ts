import { z } from "zod";

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
  })
  .strict();

export const searchFilesOutputSchema = z
  .object({
    query: z.string(),
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
  };
}
