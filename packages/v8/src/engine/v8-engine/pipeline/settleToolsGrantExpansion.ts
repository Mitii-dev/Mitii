import * as path from "node:path";

import type { ModelToolCall } from "../../../modules/model-gateway";

import { extractOutOfScopePaths } from "../actions/extractEstablishedFact";
import { extractMutationTargetPaths } from "../actions/assertBatchReads";
import { extractFileReadPaths } from "../actions/extractFileReadPaths";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { ToolResult } from "../../tool-runtime";

/** Collect in-workspace OOS paths, external roots, and failed calls to replay. */
export function collectGrantExpansionFromBatch(params: {
  toolCalls: readonly ModelToolCall[];
  toolCache: ToolCallCache;
  warnings: readonly string[];
  workspaceRoot: string;
}): {
  extraPaths: string[];
  externalRoots: string[];
  pendingToolCalls: Array<{
    toolName: string;
    callId: string;
    arguments: unknown;
  }>;
} {
  const extraPaths = new Set<string>(extractOutOfScopePaths(params.warnings));
  const externalRoots = new Set<string>();
  const pendingToolCalls: Array<{
    toolName: string;
    callId: string;
    arguments: unknown;
  }> = [];

  for (const toolCall of params.toolCalls) {
    const cached = params.toolCache.get(toolCall.id);
    if (
      !cached ||
      (cached.reasonCode !== "path_out_of_scope" &&
        cached.reasonCode !== "path_escape")
    ) {
      continue;
    }
    let argumentsValue: unknown = {};
    try {
      argumentsValue =
        toolCall.arguments.trim().length === 0
          ? {}
          : JSON.parse(toolCall.arguments);
    } catch {
      argumentsValue = {};
    }
    pendingToolCalls.push({
      toolName: toolCall.name,
      callId: toolCall.id,
      arguments: argumentsValue,
    });

    if (cached.reasonCode === "path_out_of_scope") {
      for (const warning of cached.warnings) {
        for (const path of extractOutOfScopePaths([warning])) {
          extraPaths.add(path);
        }
      }
      const fromArgs = [
        ...(extractFileReadPaths(toolCall.name, argumentsValue) ?? []),
        ...extractMutationTargetPaths(toolCall.name, argumentsValue),
      ];
      for (const path of fromArgs) {
        const normalized = normalizeWorkspaceRelative(path);
        if (normalized && !looksOutsideWorkspace(normalized)) {
          extraPaths.add(normalized);
        }
      }
      continue;
    }

    // path_escape → ask for absolute external root
    for (const warning of cached.warnings) {
      for (const escaped of extractPathEscapeRequests([warning])) {
        externalRoots.add(
          resolveExternalRootRequest(escaped, params.workspaceRoot),
        );
      }
    }
    const fromArgs = [
      ...(extractFileReadPaths(toolCall.name, argumentsValue) ?? []),
      ...extractMutationTargetPaths(toolCall.name, argumentsValue),
    ];
    for (const path of fromArgs) {
      if (looksOutsideWorkspace(path)) {
        externalRoots.add(
          resolveExternalRootRequest(path, params.workspaceRoot),
        );
      }
    }
  }

  return {
    extraPaths: [...extraPaths].slice(0, 50),
    externalRoots: [...externalRoots].slice(0, 20),
    pendingToolCalls: pendingToolCalls.slice(0, 10),
  };
}

function normalizeWorkspaceRelative(pathValue: string): string {
  return pathValue
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function looksOutsideWorkspace(pathValue: string): boolean {
  const normalized = pathValue.trim().replace(/\\/g, "/");
  return (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith("../") ||
    normalized === ".."
  );
}

function extractPathEscapeRequests(warnings: readonly string[]): string[] {
  const paths: string[] = [];
  const patterns = [
    /Path escapes the workspace: "([^"]+)"/g,
    /Expected a relative path, received absolute: "([^"]+)"/g,
    /Resolved path escapes workspace: "([^"]+)"/g,
  ];
  for (const warning of warnings) {
    for (const pattern of patterns) {
      for (const match of warning.matchAll(pattern)) {
        const value = match[1]?.trim();
        if (value) paths.push(value);
      }
    }
  }
  return paths;
}

function resolveExternalRootRequest(
  requested: string,
  workspaceRoot: string,
): string {
  const normalized = requested.trim().replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return normalized;
  }
  return path.resolve(workspaceRoot, normalized);
}

/** Short failure text for tool-loop signatures. Successful results have none. */
export function toolResultError(result: ToolResult | undefined): string | undefined {
  if (!result || result.status === "succeeded") {
    return undefined;
  }
  const parts = [
    result.reasonCode,
    result.warnings.find((warning) => warning.length > 0),
    result.audit.outputPreview,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(": ") : undefined;
}
