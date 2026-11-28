/** Workspace file-edit tools that satisfy execute+write discipline. */
export const WORKSPACE_FILE_MUTATION_TOOL_IDS = [
  "apply_patch",
  "delete_file",
  "delete_directory",
  "move_file",
] as const;

/**
 * True when the grant still exposes at least one workspace file-edit tool.
 * When false (e.g. Database readwrite: apply_patch denied, MCP DB writes only),
 * execute+write must not chase apply_patch recoveries.
 */
export function grantAllowsWorkspaceFileMutation(
  allowedTools: readonly string[] | undefined,
): boolean {
  if (allowedTools === undefined) {
    return true;
  }
  const allowed = new Set(allowedTools);
  return WORKSPACE_FILE_MUTATION_TOOL_IDS.some((id) => allowed.has(id));
}

