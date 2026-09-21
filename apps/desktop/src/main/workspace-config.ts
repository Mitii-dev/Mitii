/**
 * Workspace CLI/ACP compatibility files under `<workspace>/.mitii/`.
 *
 * Full Desktop settings + profiles + connected repos live in
 * `<userData>/mitii-desktop.sqlite` (see desktop-store.ts).
 * These JSON files remain so CLI/ACP tools can still read provider/MCP config.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  mergeDesktopSettings,
  mitiiConfigFileToSettings,
  settingsToMitiiConfigFile,
  type DesktopSettings,
} from '../shared/settings.js';
import { workspaceIdFromRoot } from '../engine/workspace-id.js';

export function workspaceConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'config.json');
}

export function mcpSettingsPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'mcp.json');
}

/** @deprecated Prefer SQLite desktop store; kept for one-shot JSON migration. */
export function desktopSettingsPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'desktop-settings.json');
}

/**
 * Load legacy on-disk settings (desktop-settings.json + config.json + mcp.json).
 * Used when SQLite has no row yet for this workspace.
 */
export function loadWorkspaceSettings(
  workspaceRoot: string,
  overlay?: Partial<DesktopSettings> | DesktopSettings,
): DesktopSettings {
  let settings = mergeDesktopSettings(overlay);

  const desktopPath = desktopSettingsPath(workspaceRoot);
  if (existsSync(desktopPath)) {
    try {
      const raw = JSON.parse(readFileSync(desktopPath, 'utf8')) as unknown;
      settings = mergeDesktopSettings(raw, settings);
    } catch {
      // keep overlay/defaults
    }
  }

  if (
    settings.provider.type === 'echo' ||
    settings.provider.preset === 'echo'
  ) {
    settings = mergeDesktopSettings(
      {
        provider: {
          type: 'openai-compatible',
          preset: 'ollama',
          baseUrl: 'http://127.0.0.1:11434/v1',
          model:
            settings.provider.model === 'echo' || !settings.provider.model
              ? ''
              : settings.provider.model,
          contextWindow: settings.provider.contextWindow,
          maximumOutputTokens: settings.provider.maximumOutputTokens,
        },
      },
      settings,
    );
  }

  const configPath = workspaceConfigPath(workspaceRoot);
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
        string,
        unknown
      >;
      settings = mitiiConfigFileToSettings(raw, settings);
    } catch {
      // keep
    }
  }

  const mcpPath = mcpSettingsPath(workspaceRoot);
  if (existsSync(mcpPath)) {
    try {
      const raw = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
        enabled?: boolean;
        servers?: unknown[];
      };
      settings = mergeDesktopSettings(
        {
          mcp: {
            enabled: Boolean(raw.enabled),
            servers: Array.isArray(raw.servers) ? raw.servers : [],
          },
        },
        settings,
      );
    } catch {
      // keep
    }
  }

  return settings;
}

/** Write CLI/ACP-compatible config.json + mcp.json (no secrets). */
export function writeWorkspaceCompatFiles(
  workspaceRoot: string,
  settings: DesktopSettings,
): { configPath: string; mcpPath: string } {
  const mitiiDir = join(workspaceRoot, '.mitii');
  mkdirSync(mitiiDir, { recursive: true });

  const configPath = workspaceConfigPath(workspaceRoot);
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      existing = {};
    }
  }
  const nextConfig: Record<string, unknown> = {
    ...existing,
    ...settingsToMitiiConfigFile(settings),
    workspaceId: workspaceIdFromRoot(workspaceRoot),
  };
  delete nextConfig.apiKey;
  delete nextConfig.api_key;
  delete nextConfig.token;
  delete nextConfig.secret;
  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');

  const mcpPath = mcpSettingsPath(workspaceRoot);
  writeFileSync(
    mcpPath,
    `${JSON.stringify(
      {
        enabled: Boolean(settings.mcp.enabled),
        servers: Array.isArray(settings.mcp.servers) ? settings.mcp.servers : [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return { configPath, mcpPath };
}

/** @deprecated Use SQLite store + writeWorkspaceCompatFiles. */
export function saveWorkspaceSettings(
  workspaceRoot: string,
  settings: DesktopSettings,
): { desktopSettingsPath: string; configPath: string; mcpPath: string } {
  const compat = writeWorkspaceCompatFiles(workspaceRoot, settings);
  return {
    desktopSettingsPath: desktopSettingsPath(workspaceRoot),
    ...compat,
  };
}
