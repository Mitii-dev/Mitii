/**
 * VS Code thin wrapper — shared manager from `@mitii/mcp` with vscode client name.
 */
export {
  McpManager,
  mcpToolName,
  type McpManagerSnapshot,
  type McpServerRuntimeStatus,
  type McpServerStatus,
} from '@mitii/mcp';

import { getSharedMcpManager as getShared } from '@mitii/mcp';

export function getSharedMcpManager() {
  return getShared({ clientInfoName: 'mitii-vscode' });
}
