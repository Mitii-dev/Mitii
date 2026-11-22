/**
 * Shared types and constants for the MCP manager UI.
 */

import type { CatalogSecretField } from './mcpCatalogTypes.js';

export type Transport = 'stdio' | 'sse' | 'streamable-http';

export type WizardStep =
  | 'source'
  | 'catalog'
  | 'catalog-secrets'
  | 'custom-transport'
  | 'custom-details';

export interface McpServerRow {
  id: string;
  name: string;
  enabled: boolean;
  transport?: string;
  builtin?: boolean;
}

export interface CatalogRow {
  id: string;
  name: string;
  transport: string;
  description: string;
  category?: string;
  secrets?: CatalogSecretField[];
  installed: boolean;
}

export interface McpSnapshot {
  enabled: boolean;
  servers: McpServerRow[];
  catalog?: CatalogRow[];
  restartRequired?: boolean;
}

export interface CustomMcpDraft {
  id: string;
  name: string;
  transport: Transport;
  command: string;
  argsText: string;
  cwd: string;
  url: string;
  headersText: string;
}

export const EMPTY_CUSTOM: CustomMcpDraft = {
  id: '',
  name: '',
  transport: 'stdio',
  command: 'npx',
  argsText: '',
  cwd: '',
  url: '',
  headersText: '',
};

export const CATEGORY_LABEL: Record<string, string> = {
  workspace: 'Workspace',
  reasoning: 'Reasoning',
  browser: 'Browser',
  vcs: 'Git / VCS',
  search: 'Search',
  diagrams: 'Diagrams',
  database: 'Database',
};
