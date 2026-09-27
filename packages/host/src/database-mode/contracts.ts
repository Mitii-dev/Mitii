import type { UserSafetyRules } from '@mitii/v8';

import type { DatabaseMcpBuiltinId } from './constants.js';

export type DatabaseModeConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'mcp_disabled';

export interface DatabaseMcpServerRef {
  id: string;
  name: string;
  /** True when id is a Mitii catalog database builtin. */
  builtin: boolean;
  builtinId?: DatabaseMcpBuiltinId;
}

export interface DatabaseModeStartFields {
  /** Always Ask for Decision Policy readonly path. */
  mode: 'ask';
  requiredSkillIds: string[];
  /** Empty when disconnected — Ask MCP tools stay hidden (V8 contract). */
  requiredMcpServerIds: string[];
  /** Extra Prompt Construction blocks (guidance + persona already in profile). */
  projectRules: Array<{
    id: string;
    title: string;
    content: string;
    priority: number;
  }>;
  /** Tighten-only safety from the database mode profile (merge with workspace). */
  userSafetyRules: UserSafetyRules;
}

export interface DatabaseModeStartResult {
  connectionStatus: DatabaseModeConnectionStatus;
  installedDatabaseServers: readonly DatabaseMcpServerRef[];
  /** Human-readable connect hint for UI empty states. */
  connectGuidance: string;
  startFields: DatabaseModeStartFields;
}

export interface ResolveDatabaseModeStartOptions {
  workspaceRoot: string;
  /**
   * Optional explicit server ids to pin (subset of installed).
   * When omitted, all installed database MCP servers are pinned (capped).
   */
  preferredServerIds?: readonly string[];
  /** Max MCP servers to pin (V8 max requiredMcpServerIds is 5). */
  maxPinnedServers?: number;
}
