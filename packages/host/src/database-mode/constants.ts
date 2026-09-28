/**
 * Database mode constants — host overlay on Ask / Agent.
 * Decision Policy / ToolGrant remain V8 authority.
 */

/** Builtin mode profile slug (also UI mode id in Desktop / VS Code / CLI). */
export const DATABASE_MODE_SLUG = 'database' as const;

/** Bundled skill forced when database mode starts. */
export const NL_SQL_ANALYST_SKILL_ID = 'nl-sql-analyst' as const;

/** DB privilege for Database mode (composer control — not workspace approval). */
export const DATABASE_DB_ACCESS_MODES = ['readonly', 'readwrite'] as const;
export type DatabaseDbAccess = (typeof DATABASE_DB_ACCESS_MODES)[number];

/** Builtin MCP catalog ids treated as database connectors. */
export const DATABASE_MCP_BUILTIN_IDS = [
  'sqlite',
  'postgres',
  'mongo',
  'sqlite-readonly',
  'postgres-readonly',
  'mongo-readonly',
] as const;

export type DatabaseMcpBuiltinId = (typeof DATABASE_MCP_BUILTIN_IDS)[number];

export const MCP_DB_ACCESS_ENV_KEY = 'MCP_DB_ACCESS' as const;
