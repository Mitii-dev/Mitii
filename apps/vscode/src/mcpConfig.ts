import type * as vscode from 'vscode';

import {
  defaultMcpSettings,
  parseMcp,
  readMcpSettingsFromDisk,
  readMcpStoreCatalog,
  writeMcpSettingsToDisk,
  activeMcpServers,
  type McpServerConfig,
  type McpSettings,
} from '@mitii/mcp';

export {
  defaultMcpSettings,
  parseMcp,
  readMcpStoreCatalog,
  activeMcpServers,
};

export function readMcpSettings(
  vs: typeof vscode,
  workspaceRoot: string | undefined,
): McpSettings {
  const cfg = vs.workspace.getConfiguration('mitii');
  const fromSettings = cfg.get<McpSettings>('mcp');
  if (
    fromSettings &&
    typeof fromSettings === 'object' &&
    (Array.isArray((fromSettings as McpSettings).servers) ||
      (fromSettings as { mcpServers?: unknown }).mcpServers ||
      typeof (fromSettings as McpSettings).enabled === 'boolean')
  ) {
    return parseMcp(fromSettings, workspaceRoot);
  }
  return readMcpSettingsFromDisk(workspaceRoot);
}

export async function writeMcpSettings(
  vs: typeof vscode,
  workspaceRoot: string | undefined,
  mcp: McpSettings,
): Promise<void> {
  const normalized = parseMcp(mcp, workspaceRoot);
  await vs.workspace
    .getConfiguration('mitii')
    .update('mcp', normalized, vs.ConfigurationTarget.Workspace);
  if (workspaceRoot) {
    writeMcpSettingsToDisk(workspaceRoot, normalized);
  }
}

export type { McpServerConfig, McpSettings };
