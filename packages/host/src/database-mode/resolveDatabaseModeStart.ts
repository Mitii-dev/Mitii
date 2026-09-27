import { getBuiltinModeProfile } from '../modes/builtinModeProfiles.js';
import { compileModeProfile } from '../modes/compileModeProfile.js';

import { buildDatabaseConnectGuidance } from './connectGuidance.js';
import {
  DATABASE_MODE_SLUG,
  NL_SQL_ANALYST_SKILL_ID,
} from './constants.js';
import type {
  DatabaseModeConnectionStatus,
  DatabaseModeStartResult,
  ResolveDatabaseModeStartOptions,
} from './contracts.js';
import {
  isMcpMasterEnabled,
  listInstalledDatabaseMcpServers,
} from './listInstalledDatabaseMcpServers.js';

const DEFAULT_MAX_PINNED = 3;

/**
 * Compile MitiiStartInput overlay for UI mode "database".
 * Always maps to Ask + nl-sql-analyst + optional MCP pins.
 */
export function resolveDatabaseModeStart(
  options: ResolveDatabaseModeStartOptions,
): DatabaseModeStartResult {
  const maxPinned = Math.max(
    1,
    Math.min(5, options.maxPinnedServers ?? DEFAULT_MAX_PINNED),
  );
  const mcpOn = isMcpMasterEnabled(options.workspaceRoot);
  const installed = listInstalledDatabaseMcpServers(options.workspaceRoot);

  let connectionStatus: DatabaseModeConnectionStatus;
  if (!mcpOn) {
    connectionStatus = 'mcp_disabled';
  } else if (installed.length === 0) {
    connectionStatus = 'disconnected';
  } else {
    connectionStatus = 'connected';
  }

  const preferred = options.preferredServerIds?.map((id) => id.trim()).filter(Boolean);
  let pinned: string[] = [];
  if (connectionStatus === 'connected') {
    if (preferred && preferred.length > 0) {
      const allowed = new Set(installed.map((s) => s.id));
      pinned = preferred.filter((id) => allowed.has(id)).slice(0, maxPinned);
    }
    if (pinned.length === 0) {
      pinned = installed.map((s) => s.id).slice(0, maxPinned);
    }
  }

  const profile =
    getBuiltinModeProfile(DATABASE_MODE_SLUG) ??
    (() => {
      throw new Error(`Builtin mode profile missing: ${DATABASE_MODE_SLUG}`);
    })();
  const compiled = compileModeProfile(profile);
  const connectGuidance = buildDatabaseConnectGuidance(connectionStatus);

  const projectRules = [
    ...compiled.projectRules,
    {
      id: 'database-mode-connection',
      title: 'Database connection status',
      content: `Connection status: ${connectionStatus}.\n${connectGuidance}`,
      priority: 275,
    },
  ];

  return {
    connectionStatus,
    installedDatabaseServers: installed,
    connectGuidance,
    startFields: {
      mode: 'ask',
      requiredSkillIds: [NL_SQL_ANALYST_SKILL_ID],
      requiredMcpServerIds: pinned,
      projectRules,
      userSafetyRules: compiled.userSafetyRules,
    },
  };
}

/** True when a UI / CLI mode token selects database mode. */
export function isDatabaseUiMode(mode: string | undefined | null): boolean {
  return (mode ?? '').trim().toLowerCase() === DATABASE_MODE_SLUG;
}

/**
 * Map UI mode to V8 AgentMode. Database → ask; others pass through when valid.
 */
export function mapUiModeToAgentMode(
  uiMode: string | undefined | null,
): 'ask' | 'plan' | 'agent' {
  const m = (uiMode ?? 'ask').trim().toLowerCase();
  if (m === DATABASE_MODE_SLUG || m === 'review') return 'ask';
  if (m === 'plan' || m === 'agent') return m;
  return 'ask';
}
