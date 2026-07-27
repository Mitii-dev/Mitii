import { ToolRegistry } from "../../internal/ToolRegistry";
import type { RegisteredTool } from "../../internal/ToolRegistry";
import { listModelToolDefinitions } from "../../internal/modelToolDefinitions";
import type { RuntimeModelToolDefinition } from "../../internal/modelToolDefinitions";

import { applyPatchTool } from "./applyPatchTool";
import { fetchDocsTool } from "./fetchDocsTool";
import { fetchUrlTool } from "./fetchUrlTool";
import { fileMetadataTool } from "./fileMetadataTool";
import { globFilesTool } from "./globFilesTool";
import { listDirectoryTool } from "./listDirectoryTool";
import { readDiagnosticsTool } from "./readDiagnosticsTool";
import { readFileTool } from "./readFileTool";
import { readGitStatusTool } from "./readGitStatusTool";
import { readManyFilesTool } from "./readManyFilesTool";
import { readPackageScriptsTool } from "./readPackageScriptsTool";
import { runCommandTool } from "./runCommandTool";
import { runReadonlyCommandTool } from "./runReadonlyCommandTool";
import { searchFilesTool } from "./searchFilesTool";
import { webSearchTool } from "./webSearchTool";

/**
 * Built-in tools. Add a new tool by:
 * 1. Creating `actions/handlers/<name>Tool.ts` with definition + execute
 * 2. Appending it to this list
 *
 * Do not edit ToolRuntimePipeline for new tools.
 */
export const BUILTIN_TOOLS: readonly RegisteredTool[] = [
  listDirectoryTool,
  readFileTool,
  readManyFilesTool,
  globFilesTool,
  fileMetadataTool,
  searchFilesTool,
  readDiagnosticsTool,
  readGitStatusTool,
  runReadonlyCommandTool,
  readPackageScriptsTool,
  applyPatchTool,
  runCommandTool,
  fetchUrlTool,
  fetchDocsTool,
  webSearchTool,
];

export function createBuiltinToolRegistry(): ToolRegistry {
  return new ToolRegistry().registerAll(BUILTIN_TOOLS);
}

/** Model-facing schemas derived from registered Tool Runtime definitions. */
export function listBuiltinModelToolDefinitions(): RuntimeModelToolDefinition[] {
  return listModelToolDefinitions(BUILTIN_TOOLS);
}

export function listBuiltinReadOnlyModelToolDefinitions(): RuntimeModelToolDefinition[] {
  return listModelToolDefinitions(BUILTIN_TOOLS, {
    allowedEffects: ["workspace_read", "process_execute", "network_access"],
  }).filter(
    (tool) =>
      tool.name !== "apply_patch" &&
      tool.name !== "run_command",
  );
}

export function listBuiltinMutationModelToolDefinitions(): RuntimeModelToolDefinition[] {
  return listModelToolDefinitions(BUILTIN_TOOLS, {
    requireEffect: "workspace_write",
  });
}

export {
  listDirectoryTool,
  readFileTool,
  readManyFilesTool,
  globFilesTool,
  fileMetadataTool,
  searchFilesTool,
  readDiagnosticsTool,
  readGitStatusTool,
  runReadonlyCommandTool,
  readPackageScriptsTool,
  applyPatchTool,
  runCommandTool,
  fetchUrlTool,
  fetchDocsTool,
  webSearchTool,
};
