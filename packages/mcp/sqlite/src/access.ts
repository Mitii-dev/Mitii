/**
 * Database MCP access mode — Mitii pattern for internal DB servers.
 *
 * Env: MCP_DB_ACCESS=readonly|readwrite (default readonly)
 * Also accepts MITII_DB_ACCESS, and aliases rw / write / read_write.
 */

export type DbAccessMode = 'readonly' | 'readwrite';

export const WRITE_TOOL_NAMES = new Set([
  'insert',
  'update',
  'delete',
  'create_index',
  'execute_write',
]);

export function resolveDbAccessMode(
  env: NodeJS.ProcessEnv = process.env,
): DbAccessMode {
  const raw = (
    env.MCP_DB_ACCESS?.trim() ||
    env.MITII_DB_ACCESS?.trim() ||
    'readonly'
  ).toLowerCase();
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

export function assertWriteAllowed(
  access: DbAccessMode,
  toolName: string,
): void {
  if (access !== 'readwrite') {
    throw new Error(
      `Tool "${toolName}" requires MCP_DB_ACCESS=readwrite (current: ${access})`,
    );
  }
}

export function isDbWriteToolName(toolName: string): boolean {
  return WRITE_TOOL_NAMES.has(toolName.trim().toLowerCase());
}
