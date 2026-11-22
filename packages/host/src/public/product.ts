/**
 * Product behavior — child runs, safety rules, mode profiles, database mode,
 * environment details, OS sandbox, and workspace hooks.
 */

// Child runs — mode ≤ parent, deny-only safety, worktree path
export {
  narrowChildStartInput,
  createChildWorktreePath,
} from '../runtime/childRuns.js';
export type {
  NarrowChildStartInputParams,
  NarrowedChildStartInput,
} from '../runtime/childRuns.js';

// Safety — tighten-only user rules, marketplace-lite
export {
  loadUserSafetyRules,
  withDefaultProtectedPaths,
  USER_SAFETY_RULES_FILENAME,
  USER_SAFETY_RULES_EXAMPLE,
} from '../safety/loadUserSafetyRules.js';
export {
  MARKETPLACE_LITE_CATALOG,
  listMarketplaceLite,
} from '../safety/marketplaceLite.js';
export type { MarketplaceCatalogEntry } from '../safety/marketplaceLite.js';
export { createHeuristicAdversary } from '../safety/heuristicAdversary.js';
export type { HeuristicAdversaryOptions } from '../safety/heuristicAdversary.js';

// Mode profiles — overlays on ask|plan|agent (grant intersect + prompt rules)
export {
  MODE_PROFILE_SCHEMA_VERSION,
  MODE_TOOL_GROUPS,
  MODE_CATALOG_FILENAME,
  MODE_CATALOG_EXAMPLE,
  MODE_CATALOG_TOOL_IDS,
  BUILTIN_MODE_PROFILES,
  getBuiltinModeProfile,
  compileModeProfile,
  loadModeProfiles,
  resolveModeProfile,
  parseModeProfile,
  setActiveModeProfile,
  initModeCatalog,
  mergeUserSafetyRules,
  modeProfileSchema,
  modeCatalogSchema,
} from '../modes/index.js';
export type {
  ModeToolGroup,
  ModeProfile,
  ModeCatalog,
  CompiledModeProfile,
  LoadModeProfilesResult,
} from '../modes/index.js';

// Database mode — UI "database" → Ask + MCP pins + nl-sql-analyst
export {
  DATABASE_MODE_SLUG,
  DATABASE_MCP_BUILTIN_IDS,
  DATABASE_DB_ACCESS_MODES,
  MCP_DB_ACCESS_ENV_KEY,
  NL_SQL_ANALYST_SKILL_ID,
  listInstalledDatabaseMcpServers,
  listInstalledDatabaseMcpServerIds,
  isMcpMasterEnabled,
  buildDatabaseConnectGuidance,
  resolveDatabaseModeStart,
  isDatabaseUiMode,
  mapUiModeToAgentMode,
  applyDatabaseAccessToMcpSettings,
} from '../database-mode/index.js';
export type {
  DatabaseMcpBuiltinId,
  DatabaseDbAccess,
  DatabaseModeConnectionStatus,
  DatabaseMcpServerRef,
  DatabaseModeStartFields,
  DatabaseModeStartResult,
  ResolveDatabaseModeStartOptions,
} from '../database-mode/index.js';

// Environment details — IDE session pulse → Prompt Construction environment
export {
  ENVIRONMENT_DETAILS_BLOCK_ID,
  formatEnvironmentDetailsBlock,
} from '../environment/index.js';
export type {
  WorkspaceEnvironmentSnapshot,
  EnvironmentInstructionBlock,
} from '../environment/index.js';

// OS sandbox
export {
  createSandboxedProcessPort,
  detectSandboxBackend,
  resolveDockerBackend,
  resolveSandboxPolicy,
  SandboxUnavailableError,
} from '../sandbox/createSandboxedProcessPort.js';
export type {
  SandboxPolicy,
  SandboxNetworkMode,
  SandboxBackend,
  SandboxBackendPrefer,
} from '../sandbox/createSandboxedProcessPort.js';
export {
  resolveSandboxPreset,
  resolveSandboxSettingsFromPreset,
} from '../sandbox/resolveSandboxPreset.js';
export type {
  SandboxApprovalPreset,
  SandboxPresetDefaults,
} from '../sandbox/resolveSandboxPreset.js';

// Workspace hooks
export {
  loadWorkspaceHooks,
  evaluatePreToolHooks,
  hookSpecSchema,
  SAMPLE_PRE_TOOL_DENY_GIT_PUSH,
  HOOK_SPEC_SCHEMA_VERSION,
} from '../hooks/workspaceHooks.js';
export type { HookSpec, LoadedHooks } from '../hooks/workspaceHooks.js';
