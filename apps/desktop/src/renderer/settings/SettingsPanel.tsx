/**
 * Desktop Settings — full VS Code Mitii parity (8 tabs).
 * Persists via Save → mitii-desktop.sqlite (global + per-workspace) + config.json.
 * MCP install list / connection env stay in `.mitii/mcp.json` (MCP manager);
 * Save will not wipe a non-empty MCP install with empty settings defaults.
 */

import { SettingsView } from './SettingsView.js';
import type { SettingsPanelProps } from './types.js';
import { useSettingsPanelModel } from './useSettingsPanelModel.js';

export type { FeatureTabId } from './types.js';

export function SettingsPanel(props: SettingsPanelProps) {
  const model = useSettingsPanelModel(props);
  return <SettingsView m={model} />;
}
