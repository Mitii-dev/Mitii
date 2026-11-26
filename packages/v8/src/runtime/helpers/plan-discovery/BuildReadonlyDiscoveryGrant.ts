/**
 * Readonly ToolGrant surface for S3A.2 discovery pump (§6.2).
 * Never includes mutate / external side-effect tools.
 */

import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";

const DISCOVERY_TOOLS = [
  "read_file",
  "read_many_files",
  "list_directory",
  "directory_tree",
  "glob_files",
  "file_metadata",
  "search_files",
  "structural_search",
  "run_readonly_command",
] as const;

export function buildReadonlyDiscoveryGrant(input?: {
  readPaths?: readonly string[];
  allowedTools?: readonly string[];
}): GrantSurface {
  const tools = input?.allowedTools?.length
    ? [...input.allowedTools]
    : [...DISCOVERY_TOOLS];
  return {
    allowedTools: tools,
    maximumWorkspaceEffect: "read",
    readPaths: [...(input?.readPaths ?? ["."])],
    writePaths: [],
  };
}

export { DISCOVERY_TOOLS };
