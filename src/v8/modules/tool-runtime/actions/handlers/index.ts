import { ToolRegistry } from "../../internal/ToolRegistry";
import type { RegisteredTool } from "../../internal/ToolRegistry";

import { fetchUrlTool } from "./fetchUrlTool";
import { listDirectoryTool } from "./listDirectoryTool";
import { readDiagnosticsTool } from "./readDiagnosticsTool";
import { readFileTool } from "./readFileTool";
import { readGitStatusTool } from "./readGitStatusTool";
import { runReadonlyCommandTool } from "./runReadonlyCommandTool";
import { searchFilesTool } from "./searchFilesTool";

/**
 * Built-in Phase 4 tools. Add a new tool by:
 * 1. Creating `actions/handlers/<name>Tool.ts` with definition + execute
 * 2. Appending it to this list
 *
 * Do not edit ToolRuntimePipeline for new tools.
 */
export const BUILTIN_TOOLS: readonly RegisteredTool[] = [
  listDirectoryTool,
  readFileTool,
  searchFilesTool,
  readDiagnosticsTool,
  readGitStatusTool,
  runReadonlyCommandTool,
  fetchUrlTool,
];

export function createBuiltinToolRegistry(): ToolRegistry {
  return new ToolRegistry().registerAll(BUILTIN_TOOLS);
}

export {
  listDirectoryTool,
  readFileTool,
  searchFilesTool,
  readDiagnosticsTool,
  readGitStatusTool,
  runReadonlyCommandTool,
  fetchUrlTool,
};
