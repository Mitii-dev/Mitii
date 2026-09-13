import { ToolRegistry } from "../../internal/ToolRegistry";
import type { RegisteredTool } from "../../internal/ToolRegistry";
import { listModelToolDefinitions } from "../../internal/modelToolDefinitions";
import type { RuntimeModelToolDefinition } from "../../internal/modelToolDefinitions";

import { analyzeChangeImpactTool } from "./analyzeChangeImpactTool";
import { applyPatchTool } from "./applyPatchTool";
import { deleteDirectoryTool } from "./deleteDirectoryTool";
import { deleteFileTool } from "./deleteFileTool";
import { fetchDocsTool } from "./fetchDocsTool";
import { fetchUrlTool } from "./fetchUrlTool";
import { fileMetadataTool } from "./fileMetadataTool";
import { findReferencesTool } from "./findReferencesTool";
import { createGithubIssueTool, createPullRequestTool } from "./githubMutationTools";
import { globFilesTool } from "./globFilesTool";
import { gotoDefinitionTool } from "./gotoDefinitionTool";
import { listDirectoryTool } from "./listDirectoryTool";
import { directoryTreeTool } from "./directoryTreeTool";
import { moveFileTool } from "./moveFileTool";
import { readDiagnosticsTool } from "./readDiagnosticsTool";
import { readFileTool } from "./readFileTool";
import { readGitStatusTool } from "./readGitStatusTool";
import { readManyFilesTool } from "./readManyFilesTool";
import { readPackageScriptsTool } from "./readPackageScriptsTool";
import { runCommandTool } from "./runCommandTool";
import { runReadonlyCommandTool } from "./runReadonlyCommandTool";
import { searchFilesTool } from "./searchFilesTool";
import { sequentialThinkingTool } from "./sequentialThinkingTool";
import { convertTimeTool, getCurrentTimeTool } from "./timeTools";
import {
  readGitBranchesTool,
  readGitLogTool,
  readGitShowTool,
} from "./gitReadTools";
import {
  memoryGraphOpenTool,
  memoryGraphSearchTool,
  memoryGraphUpdateTool,
} from "./memoryGraphTools";
import { webSearchTool } from "./webSearchTool";
import { describeToolTool } from "./describeToolTool";
import { setBuiltinModelToolLookup } from "./builtinModelLookup";

const BUILTIN_TOOLS_BASE: readonly RegisteredTool[] = [
  listDirectoryTool,
  directoryTreeTool,
  readFileTool,
  readManyFilesTool,
  globFilesTool,
  fileMetadataTool,
  searchFilesTool,
  readDiagnosticsTool,
  readGitStatusTool,
  readGitLogTool,
  readGitShowTool,
  readGitBranchesTool,
  gotoDefinitionTool,
  findReferencesTool,
  analyzeChangeImpactTool,
  runReadonlyCommandTool,
  readPackageScriptsTool,
  sequentialThinkingTool,
  getCurrentTimeTool,
  convertTimeTool,
  memoryGraphSearchTool,
  memoryGraphOpenTool,
  applyPatchTool,
  deleteFileTool,
  deleteDirectoryTool,
  moveFileTool,
  memoryGraphUpdateTool,
  runCommandTool,
  createGithubIssueTool,
  createPullRequestTool,
  fetchUrlTool,
  fetchDocsTool,
  webSearchTool,
];

setBuiltinModelToolLookup(listModelToolDefinitions(BUILTIN_TOOLS_BASE));

/**
 * Built-in tools. Add a new tool by:
 * 1. Creating `actions/handlers/<name>Tool.ts` with definition + execute
 * 2. Appending it to BUILTIN_TOOLS_BASE (before describe_tool)
 *
 * Do not edit ToolRuntimePipeline for new tools.
 */
export const BUILTIN_TOOLS: readonly RegisteredTool[] = [
  ...BUILTIN_TOOLS_BASE,
  describeToolTool,
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
      tool.name !== "delete_file" &&
      tool.name !== "delete_directory" &&
      tool.name !== "move_file" &&
      tool.name !== "memory_graph_update" &&
      tool.name !== "run_command" &&
      tool.name !== "create_github_issue" &&
      tool.name !== "create_pull_request",
  );
}

export function listBuiltinMutationModelToolDefinitions(): RuntimeModelToolDefinition[] {
  return listModelToolDefinitions(BUILTIN_TOOLS, {
    requireEffect: "workspace_write",
  });
}

export {
  listDirectoryTool,
  directoryTreeTool,
  readFileTool,
  readManyFilesTool,
  globFilesTool,
  fileMetadataTool,
  searchFilesTool,
  readDiagnosticsTool,
  readGitStatusTool,
  readGitLogTool,
  readGitShowTool,
  readGitBranchesTool,
  gotoDefinitionTool,
  findReferencesTool,
  analyzeChangeImpactTool,
  runReadonlyCommandTool,
  readPackageScriptsTool,
  sequentialThinkingTool,
  getCurrentTimeTool,
  convertTimeTool,
  memoryGraphSearchTool,
  memoryGraphOpenTool,
  memoryGraphUpdateTool,
  applyPatchTool,
  deleteFileTool,
  deleteDirectoryTool,
  moveFileTool,
  runCommandTool,
  createGithubIssueTool,
  createPullRequestTool,
  fetchUrlTool,
  fetchDocsTool,
  webSearchTool,
  describeToolTool,
};
