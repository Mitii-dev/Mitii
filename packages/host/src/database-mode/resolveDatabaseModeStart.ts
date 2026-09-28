import { getBuiltinModeProfile } from '../modes/builtinModeProfiles.js';
import { compileModeProfile } from '../modes/compileModeProfile.js';

import { buildDatabaseConnectGuidance } from './connectGuidance.js';
import {
  DATABASE_MODE_SLUG,
  NL_SQL_ANALYST_SKILL_ID,
  type DatabaseDbAccess,
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

function normalizeDbAccess(
  value: string | undefined | null,
): DatabaseDbAccess {
  const raw = (value ?? 'readonly').trim().toLowerCase();
  if (
    raw === 'readwrite' ||
    raw === 'read_write' ||
    raw === 'read-write' ||
    raw === 'rw' ||
    raw === 'write'
  ) {
    return 'readwrite';
  }
  return 'readonly';
}

/**
 * Compile MitiiStartInput overlay for UI mode "database".
 * readonly → Ask + nl-sql-analyst + MCP pins.
 * readwrite → Agent (write grant for DB MCP mutations) + same pins / skill.
 */
export function resolveDatabaseModeStart(
  options: ResolveDatabaseModeStartOptions,
): DatabaseModeStartResult {
  const dbAccess = normalizeDbAccess(options.dbAccess);
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

  const accessGuidance =
    dbAccess === 'readwrite'
      ? [
          'DB access: read & write.',
          'You may use write MCP tools (insert/update/delete/create_index/execute_write) after confirming intent.',
          'Still refuse DDL unless the user explicitly asks for schema changes via create_index.',
          'Never apply_patch or edit application code in Database mode.',
          'Show the mutation summary and affected count.',
        ].join(' ')
      : [
          'DB access: read-only.',
          'Prefer discovery + SELECT / find / aggregate / count.',
          'Refuse INSERT/UPDATE/DELETE and schema mutations.',
        ].join(' ');

  const projectRules = [
    ...compiled.projectRules,
    {
      id: 'database-mode-connection',
      title: 'Database connection status',
      content: `Connection status: ${connectionStatus}.\n${connectGuidance}`,
      priority: 275,
    },
    {
      id: 'database-mode-access',
      title: 'Database access tier',
      content: accessGuidance,
      priority: 276,
    },
  ];

  const agentMode = dbAccess === 'readwrite' ? 'agent' : 'ask';

  const userSafetyRules =
    dbAccess === 'readwrite'
      ? {
          ...compiled.userSafetyRules,
          // Keep write grant after denying apply_patch so MCP insert/update/
          // delete (requiresWorkspaceWrite) stay visible to the model.
          retainWriteEffect: true,
        }
      : compiled.userSafetyRules;

  return {
    connectionStatus,
    dbAccess,
    installedDatabaseServers: installed,
    connectGuidance,
    startFields: {
      mode: agentMode,
      dbAccess,
      requiredSkillIds: [NL_SQL_ANALYST_SKILL_ID],
      requiredMcpServerIds: pinned,
      projectRules,
      userSafetyRules,
      ...(dbAccess === 'readwrite'
        ? { approvalMode: 'every_mutation' as const }
        : {}),
    },
  };
}

/** True when a UI / CLI mode token selects database mode. */
export function isDatabaseUiMode(mode: string | undefined | null): boolean {
  return (mode ?? '').trim().toLowerCase() === DATABASE_MODE_SLUG;
}

/**
 * Map UI mode to V8 AgentMode when db access is not provided.
 * Database defaults to ask; callers with readwrite should use
 * resolveDatabaseModeStart().startFields.mode instead.
 */
export function mapUiModeToAgentMode(
  uiMode: string | undefined | null,
): 'ask' | 'plan' | 'agent' {
  const m = (uiMode ?? 'ask').trim().toLowerCase();
  if (m === DATABASE_MODE_SLUG || m === 'review') return 'ask';
  if (m === 'plan' || m === 'agent') return m;
  return 'ask';
}
