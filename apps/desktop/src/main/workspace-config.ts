/**
 * Workspace CLI/ACP compatibility files under `<workspace>/.mitii/`.
 *
 * Full Desktop settings + profiles + connected repos live in
 * `<userData>/mitii-desktop.sqlite` (see desktop-store.ts).
 * These JSON files remain so CLI/ACP tools can still read provider/MCP config.
 *
 * MCP install list source of truth: `.mitii/mcp.json` (written by the MCP
 * manager via `writeMcpSettingsToDisk`). SQLite `settings.mcp` is a mirror
 * and must not wipe a non-empty on-disk install on boot / settings save.
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

export type McpCompatFile = {
  enabled: boolean;
  servers: unknown[];
};

/** Read `.mitii/mcp.json` when present. */
export function readMcpCompatFromDisk(
  workspaceRoot: string,
): McpCompatFile | null {
  const mcpPath = mcpSettingsPath(workspaceRoot);
  if (!existsSync(mcpPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      enabled?: boolean;
      servers?: unknown[];
    };
    return {
      enabled: Boolean(raw.enabled),
      servers: Array.isArray(raw.servers) ? raw.servers : [],
    };
  } catch {
    return null;
  }
}

/**
 * When SQLite/settings still has the empty default MCP list, adopt the
 * on-disk install (and connection env) so boot/save do not treat MCP as
 * uninstalled.
 */
export function reconcileMcpSettingsFromDisk(
  workspaceRoot: string,
  settings: DesktopSettings,
): DesktopSettings {
  const settingsServers = Array.isArray(settings.mcp?.servers)
    ? settings.mcp.servers
    : [];
  if (settingsServers.length > 0) {
    return settings;
  }
  const disk = readMcpCompatFromDisk(workspaceRoot);
  if (!disk || disk.servers.length === 0) {
    return settings;
  }
  return mergeDesktopSettings(
    {
      mcp: {
        enabled: disk.enabled,
        servers: disk.servers,
      },
    },
    settings,
  );
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

  const diskMcp = readMcpCompatFromDisk(workspaceRoot);
  if (diskMcp) {
    settings = mergeDesktopSettings(
      {
        mcp: {
          enabled: diskMcp.enabled,
          servers: diskMcp.servers,
        },
      },
      settings,
    );
  }

  return settings;
}

export type WriteWorkspaceCompatOptions = {
  /**
   * When true, overwrite `.mitii/mcp.json` even if settings.mcp.servers is
   * empty (used by clear-workspace-cache). Default: preserve a non-empty
   * on-disk MCP install when settings still have the empty default.
   */
  replaceMcp?: boolean;
};

/** Write CLI/ACP-compatible config.json + mcp.json. */
export function writeWorkspaceCompatFiles(
  workspaceRoot: string,
  settings: DesktopSettings,
  options?: WriteWorkspaceCompatOptions,
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
  const fromSettings: McpCompatFile = {
    enabled: Boolean(settings.mcp.enabled),
    servers: Array.isArray(settings.mcp.servers) ? settings.mcp.servers : [],
  };
  const replaceMcp = options?.replaceMcp === true;
  const disk = readMcpCompatFromDisk(workspaceRoot);

  let toWrite: McpCompatFile = fromSettings;
  if (!replaceMcp && fromSettings.servers.length === 0) {
    if (disk && disk.servers.length > 0) {
      // Keep MCP manager installs + connection env across boot / settings save.
      toWrite = disk;
    } else if (disk) {
      // Disk already empty / disabled — leave file as-is.
      toWrite = disk;
    }
  }

  writeFileSync(
    mcpPath,
    `${JSON.stringify(
      {
        enabled: Boolean(toWrite.enabled),
        servers: Array.isArray(toWrite.servers) ? toWrite.servers : [],
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
