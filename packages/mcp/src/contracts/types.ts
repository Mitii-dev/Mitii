/**
 * Public contracts for the Mitii MCP client kit.
 * Transport implementations and hosts depend on these types only.
 */

/** MCP transport kinds (aligned with VS Code protocol + `.mitii/mcp.json`). */
export type McpTransport = 'stdio' | 'sse' | 'streamable-http';

export interface McpServerConfig {
  /** Stable id (builtins: filesystem, sequential-thinking, memory, puppeteer). */
  id?: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Prefers `enabled`; `disabled` kept for backwards compatibility. */
  enabled?: boolean;
  disabled?: boolean;
  /** True for Mitii-shipped catalog servers. */
  builtin?: boolean;
}

export interface McpSettings {
  enabled: boolean;
  servers: McpServerConfig[];
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpRoot {
  uri: string;
  name?: string;
}

export interface McpToolCallResult {
  content: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

/** Unified client surface for all transports. */
export interface McpClient {
  initialize(): Promise<void>;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: unknown): Promise<McpToolCallResult>;
  dispose(): void;
}

export type McpServerRuntimeStatus =
  | 'disabled'
  | 'connecting'
  | 'ready'
  | 'error';

export interface McpServerStatus {
  id: string;
  name: string;
  status: McpServerRuntimeStatus;
  toolCount: number;
  error?: string;
}
