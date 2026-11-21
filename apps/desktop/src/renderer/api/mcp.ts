/** MCP server manager API. */

import {
  authHeaders,
} from './http.js';

export async function fetchMcpServers(options: {
  baseUrl: string;
  token?: string;
}): Promise<{
  enabled: boolean;
  servers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    transport?: string;
    builtin?: boolean;
  }>;
  catalog: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    category?: string;
    secrets?: Array<{
      key: string;
      label: string;
      secret?: boolean;
      required?: boolean;
      placeholder?: string;
      hint?: string;
    }>;
    installed: boolean;
  }>;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`mcp_${res.status}`);
  const data = (await res.json()) as Partial<
    Awaited<ReturnType<typeof fetchMcpServers>>
  >;
  return {
    enabled: Boolean(data.enabled),
    servers: Array.isArray(data.servers) ? data.servers : [],
    catalog: Array.isArray(data.catalog) ? data.catalog : [],
  };
}

export async function setMcpEnabled(options: {
  baseUrl: string;
  token?: string;
  enabled?: boolean;
  serverId?: string;
}): Promise<{
  ok: boolean;
  enabled: boolean;
  servers: Array<{ id: string; name: string; enabled: boolean }>;
  catalog?: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    installed: boolean;
  }>;
  restartRequired?: boolean;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      enabled: options.enabled,
      serverId: options.serverId,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mcp_set_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof setMcpEnabled>>;
}

export async function setDatabaseMcpAccess(options: {
  baseUrl: string;
  token?: string;
  dbAccess: 'readonly' | 'readwrite';
}): Promise<{
  ok: boolean;
  dbAccess: string;
  changed: boolean;
  serverIds: string[];
  restartRequired?: boolean;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      action: 'setDatabaseAccess',
      dbAccess: options.dbAccess,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mcp_db_access_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof setDatabaseMcpAccess>>;
}

export async function installBuiltinMcp(options: {
  baseUrl: string;
  token?: string;
  builtinId: string;
  secrets?: Record<string, string>;
}): Promise<{
  ok: boolean;
  enabled: boolean;
  servers: Array<{ id: string; name: string; enabled: boolean }>;
  catalog?: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    category?: string;
    secrets?: Array<{
      key: string;
      label: string;
      secret?: boolean;
      required?: boolean;
      placeholder?: string;
      hint?: string;
    }>;
    installed: boolean;
  }>;
  restartRequired?: boolean;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      action: 'install',
      builtinId: options.builtinId,
      ...(options.secrets ? { secrets: options.secrets } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mcp_install_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof installBuiltinMcp>>;
}

export async function addCustomMcp(options: {
  baseUrl: string;
  token?: string;
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}): Promise<{
  ok: boolean;
  enabled: boolean;
  servers: Array<{ id: string; name: string; enabled: boolean }>;
  catalog?: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    installed: boolean;
  }>;
  restartRequired?: boolean;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      action: 'add',
      id: options.id,
      name: options.name,
      transport: options.transport,
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      url: options.url,
      headers: options.headers,
      enabled: options.enabled,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mcp_add_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof addCustomMcp>>;
}

export async function deleteMcpServer(options: {
  baseUrl: string;
  token?: string;
  serverId: string;
}): Promise<{
  ok: boolean;
  enabled: boolean;
  servers: Array<{ id: string; name: string; enabled: boolean }>;
  catalog?: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    installed: boolean;
  }>;
  restartRequired?: boolean;
}> {
  const res = await fetch(`${options.baseUrl}/v1/mcp`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      action: 'delete',
      serverId: options.serverId,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mcp_delete_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof deleteMcpServer>>;
}
