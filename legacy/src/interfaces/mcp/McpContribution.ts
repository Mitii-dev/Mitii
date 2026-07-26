import type { JsonSchema } from '../shared/json';

export type McpTransportKind = 'stdio' | 'http' | 'sse' | 'websocket' | 'streamable-http';

export interface McpServerDefinition {
  id: string;
  displayName: string;
  transport: McpTransportKind;
  endpoint?: string;
  command?: string;
  args?: readonly string[];
  environment?: Record<string, string>;
  trust: 'builtin' | 'installed' | 'workspace' | 'managed';
}

export interface McpToolDescriptor {
  id: string;
  exposedName: string;
  originalName: string;
  serverId: string;
  owner: string;
  risk: 'read' | 'write' | 'network' | 'unknown';
  inputSchema: JsonSchema;
}

export interface McpContribution {
  id: string;
  owner: string;
  servers?: readonly McpServerDefinition[];
  tools?: readonly McpToolDescriptor[];
}
