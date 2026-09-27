/**
 * Database mode constants — host overlay on Ask.
 * Decision Policy / ToolGrant remain V8 authority.
 */

/** Builtin mode profile slug (also UI mode id in Desktop / VS Code / CLI). */
export const DATABASE_MODE_SLUG = 'database' as const;

/** Bundled skill forced when database mode starts. */
export const NL_SQL_ANALYST_SKILL_ID = 'nl-sql-analyst' as const;

/** Builtin MCP catalog ids treated as database connectors. */
export const DATABASE_MCP_BUILTIN_IDS = [
  'sqlite-readonly',
  'postgres-readonly',
  'mongo-readonly',
] as const;

export type DatabaseMcpBuiltinId = (typeof DATABASE_MCP_BUILTIN_IDS)[number];
