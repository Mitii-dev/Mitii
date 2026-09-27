import type { DatabaseModeConnectionStatus } from './contracts.js';

/**
 * User-facing guidance when database mode cannot query yet.
 */
export function buildDatabaseConnectGuidance(
  status: DatabaseModeConnectionStatus,
): string {
  switch (status) {
    case 'mcp_disabled':
      return [
        'Database mode needs MCP enabled.',
        'Enable mitii.mcp.enabled (Settings → Integrations), then install sqlite-readonly, postgres-readonly, or mongo-readonly from the catalog',
        'and set SQLITE_PATH, DATABASE_URI, or MCP_MONGODB_URI.',
        'Until then, do not invent query results — explain how to connect.',
      ].join(' ');
    case 'disconnected':
      return [
        'No database MCP server is connected for this workspace.',
        'Install and enable sqlite-readonly (SQLITE_PATH), postgres-readonly (DATABASE_URI), or mongo-readonly (MCP_MONGODB_URI)',
        'under Settings → Integrations → MCP, or add a custom read-only DB MCP in .mitii/mcp.json.',
        'You may read schema.prisma / migrations as hints only — live answers require MCP.',
      ].join(' ');
    case 'connected':
      return [
        'Database MCP is connected. Prefer mcp__* discovery + query tools',
        '(SQL: list_tables / describe_table / query; Mongo: resources or collection schema + query / aggregate / count).',
        'Read-only only. Present results as a short summary plus a markdown table. Show the filter/pipeline/SQL used.',
      ].join(' ');
  }
}
