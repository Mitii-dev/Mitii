/**
 * MCP attach stamp on the grant/decision surface (§5.12 plate 18).
 * Revoke removes server ids — tools from that server drop from prompt⊆grant.
 */
export function stampMcpAttach(params: {
  allowedMcpServerIds: string[];
  attachServerId: string;
}): string[] {
  if (params.allowedMcpServerIds.includes(params.attachServerId)) {
    return [...params.allowedMcpServerIds];
  }
  return [...params.allowedMcpServerIds, params.attachServerId];
}

export function revokeMcpAttach(params: {
  allowedMcpServerIds: string[];
  revokeServerId: string;
}): string[] {
  return params.allowedMcpServerIds.filter((id) => id !== params.revokeServerId);
}
