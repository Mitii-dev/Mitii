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

/**
 * Prefer explicitly configured VS Code settings; otherwise read `.mitii/mcp.json`.
 * `cfg.get('mcp')` alone always returns the package.json default
 * `{ enabled: false, servers: [] }`, which previously hid disk config.
 */
export function readMcpSettings(
  vs: typeof vscode,
  workspaceRoot: string | undefined,
): McpSettings {
  const cfg = vs.workspace.getConfiguration('mitii');
  const inspected = cfg.inspect<McpSettings>('mcp');
  const fromSettings =
    inspected?.workspaceFolderValue ??
    inspected?.workspaceValue ??
    inspected?.globalValue;
  if (fromSettings && typeof fromSettings === 'object') {
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
