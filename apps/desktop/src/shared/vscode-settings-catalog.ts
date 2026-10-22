/**
 * Flat mitii.* settings catalog mirrored from apps/vscode package.json.
 * Data lives in vscode-settings-catalog.json to stay under the line cap.
 */

import catalogJson from './vscode-settings-catalog.json' with { type: 'json' };

export type SettingsCatalogEntry = {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

export const SETTINGS_CATALOG: Record<string, SettingsCatalogEntry> =
  catalogJson as Record<string, SettingsCatalogEntry>;
